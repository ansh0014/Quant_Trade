package marketdata

import (
	"encoding/json"
	"time"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"github.com/anshul/hft/backend/internal/hub"
	"github.com/anshul/hft/backend/internal/storage"
)

type Service struct {
	TickHub   *hub.Hub
	TradeHub  *hub.TradeHub
	Reader    *storage.ParquetReader
	Writer    *storage.ParquetWriter
	StartTime time.Time
}

func New(tickHub *hub.Hub, tradeHub *hub.TradeHub, reader *storage.ParquetReader, writer *storage.ParquetWriter) *Service {
	return &Service{
		TickHub:   tickHub,
		TradeHub:  tradeHub,
		Reader:    reader,
		Writer:    writer,
		StartTime: time.Now(),
	}
}

// TickJSON matches ml/data_gathering/schema.py from_ws_message().
type TickJSON struct {
	Type        string  `json:"type"`
	TimestampNs int64   `json:"timestamp_ns"`
	Symbol      string  `json:"symbol"`
	Bid         float64 `json:"bid"`
	Ask         float64 `json:"ask"`
	BidSz       float64 `json:"bid_sz"`
	AskSz       float64 `json:"ask_sz"`
	LastPrice   float64 `json:"last_price"`
	Volume      float64 `json:"volume"`
	Sequence    int64   `json:"sequence"`
	SeqGap      bool    `json:"seq_gap,omitempty"`
}

type TradeJSON struct {
	Type        string  `json:"type"`
	TimestampNs int64   `json:"timestamp_ns"`
	Symbol      string  `json:"symbol"`
	TradeID     uint64  `json:"trade_id"`
	Price       float64 `json:"price"`
	Quantity    float64 `json:"quantity"`
	BidOrderID  uint64  `json:"bid_order_id"`
	AskOrderID  uint64  `json:"ask_order_id"`
	Sequence    int64   `json:"sequence"`
}

func (s *Service) MarshalTick(t *marketdata.Tick) ([]byte, error) {
	msg := TickJSON{
		Type:        "tick",
		TimestampNs: t.TimestampNs,
		Symbol:      t.Symbol,
		Bid:         t.Bid,
		Ask:         t.Ask,
		BidSz:       t.BidSz,
		AskSz:       t.AskSz,
		LastPrice:   t.LastPrice,
		Volume:      t.Volume,
		Sequence:    t.Sequence,
		SeqGap:      t.SeqGap,
	}
	return json.Marshal(msg)
}

func (s *Service) MarshalTrade(t *hub.Trade) ([]byte, error) {
	msg := TradeJSON{
		Type:        "trade",
		TimestampNs: t.TimestampNs,
		Symbol:      t.Symbol,
		TradeID:     t.TradeID,
		Price:       t.Price,
		Quantity:    t.Quantity,
		BidOrderID:  t.BidOrderID,
		AskOrderID:  t.AskOrderID,
		Sequence:    t.Sequence,
	}
	return json.Marshal(msg)
}

type HealthResponse struct {
	Status      string `json:"status"`
	UptimeS     int64  `json:"uptime_s"`
	TickCount   int64  `json:"tick_count"`
	TradeCount  int64  `json:"trade_count"`
	TicksStored int64  `json:"ticks_stored"`
	Version     string `json:"version"`
}

func (s *Service) Health() HealthResponse {
	return HealthResponse{
		Status:      "ok",
		UptimeS:     int64(time.Since(s.StartTime).Seconds()),
		TickCount:   s.TickHub.TotalBroadcasts(),
		TradeCount:  s.TradeHub.TotalBroadcasts(),
		TicksStored: s.Writer.TotalFlushed(),
		Version:     "1.0.0",
	}
}

func SymbolFilter(symbols []string) map[string]struct{} {
	if len(symbols) == 0 {
		return nil
	}
	m := make(map[string]struct{}, len(symbols))
	for _, sym := range symbols {
		m[sym] = struct{}{}
	}
	return m
}

func MatchesFilter(symbol string, filter map[string]struct{}) bool {
	if filter == nil {
		return true
	}
	_, ok := filter[symbol]
	return ok
}