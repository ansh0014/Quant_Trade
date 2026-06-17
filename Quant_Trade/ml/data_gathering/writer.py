"""
Buffered Parquet writer with automatic file rotation.

Ticks are accumulated in memory and flushed to disk either when the
buffer hits `buffer_size` rows or when `flush_interval_s` seconds pass —
whichever comes first. Files rotate after `max_file_ticks` total rows.

Files are written to:
    {output_dir}/{symbol}/ticks_{date}_{n:04d}.parquet

Keeping one directory per symbol makes it easy to load a single
instrument for feature engineering later.
"""

import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import pyarrow as pa
import pyarrow.parquet as pq

from .schema import Tick, ARROW_SCHEMA

logger = logging.getLogger(__name__)


class ParquetWriter:
    def __init__(
        self,
        output_dir: str,
        buffer_size: int = 10_000,
        flush_interval_s: float = 5.0,
        max_file_ticks: int = 500_000,
    ) -> None:
        self.output_dir = output_dir
        self.buffer_size = buffer_size
        self.flush_interval_s = flush_interval_s
        self.max_file_ticks = max_file_ticks

        # buffer: symbol -> list of Tick
        self._buffers: dict[str, list[Tick]] = defaultdict(list)

        # how many ticks written to the current file per symbol
        self._file_tick_count: dict[str, int] = defaultdict(int)

        # file index for rotation: symbol -> int
        self._file_index: dict[str, int] = defaultdict(int)

        self._total_flushed = 0
        self._flush_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add(self, tick: Tick) -> None:
        """Buffer a single tick. Thread-safe for the asyncio event loop."""
        self._buffers[tick.symbol].append(tick)
        if len(self._buffers[tick.symbol]) >= self.buffer_size:
            # fire-and-forget flush; we're inside the event loop
            asyncio.ensure_future(self._flush_symbol(tick.symbol))

    async def start(self) -> None:
        """Start the periodic flush task."""
        self._flush_task = asyncio.create_task(self._periodic_flush())
        logger.info("parquet_writer started output_dir=%s", self.output_dir)

    async def stop(self) -> None:
        """Flush all remaining buffers and stop."""
        if self._flush_task:
            self._flush_task.cancel()
        await self.flush_all()
        logger.info(
            "parquet_writer stopped total_flushed=%d", self._total_flushed
        )

    async def flush_all(self) -> None:
        """Flush every symbol's buffer to disk."""
        for symbol in list(self._buffers.keys()):
            await self._flush_symbol(symbol)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _periodic_flush(self) -> None:
        while True:
            await asyncio.sleep(self.flush_interval_s)
            await self.flush_all()

    async def _flush_symbol(self, symbol: str) -> None:
        buf = self._buffers[symbol]
        if not buf:
            return

        # Swap buffer out atomically so new ticks aren't missed
        ticks, self._buffers[symbol] = buf, []

        path = self._get_path(symbol)
        os.makedirs(os.path.dirname(path), exist_ok=True)

        # Build Arrow table from the list of Ticks
        table = pa.table(
            {
                "timestamp_ns": [t.timestamp_ns for t in ticks],
                "symbol":       [t.symbol       for t in ticks],
                "bid":          [t.bid           for t in ticks],
                "ask":          [t.ask           for t in ticks],
                "bid_sz":       [t.bid_sz        for t in ticks],
                "ask_sz":       [t.ask_sz        for t in ticks],
                "last_price":   [t.last_price    for t in ticks],
                "volume":       [t.volume        for t in ticks],
                "sequence":     [t.sequence      for t in ticks],
                "seq_gap":      [t.seq_gap       for t in ticks],
            },
            schema=ARROW_SCHEMA,
        )

        # Append to existing file or create new one
        if os.path.exists(path):
            existing = pq.read_table(path, schema=ARROW_SCHEMA)
            table = pa.concat_tables([existing, table])

        pq.write_table(
            table,
            path,
            compression="snappy",        # fast read/write, good compression
            row_group_size=self.buffer_size,
        )

        self._file_tick_count[symbol] += len(ticks)
        self._total_flushed += len(ticks)

        logger.debug(
            "flushed symbol=%s rows=%d file=%s total_in_file=%d",
            symbol, len(ticks), path, self._file_tick_count[symbol],
        )

        # Rotate file if it has hit the max
        if self._file_tick_count[symbol] >= self.max_file_ticks:
            logger.info(
                "rotating file symbol=%s after %d ticks",
                symbol, self._file_tick_count[symbol],
            )
            self._file_index[symbol] += 1
            self._file_tick_count[symbol] = 0

    def _get_path(self, symbol: str) -> str:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        idx = self._file_index[symbol]
        safe_symbol = symbol.replace("/", "-")
        return os.path.join(
            self.output_dir,
            safe_symbol,
            f"ticks_{date_str}_{idx:04d}.parquet",
        )
