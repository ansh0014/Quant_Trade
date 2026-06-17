"""
Market data recorder — the main entry point for Phase 1.

Connects to the exchange simulator's WebSocket feed, validates each tick,
and writes to Parquet via a buffered writer.

Run with:
    python -m ml.data.recorder

Or from project root:
    EXCHANGE_WS_URL=ws://localhost:8080/market-data python -m ml.data.recorder
"""

import asyncio
import json
import logging
import signal
import time
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from .config import DataConfig
from .schema import Tick, from_ws_message
from .validator import TickValidator
from .writer import ParquetWriter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


class MarketDataRecorder:
    """
    Subscribes to the exchange simulator WebSocket and records ticks to Parquet.

    Reconnects automatically with exponential backoff.
    Handles SIGINT / SIGTERM gracefully — flushes all buffers before exiting.
    """

    def __init__(self, config: DataConfig) -> None:
        self.config = config
        self.validator = TickValidator()
        self.writer = ParquetWriter(
            output_dir=config.output_dir,
            buffer_size=config.buffer_size,
            flush_interval_s=config.flush_interval_s,
            max_file_ticks=config.max_file_ticks,
        )

        self._running = False
        self._ticks_received = 0
        self._ticks_since_last_stat = 0
        self._last_stat_time = time.monotonic()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    async def run(self) -> None:
        self._running = True
        await self.writer.start()

        # Register graceful shutdown on SIGINT / SIGTERM
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(self._shutdown()))

        logger.info(
            "recorder starting url=%s symbols=%s",
            self.config.ws_url,
            self.config.symbols or "all",
        )

        delay = self.config.reconnect_delay_s
        while self._running:
            try:
                await self._connect_and_record()
                delay = self.config.reconnect_delay_s  # reset on clean exit
            except (ConnectionClosed, WebSocketException, OSError) as exc:
                if not self._running:
                    break
                logger.warning(
                    "connection lost: %s — reconnecting in %.1fs", exc, delay
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.config.max_reconnect_delay_s)
            except Exception as exc:
                logger.error("unexpected error: %s", exc, exc_info=True)
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.config.max_reconnect_delay_s)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _connect_and_record(self) -> None:
        logger.info("connecting to %s", self.config.ws_url)

        async with websockets.connect(
            self.config.ws_url,
            ping_interval=20,
            ping_timeout=10,
            max_size=2**20,   # 1MB max message size
        ) as ws:
            logger.info("connected")

            # Send subscription message if filtering by symbol
            if self.config.symbols:
                sub_msg = json.dumps({
                    "action": "subscribe",
                    "symbols": self.config.symbols,
                })
                await ws.send(sub_msg)
                logger.info("subscribed to symbols=%s", self.config.symbols)

            async for raw_msg in ws:
                if not self._running:
                    return
                await self._handle_message(raw_msg)

    async def _handle_message(self, raw_msg: str) -> None:
        try:
            msg = json.loads(raw_msg)
        except json.JSONDecodeError:
            logger.debug("non-json message received, skipping")
            return

        # Ignore non-tick messages (heartbeats, acks, etc.)
        if msg.get("type") != "tick":
            return

        try:
            tick = from_ws_message(msg)
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("malformed tick message: %s — %s", exc, msg)
            return

        result = self.validator.validate(tick)
        if not result.valid:
            return  # logged inside validator

        self.writer.add(tick)
        self._ticks_received += 1
        self._ticks_since_last_stat += 1
        self._maybe_log_stats()

    def _maybe_log_stats(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_stat_time
        if elapsed < self.config.stats_interval_s:
            return

        rate = self._ticks_since_last_stat / elapsed
        logger.info(
            "stats total_ticks=%d rate=%.0f ticks/s",
            self._ticks_received, rate,
        )
        self.validator.report()

        self._ticks_since_last_stat = 0
        self._last_stat_time = now

    async def _shutdown(self) -> None:
        logger.info("shutdown signal received — flushing buffers")
        self._running = False
        await self.writer.stop()
        logger.info("shutdown complete total_ticks=%d", self._ticks_received)


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

async def main() -> None:
    config = DataConfig.from_env()
    recorder = MarketDataRecorder(config)
    await recorder.run()


if __name__ == "__main__":
    asyncio.run(main())
