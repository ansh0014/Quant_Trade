import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DataConfig:
    # Exchange simulator WebSocket endpoint
    ws_url: str = "ws://localhost:8080/market-data"

    # Where Parquet files are written
    output_dir: str = "ml/data/raw"

    # Flush buffer to disk after this many ticks ...
    buffer_size: int = 10_000
    # ... or after this many seconds, whichever comes first
    flush_interval_s: float = 5.0

    # Rotate to a new Parquet file after this many ticks
    max_file_ticks: int = 500_000

    # None = record all symbols; list = filter to these only
    symbols: Optional[list] = None

    # Reconnection backoff: starts at reconnect_delay_s,
    # doubles on each failure, caps at max_reconnect_delay_s
    reconnect_delay_s: float = 1.0
    max_reconnect_delay_s: float = 30.0

    # Log throughput stats every N seconds
    stats_interval_s: float = 10.0

    @classmethod
    def from_env(cls) -> "DataConfig":
        """Load config from environment variables with sensible defaults."""
        symbols_env = os.getenv("RECORD_SYMBOLS")
        return cls(
            ws_url=os.getenv("EXCHANGE_WS_URL", "ws://localhost:8080/market-data"),
            output_dir=os.getenv("ML_DATA_DIR", "ml/data/raw"),
            buffer_size=int(os.getenv("BUFFER_SIZE", "10000")),
            flush_interval_s=float(os.getenv("FLUSH_INTERVAL_S", "5.0")),
            max_file_ticks=int(os.getenv("MAX_FILE_TICKS", "500000")),
            symbols=symbols_env.split(",") if symbols_env else None,
        )
