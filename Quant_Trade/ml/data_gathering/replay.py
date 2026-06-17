"""
Replay event recorder — captures orders, fills, cancels, and strategy decisions
from the exchange simulator for debugging and backtesting.

Kept deliberately separate from the tick recorder:
  - Different schema, different directory, different WebSocket channel
  - The ML recorder's only job is tick data
  - The replay recorder's job is everything else needed to reconstruct sessions

Run standalone:
    python -m ml.data.replay

Or import ReplayRecorder and run alongside MarketDataRecorder in the same
event loop (see recorder.py).

File layout:
    ml/data/replay/
        orders/   orders_{date}_{n:04d}.parquet
        fills/    fills_{date}_{n:04d}.parquet
        cancels/  cancels_{date}_{n:04d}.parquet
        decisions/ decisions_{date}_{n:04d}.parquet
"""

import asyncio
import json
import logging
import os
import signal
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import pyarrow as pa
import pyarrow.parquet as pq
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Schemas — one per event type
# ------------------------------------------------------------------

@dataclass
class OrderEvent:
    timestamp_ns: int
    order_id: str
    symbol: str
    side: str          # "buy" | "sell"
    price: float
    quantity: float
    order_type: str    # "limit" | "market"
    sequence: int


@dataclass
class FillEvent:
    timestamp_ns: int
    order_id: str
    symbol: str
    side: str
    fill_price: float
    fill_qty: float
    remaining_qty: float
    sequence: int


@dataclass
class CancelEvent:
    timestamp_ns: int
    order_id: str
    symbol: str
    reason: str        # "user" | "expired" | "risk_rejected"
    sequence: int


@dataclass
class DecisionEvent:
    timestamp_ns: int
    symbol: str
    action: str        # "place_order" | "cancel_order" | "hold"
    side: str          # "buy" | "sell" | ""
    price: float
    quantity: float
    ml_signal: float   # buy_prob from ML prediction (0.0 if no ML)
    reason: str        # e.g. "ml_signal_high" | "spread_too_wide"
    sequence: int


ORDER_SCHEMA = pa.schema([
    pa.field("timestamp_ns", pa.int64()),
    pa.field("order_id",     pa.string()),
    pa.field("symbol",       pa.string()),
    pa.field("side",         pa.string()),
    pa.field("price",        pa.float64()),
    pa.field("quantity",     pa.float64()),
    pa.field("order_type",   pa.string()),
    pa.field("sequence",     pa.int64()),
])

FILL_SCHEMA = pa.schema([
    pa.field("timestamp_ns",   pa.int64()),
    pa.field("order_id",       pa.string()),
    pa.field("symbol",         pa.string()),
    pa.field("side",           pa.string()),
    pa.field("fill_price",     pa.float64()),
    pa.field("fill_qty",       pa.float64()),
    pa.field("remaining_qty",  pa.float64()),
    pa.field("sequence",       pa.int64()),
])

CANCEL_SCHEMA = pa.schema([
    pa.field("timestamp_ns", pa.int64()),
    pa.field("order_id",     pa.string()),
    pa.field("symbol",       pa.string()),
    pa.field("reason",       pa.string()),
    pa.field("sequence",     pa.int64()),
])

DECISION_SCHEMA = pa.schema([
    pa.field("timestamp_ns", pa.int64()),
    pa.field("symbol",       pa.string()),
    pa.field("action",       pa.string()),
    pa.field("side",         pa.string()),
    pa.field("price",        pa.float64()),
    pa.field("quantity",     pa.float64()),
    pa.field("ml_signal",    pa.float64()),
    pa.field("reason",       pa.string()),
    pa.field("sequence",     pa.int64()),
])


# ------------------------------------------------------------------
# Parsers
# ------------------------------------------------------------------

def parse_order(msg: dict[str, Any]) -> OrderEvent:
    return OrderEvent(
        timestamp_ns=int(msg["timestamp_ns"]),
        order_id=str(msg["order_id"]),
        symbol=str(msg["symbol"]),
        side=str(msg["side"]),
        price=float(msg["price"]),
        quantity=float(msg["quantity"]),
        order_type=str(msg.get("order_type", "limit")),
        sequence=int(msg["sequence"]),
    )


def parse_fill(msg: dict[str, Any]) -> FillEvent:
    return FillEvent(
        timestamp_ns=int(msg["timestamp_ns"]),
        order_id=str(msg["order_id"]),
        symbol=str(msg["symbol"]),
        side=str(msg["side"]),
        fill_price=float(msg["fill_price"]),
        fill_qty=float(msg["fill_qty"]),
        remaining_qty=float(msg.get("remaining_qty", 0.0)),
        sequence=int(msg["sequence"]),
    )


def parse_cancel(msg: dict[str, Any]) -> CancelEvent:
    return CancelEvent(
        timestamp_ns=int(msg["timestamp_ns"]),
        order_id=str(msg["order_id"]),
        symbol=str(msg["symbol"]),
        reason=str(msg.get("reason", "user")),
        sequence=int(msg["sequence"]),
    )


def parse_decision(msg: dict[str, Any]) -> DecisionEvent:
    return DecisionEvent(
        timestamp_ns=int(msg["timestamp_ns"]),
        symbol=str(msg["symbol"]),
        action=str(msg["action"]),
        side=str(msg.get("side", "")),
        price=float(msg.get("price", 0.0)),
        quantity=float(msg.get("quantity", 0.0)),
        ml_signal=float(msg.get("ml_signal", 0.0)),
        reason=str(msg.get("reason", "")),
        sequence=int(msg["sequence"]),
    )


# ------------------------------------------------------------------
# Replay writer — one buffer per event type
# ------------------------------------------------------------------

class ReplayWriter:
    """
    Buffers replay events in memory and flushes to Parquet.
    One sub-directory per event type, one file per day with rotation.
    """

    _CONFIGS = {
        "orders":    (ORDER_SCHEMA,    lambda e: {
            "timestamp_ns": [e.timestamp_ns], "order_id": [e.order_id],
            "symbol": [e.symbol], "side": [e.side], "price": [e.price],
            "quantity": [e.quantity], "order_type": [e.order_type],
            "sequence": [e.sequence],
        }),
        "fills":     (FILL_SCHEMA,     lambda e: {
            "timestamp_ns": [e.timestamp_ns], "order_id": [e.order_id],
            "symbol": [e.symbol], "side": [e.side], "fill_price": [e.fill_price],
            "fill_qty": [e.fill_qty], "remaining_qty": [e.remaining_qty],
            "sequence": [e.sequence],
        }),
        "cancels":   (CANCEL_SCHEMA,   lambda e: {
            "timestamp_ns": [e.timestamp_ns], "order_id": [e.order_id],
            "symbol": [e.symbol], "reason": [e.reason],
            "sequence": [e.sequence],
        }),
        "decisions": (DECISION_SCHEMA, lambda e: {
            "timestamp_ns": [e.timestamp_ns], "symbol": [e.symbol],
            "action": [e.action], "side": [e.side], "price": [e.price],
            "quantity": [e.quantity], "ml_signal": [e.ml_signal],
            "reason": [e.reason], "sequence": [e.sequence],
        }),
    }

    def __init__(
        self,
        output_dir: str,
        buffer_size: int = 1_000,
        flush_interval_s: float = 10.0,
        max_file_rows: int = 100_000,
    ) -> None:
        self.output_dir = output_dir
        self.buffer_size = buffer_size
        self.flush_interval_s = flush_interval_s
        self.max_file_rows = max_file_rows

        self._buffers: dict[str, list] = {k: [] for k in self._CONFIGS}
        self._file_row_count: dict[str, int] = {k: 0 for k in self._CONFIGS}
        self._file_index: dict[str, int] = {k: 0 for k in self._CONFIGS}
        self._flush_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self._flush_task = asyncio.create_task(self._periodic_flush())
        logger.info("replay_writer started output_dir=%s", self.output_dir)

    async def stop(self) -> None:
        if self._flush_task:
            self._flush_task.cancel()
        for event_type in self._CONFIGS:
            await self._flush(event_type)
        logger.info("replay_writer stopped")

    def add_order(self, event: OrderEvent) -> None:
        self._add("orders", event)

    def add_fill(self, event: FillEvent) -> None:
        self._add("fills", event)

    def add_cancel(self, event: CancelEvent) -> None:
        self._add("cancels", event)

    def add_decision(self, event: DecisionEvent) -> None:
        self._add("decisions", event)

    def _add(self, event_type: str, event: Any) -> None:
        self._buffers[event_type].append(event)
        if len(self._buffers[event_type]) >= self.buffer_size:
            asyncio.ensure_future(self._flush(event_type))

    async def _periodic_flush(self) -> None:
        while True:
            await asyncio.sleep(self.flush_interval_s)
            for event_type in self._CONFIGS:
                await self._flush(event_type)

    async def _flush(self, event_type: str) -> None:
        buf = self._buffers[event_type]
        if not buf:
            return

        events, self._buffers[event_type] = buf, []
        schema, row_builder = self._CONFIGS[event_type]

        # Merge all rows into one dict of lists
        merged: dict[str, list] = {col: [] for col in schema.names}
        for event in events:
            row = row_builder(event)
            for col in merged:
                merged[col].extend(row[col])

        table = pa.table(merged, schema=schema)
        path = self._get_path(event_type)
        os.makedirs(os.path.dirname(path), exist_ok=True)

        if os.path.exists(path):
            existing = pq.read_table(path, schema=schema)
            table = pa.concat_tables([existing, table])

        pq.write_table(table, path, compression="snappy")

        self._file_row_count[event_type] += len(events)
        logger.debug(
            "replay_flushed type=%s rows=%d file=%s",
            event_type, len(events), path,
        )

        if self._file_row_count[event_type] >= self.max_file_rows:
            self._file_index[event_type] += 1
            self._file_row_count[event_type] = 0

    def _get_path(self, event_type: str) -> str:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        idx = self._file_index[event_type]
        return os.path.join(
            self.output_dir, event_type,
            f"{event_type}_{date_str}_{idx:04d}.parquet",
        )


# ------------------------------------------------------------------
# Replay recorder — WebSocket subscriber
# ------------------------------------------------------------------

_PARSERS = {
    "order":    (parse_order,    "add_order"),
    "fill":     (parse_fill,     "add_fill"),
    "cancel":   (parse_cancel,   "add_cancel"),
    "decision": (parse_decision, "add_decision"),
}


class ReplayRecorder:
    """
    Subscribes to the exchange simulator's replay/event channel and
    records orders, fills, cancels, and strategy decisions to Parquet.

    The replay channel is typically the same WebSocket as the tick feed
    but with different message types — or a separate endpoint entirely.
    Configure via ws_url.
    """

    def __init__(
        self,
        ws_url: str,
        output_dir: str = "ml/data/replay",
        reconnect_delay_s: float = 1.0,
        max_reconnect_delay_s: float = 30.0,
    ) -> None:
        self.ws_url = ws_url
        self.writer = ReplayWriter(output_dir=output_dir)
        self.reconnect_delay_s = reconnect_delay_s
        self.max_reconnect_delay_s = max_reconnect_delay_s
        self._running = False
        self._counts: dict[str, int] = {k: 0 for k in _PARSERS}

    async def run(self) -> None:
        self._running = True
        await self.writer.start()

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(self._shutdown()))

        logger.info("replay_recorder starting url=%s", self.ws_url)

        delay = self.reconnect_delay_s
        while self._running:
            try:
                await self._connect_and_record()
                delay = self.reconnect_delay_s
            except (ConnectionClosed, WebSocketException, OSError) as exc:
                if not self._running:
                    break
                logger.warning(
                    "replay connection lost: %s — reconnecting in %.1fs", exc, delay
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.max_reconnect_delay_s)

    async def _connect_and_record(self) -> None:
        async with websockets.connect(self.ws_url, ping_interval=20) as ws:
            logger.info("replay_recorder connected")
            # Subscribe to all replay event types
            await ws.send(json.dumps({
                "action": "subscribe",
                "channels": ["orders", "fills", "cancels", "decisions"],
            }))
            async for raw_msg in ws:
                if not self._running:
                    return
                await self._handle_message(raw_msg)

    async def _handle_message(self, raw_msg: str) -> None:
        try:
            msg = json.loads(raw_msg)
        except json.JSONDecodeError:
            return

        event_type = msg.get("type")
        if event_type not in _PARSERS:
            return

        try:
            parser, writer_method = _PARSERS[event_type]
            event = parser(msg)
            getattr(self.writer, writer_method)(event)
            self._counts[event_type] += 1
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("malformed replay message type=%s: %s", event_type, exc)

    async def _shutdown(self) -> None:
        self._running = False
        await self.writer.stop()
        logger.info("replay_recorder stopped counts=%s", self._counts)


# ------------------------------------------------------------------
# Entry point (run standalone)
# ------------------------------------------------------------------

async def main() -> None:
    import os
    ws_url = os.getenv("EXCHANGE_WS_URL", "ws://localhost:8080/market-data")
    output_dir = os.getenv("REPLAY_DATA_DIR", "ml/data/replay")
    recorder = ReplayRecorder(ws_url=ws_url, output_dir=output_dir)
    await recorder.run()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(main())
