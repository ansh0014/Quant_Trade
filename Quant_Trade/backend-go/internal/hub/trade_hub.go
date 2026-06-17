package hub

import (
	"sync"
	"sync/atomic"
)


type Trade struct {
	TimestampNs int64   `json:"timestamp_ns"`
	Symbol      string  `json:"symbol"`
	TradeID     uint64  `json:"trade_id"`
	Price       float64 `json:"price"`
	Quantity    float64 `json:"quantity"`
	BidOrderID  uint64  `json:"bid_order_id"`
	AskOrderID  uint64  `json:"ask_order_id"`
	Sequence    int64   `json:"sequence"`
}

type TradeHub struct {
	mu             sync.RWMutex
	subscribers    map[chan *Trade]struct{}
	broadcastCount int64
}

func NewTradeHub() *TradeHub {
	return &TradeHub{
		subscribers: make(map[chan *Trade]struct{}),
	}
}

func (h *TradeHub) Subscribe() chan *Trade {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan *Trade, 1024)
	h.subscribers[ch] = struct{}{}
	return ch
}

func (h *TradeHub) Unsubscribe(ch chan *Trade) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subscribers[ch]; ok {
		delete(h.subscribers, ch)
		close(ch)
	}
}

func (h *TradeHub) Broadcast(trade *Trade) {
	atomic.AddInt64(&h.broadcastCount, 1)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers {
		select {
		case ch <- trade:
		default:
		}
	}
}

func (h *TradeHub) TotalBroadcasts() int64 {
	return atomic.LoadInt64(&h.broadcastCount)
}