package ingestor

import (
	"fmt"
	"math"
	"sync"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"go.uber.org/zap"
)

type ValidationResult struct {
	Valid  bool
	Reason string
}

type TickValidator struct {
	mu                 sync.Mutex
	maxSpreadBps       float64
	maxPriceJumpPct    float64
	minSize            float64
	lastPrice          map[string]float64
	lastSeq            map[string]int64
	total              int64
	passed             int64
	seqGapsDetected    int64
	seqGapsTicksMissing int64
	failed             map[string]int64
	logger             *zap.Logger
}

func NewTickValidator(maxSpreadBps, maxPriceJumpPct, minSize float64, logger *zap.Logger) *TickValidator {
	return &TickValidator{
		maxSpreadBps:    maxSpreadBps,
		maxPriceJumpPct: maxPriceJumpPct,
		minSize:         minSize,
		lastPrice:       make(map[string]float64),
		lastSeq:         make(map[string]int64),
		failed:          make(map[string]int64),
		logger:          logger,
	}
}

func (v *TickValidator) Validate(tick *marketdata.Tick) ValidationResult {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.total++

	if tick.Bid <= 0 || tick.Ask <= 0 {
		return v.fail(tick, "non_positive_price")
	}

	if tick.Bid >= tick.Ask {
		return v.fail(tick, "crossed_book")
	}

	if tick.BidSz < v.minSize || tick.AskSz < v.minSize {
		return v.fail(tick, "size_below_minimum")
	}

	if tick.LastPrice <= 0 {
		return v.fail(tick, "non_positive_last_price")
	}

	if tick.Volume < 0 {
		return v.fail(tick, "negative_volume")
	}

	spreadBps := ((tick.Ask - tick.Bid) / tick.Bid) * 10000
	if spreadBps > v.maxSpreadBps {
		return v.fail(tick, fmt.Sprintf("spread_too_wide_%.0fbps", spreadBps))
	}

	lastPx, ok := v.lastPrice[tick.Symbol]
	if ok {
		jumpPct := (math.Abs(tick.LastPrice-lastPx) / lastPx) * 100
		if jumpPct > v.maxPriceJumpPct {
			return v.fail(tick, fmt.Sprintf("price_jump_%.1fpct", jumpPct))
		}
	}


	lastSeq, ok := v.lastSeq[tick.Symbol]
	if ok && tick.Sequence > lastSeq+1 {
		missing := tick.Sequence - lastSeq - 1
		tick.SeqGap = true
		v.seqGapsDetected++
		v.seqGapsTicksMissing += missing
		v.logger.Warn("sequence_gap detected",
			zap.String("symbol", tick.Symbol),
			zap.Int64("last_seq", lastSeq),
			zap.Int64("current_seq", tick.Sequence),
			zap.Int64("missing", missing),
		)
	}


	v.lastPrice[tick.Symbol] = tick.LastPrice
	v.lastSeq[tick.Symbol] = tick.Sequence
	v.passed++

	return ValidationResult{Valid: true}
}

func (v *TickValidator) fail(tick *marketdata.Tick, reason string) ValidationResult {
	v.failed[reason]++
	v.logger.Debug("tick_rejected",
		zap.String("symbol", tick.Symbol),
		zap.Int64("seq", tick.Sequence),
		zap.String("reason", reason),
	)
	return ValidationResult{Valid: false, Reason: reason}
}

func (v *TickValidator) Report() {
	v.mu.Lock()
	defer v.mu.Unlock()

	if v.total == 0 {
		return
	}

	passRate := (float64(v.passed) / float64(v.total)) * 100
	v.logger.Info("validation report",
		zap.Int64("total", v.total),
		zap.Int64("passed", v.passed),
		zap.Float64("pass_rate_pct", passRate),
		zap.Int64("seq_gap_events", v.seqGapsDetected),
		zap.Int64("seq_gap_ticks_missing", v.seqGapsTicksMissing),
		zap.Any("failed_reasons", v.failed),
	)

	if passRate < 95.0 {
		v.logger.Warn("validation pass rate below 95% - check exchange simulator output")
	}

	if v.seqGapsDetected > 0 {
		v.logger.Warn("sequence gap events detected - ensure masking is handled downstream",
			zap.Int64("events", v.seqGapsDetected),
			zap.Int64("ticks_missing", v.seqGapsTicksMissing),
		)
	}
}
