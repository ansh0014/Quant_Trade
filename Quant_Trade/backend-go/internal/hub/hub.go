package hub

import (
	"sync"
	"sync/atomic"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
)

type Hub struct {
	mu             sync.RWMutex
	subscribers    map[chan *marketdata.Tick]struct{}
	broadcastCount int64
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[chan *marketdata.Tick]struct{}),
	}
}

func (h *Hub) Subscribe() chan *marketdata.Tick {
	h.mu.Lock()
	defer h.mu.Unlock()

	ch := make(chan *marketdata.Tick, 1024)
	h.subscribers[ch] = struct{}{}
	return ch
}

func (h *Hub) Unsubscribe(ch chan *marketdata.Tick) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.subscribers[ch]; ok {
		delete(h.subscribers, ch)
		close(ch)
	}
}

func (h *Hub) Broadcast(tick *marketdata.Tick) {
	atomic.AddInt64(&h.broadcastCount, 1)

	h.mu.RLock()
	defer h.mu.RUnlock()

	for ch := range h.subscribers {
		select {
		case ch <- tick:
		default:
			// Client buffer is full; skip or handle slow consumer to prevent blocking other consumers
		}
	}
}

func (h *Hub) TotalBroadcasts() int64 {
	return atomic.LoadInt64(&h.broadcastCount)
}



