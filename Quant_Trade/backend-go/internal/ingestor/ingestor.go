package ingestor

import (
	"context"
	"encoding/json"


	"github.com/anshul/hft/backend/internal/config"
	"github.com/anshul/hft/backend/internal/hub"
	"github.com/anshul/hft/backend/internal/storage"
	"go.uber.org/zap"
)

type Ingestor struct {
	cfg       config.ExchangeConfig
	symbolMap map[uint16]string
	hub       *hub.Hub
	tradeHub  *hub.TradeHub         
	writer    *storage.ParquetWriter
	validator *TickValidator
	logger    *zap.Logger
}

func NewIngestor(cfg config.ExchangeConfig, symbolMap map[uint16]string,
	h *hub.Hub, th *hub.TradeHub, w *storage.ParquetWriter, logger *zap.Logger) *Ingestor {
	validator := NewTickValidator(500.0, 5.0, 0.0, logger)
	return &Ingestor{
		cfg:       cfg,
		symbolMap: symbolMap,
		hub:       h,
		tradeHub:  th,
		writer:    w,
		validator: validator,
		logger:    logger,
	}
}

func (n *Ingestor) Run(ctx context.Context) {

}

func (n *Ingestor) processMessage(msg []byte) {
	var meta struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(msg, &meta); err != nil {
		n.logger.Debug("Non-JSON or invalid message envelope received", zap.Error(err))
		return
	}

	if meta.Type == "tick" {
	}

	if meta.Type == "trade" {          
		raw, err := ParseRawTrade(msg)
		if err != nil {
			n.logger.Error("Failed to parse raw exchange trade", zap.Error(err))
			return
		}
		symbolStr, exists := n.symbolMap[raw.SymbolID]
		if !exists {
			n.logger.Warn("Received trade with unregistered SymbolID", zap.Uint16("symbol_id", raw.SymbolID))
			return
		}
		trade := &hub.Trade{
			TimestampNs: raw.TimestampNs,
			Symbol:      symbolStr,
			TradeID:     raw.TradeID,
			Price:       float64(raw.Price),
			Quantity:    float64(raw.Quantity),
			BidOrderID:  raw.BidOrderID,
			AskOrderID:  raw.AskOrderID,
			Sequence:    raw.Sequence,
		}
		n.tradeHub.Broadcast(trade)
	}
}