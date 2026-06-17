"""
Tick data schema.

Every field here must match what the exchange simulator sends over WebSocket.
If Anshul changes the message format, update from_ws_message() and ARROW_SCHEMA together.
"""

from dataclasses import dataclass, asdict
from typing import Any
import pyarrow as pa


@dataclass
class Tick:
    timestamp_ns: int   # nanosecond unix timestamp from exchange clock
    symbol: str         # e.g. "BTC-USD"
    bid: float          # best bid price
    ask: float          # best ask price
    bid_sz: float       # quantity available at bid
    ask_sz: float       # quantity available at ask
    last_price: float   # last traded price
    volume: float       # cumulative volume for this session
    sequence: int       # monotonically increasing sequence number from exchange

    # Set to True by the validator when one or more sequence numbers were
    # missing just before this tick arrived. Ticks within N steps of a
    # seq_gap=True row must be masked out during label creation (Phase 3)
    # because their forward window may cross a data hole.
    seq_gap: bool = False

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    @property
    def microprice(self) -> float:
        """Size-weighted mid — better estimate of fair value than simple mid."""
        total = self.bid_sz + self.ask_sz
        if total == 0:
            return self.mid
        return (self.bid * self.ask_sz + self.ask * self.bid_sz) / total

    def to_dict(self) -> dict:
        return asdict(self)


# Pyarrow schema — must stay in sync with Tick fields above.
# Column order here determines column order in Parquet files.
ARROW_SCHEMA = pa.schema([
    pa.field("timestamp_ns", pa.int64()),
    pa.field("symbol",       pa.string()),
    pa.field("bid",          pa.float64()),
    pa.field("ask",          pa.float64()),
    pa.field("bid_sz",       pa.float64()),
    pa.field("ask_sz",       pa.float64()),
    pa.field("last_price",   pa.float64()),
    pa.field("volume",       pa.float64()),
    pa.field("sequence",     pa.int64()),
    # True when sequence numbers were missing just before this tick.
    # Use this column to mask labels during Phase 3.
    pa.field("seq_gap",      pa.bool_()),
])


def from_ws_message(msg: dict[str, Any]) -> Tick:
    """
    Parse a raw WebSocket message dict into a Tick.

    Expected message format from exchange simulator:
    {
        "type": "tick",
        "symbol": "BTC-USD",
        "timestamp_ns": 1700000000000000000,
        "bid": 50000.0,
        "ask": 50001.0,
        "bid_sz": 1.5,
        "ask_sz": 2.0,
        "last_price": 50000.5,
        "volume": 1234.0,
        "sequence": 42
    }
    seq_gap is always False here — it gets set by the validator.
    """
    return Tick(
        timestamp_ns=int(msg["timestamp_ns"]),
        symbol=str(msg["symbol"]),
        bid=float(msg["bid"]),
        ask=float(msg["ask"]),
        bid_sz=float(msg["bid_sz"]),
        ask_sz=float(msg["ask_sz"]),
        last_price=float(msg["last_price"]),
        volume=float(msg["volume"]),
        sequence=int(msg["sequence"]),
        seq_gap=False,
    )
