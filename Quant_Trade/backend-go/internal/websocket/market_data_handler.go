package websocket

import (
	"net/http"
	"sync"
	"time"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	mdsvc "github.com/anshul/hft/backend/internal/service/marketdata"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

func (g *Gateway) HandleMarketData(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		g.logger.Error("ws upgrade failed", zap.String("path", "/ws/market-data"), zap.Error(err))
		return
	}
	defer conn.Close()

	filter := g.readSubscribeFilter(conn)
	g.logger.Info("market-data client connected", zap.Any("symbols", filterKeys(filter)))

	tickChan := g.svc.TickHub.Subscribe()
	defer g.svc.TickHub.Unsubscribe(tickChan)

	var writeMu sync.Mutex
	done := make(chan struct{})
	go g.pingLoop(conn, done, &writeMu)

	for {
		select {
		case <-done:
			return
		case tick, ok := <-tickChan:
			if !ok {
				return
			}
			if !mdsvc.MatchesFilter(tick.Symbol, filter) {
				continue
			}
			if err := g.writeTick(conn, tick, &writeMu); err != nil {
				g.logger.Debug("market-data client disconnected", zap.Error(err))
				close(done)
				return
			}
		}
	}
}

func (g *Gateway) writeTick(conn *websocket.Conn, tick *marketdata.Tick, mu *sync.Mutex) error {
	payload, err := g.svc.MarshalTick(tick)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, payload)
}

func filterKeys(filter map[string]struct{}) []string {
	if filter == nil {
		return nil
	}
	out := make([]string, 0, len(filter))
	for k := range filter {
		out = append(out, k)
	}
	return out
}