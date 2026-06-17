"""
Tick data validation.

Checks run on every tick before it enters the buffer.

Sequence gaps are NOT treated as failures — the tick is still valid data.
Instead, seq_gap=True is set on the tick so Phase 3 can mask labels that
cross the gap boundary. Everything else that fails is dropped and logged.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from .schema import Tick

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    valid: bool
    reason: Optional[str] = None


class TickValidator:
    """
    Validates individual ticks and tracks aggregate stats.
    Call .report() periodically to log validation health.
    """

    def __init__(
        self,
        max_spread_bps: float = 500.0,    # reject if spread > 500 basis points
        max_price_jump_pct: float = 5.0,  # reject if price moves > 5% from last tick
        min_size: float = 0.0,
    ) -> None:
        self.max_spread_bps = max_spread_bps
        self.max_price_jump_pct = max_price_jump_pct
        self.min_size = min_size

        self._last_price: dict[str, float] = {}
        self._last_seq: dict[str, int] = {}

        self.total = 0
        self.passed = 0
        self.seq_gaps_detected = 0       # total gap events across all symbols
        self.seq_gaps_ticks_missing = 0  # total ticks inferred missing
        self.failed: dict[str, int] = {}

    def validate(self, tick: Tick) -> ValidationResult:
        """
        Validate tick. If a sequence gap is detected, tick.seq_gap is set
        to True and validation still passes — the tick is accepted.
        All other failures drop the tick entirely.
        """
        self.total += 1

        # --- structural checks ---
        if tick.bid <= 0 or tick.ask <= 0:
            return self._fail(tick, "non_positive_price")

        if tick.bid >= tick.ask:
            return self._fail(tick, "crossed_book")

        if tick.bid_sz < self.min_size or tick.ask_sz < self.min_size:
            return self._fail(tick, "size_below_minimum")

        if tick.last_price <= 0:
            return self._fail(tick, "non_positive_last_price")

        if tick.volume < 0:
            return self._fail(tick, "negative_volume")

        # --- spread sanity ---
        spread_bps = (tick.ask - tick.bid) / tick.bid * 10_000
        if spread_bps > self.max_spread_bps:
            return self._fail(tick, f"spread_too_wide_{spread_bps:.0f}bps")

        # --- price jump check ---
        last_px = self._last_price.get(tick.symbol)
        if last_px is not None:
            jump_pct = abs(tick.last_price - last_px) / last_px * 100
            if jump_pct > self.max_price_jump_pct:
                return self._fail(tick, f"price_jump_{jump_pct:.1f}pct")

        # --- sequence gap check ---
        # Unlike other checks, a gap doesn't drop the tick.
        # We mark it so Phase 3 can mask labels crossing this boundary.
        last_seq = self._last_seq.get(tick.symbol)
        if last_seq is not None and tick.sequence > last_seq + 1:
            missing = tick.sequence - last_seq - 1
            tick.seq_gap = True
            self.seq_gaps_detected += 1
            self.seq_gaps_ticks_missing += missing
            logger.warning(
                "sequence_gap symbol=%s last_seq=%d current_seq=%d missing=%d "
                "tick marked seq_gap=True",
                tick.symbol, last_seq, tick.sequence, missing,
            )

        # --- all checks passed: update running state ---
        self._last_price[tick.symbol] = tick.last_price
        self._last_seq[tick.symbol] = tick.sequence
        self.passed += 1
        return ValidationResult(valid=True)

    def _fail(self, tick: Tick, reason: str) -> ValidationResult:
        self.failed[reason] = self.failed.get(reason, 0) + 1
        logger.debug(
            "tick_rejected symbol=%s seq=%d reason=%s",
            tick.symbol, tick.sequence, reason,
        )
        return ValidationResult(valid=False, reason=reason)

    def report(self) -> None:
        if self.total == 0:
            return
        pass_rate = self.passed / self.total * 100
        logger.info(
            "validation total=%d passed=%d (%.1f%%) "
            "seq_gap_events=%d seq_gap_ticks_missing=%d "
            "failed_reasons=%s",
            self.total, self.passed, pass_rate,
            self.seq_gaps_detected, self.seq_gaps_ticks_missing,
            self.failed,
        )
        if pass_rate < 95.0:
            logger.warning(
                "validation pass rate below 95%% — check exchange simulator output"
            )
        if self.seq_gaps_detected > 0:
            logger.warning(
                "%d sequence gap events detected (%d ticks missing) — "
                "mask seq_gap=True rows when creating labels in Phase 3",
                self.seq_gaps_detected, self.seq_gaps_ticks_missing,
            )
