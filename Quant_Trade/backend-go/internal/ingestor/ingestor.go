package ingestor

import (
	"context"
	"encoding/json"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"github.com/anshul/hft/backend/internal/config"
	"github.com/anshul/hft/backend/internal/hub"
	"github.com/anshul/hft/backend/internal/storage"
	"go.uber.org/zap"
)

type Ingestor struct {
	cfg       config.ExchangeConfig
	symbolMap map[uint16]string
	hub       *hub.Hub
	writer    *storage.ParquetWriter
	validator *TickValidator
	logger    *zap.Logger
}

func NewIngestor(cfg config.ExchangeConfig, symbolMap map[uint16]string, h *hub.Hub, w *storage.ParquetWriter, logger *zap.Logger) *Ingestor {
	// Standard validation thresholds: 500bps spread, 5% max price jump
	validator := NewTickValidator(500.0, 5.0, 0.0, logger)
	return &Ingestor{
		cfg:       cfg,
		symbolMap: symbolMap,
		hub:       h,
		writer:    w,
		validator: validator,
		logger:    logger,
	}
}

func (n *Ingestor) Run(ctx context.Context) {
	client := NewWSClient(n.cfg, n.logger)
	msgChan := client.Start(ctx)

	n.logger.Info("Ingestor background routine started")

	for {
		select {
		case <-ctx.Done():
			n.validator.Report()
			n.logger.Info("Ingestor background routine stopped")
			return
		case msg, ok := <-msgChan:
			if !ok {
				return
			}
			n.processMessage(msg)
		}
	}
}

func (n *Ingestor) processMessage(msg []byte) {
	// Detect message type first to distinguish between ticks and trades
	var meta struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(msg, &meta); err != nil {
		n.logger.Debug("Non-JSON or invalid message envelope received", zap.Error(err))
		return
	}

	if meta.Type == "tick" {
		raw, err := ParseRawTick(msg)
		if err != nil {
			n.logger.Error("Failed to parse raw exchange tick", zap.Error(err))
			return
		}

		symbolStr, exists := n.symbolMap[raw.SymbolID]
		if !exists {
			n.logger.Warn("Received tick with unregistered SymbolID", zap.Uint16("symbol_id", raw.SymbolID))
			return
		}

		// Convert C++ integer scales into standard double/float values
		tick := &marketdata.Tick{
			TimestampNs: raw.TimestampNs,
			Symbol:      symbolStr,
			Bid:         float64(raw.BestBidPrice),
			Ask:         float64(raw.BestAskPrice),
			BidSz:       float64(raw.BestBidQty),
			AskSz:       float64(raw.BestAskQty),
			LastPrice:   float64(raw.LastTradePrice),
			Volume:      float64(raw.Volume),
			Sequence:    raw.Sequence,
			SeqGap:      false,
		}

		res := n.validator.Validate(tick)
		if !res.Valid {
			return // Dropped and logged inside validator
		}

		// Save tick to Parquet storage
		n.writer.Add(tick)

		// Broadcast tick to live subscribers
		n.hub.Broadcast(tick)
	}
}
