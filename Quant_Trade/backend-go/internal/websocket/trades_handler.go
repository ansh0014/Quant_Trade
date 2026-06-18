package websocket

import (
	"net/http"
	"sync"
	"time"

	"github.com/anshul/hft/backend/internal/hub"
	mdsvc "github.com/anshul/hft/backend/internal/service/marketdata"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

func (g *Gateway) HandleTrades(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		g.logger.Error("ws upgrade failed", zap.String("path", "/ws/trades"), zap.Error(err))
		return
	}
	defer conn.Close()

	filter := g.readSubscribeFilter(conn)
	g.logger.Info("trades client connected", zap.Any("symbols", filterKeys(filter)))

	tradeChan := g.svc.TradeHub.Subscribe()
	defer g.svc.TradeHub.Unsubscribe(tradeChan)

	var writeMu sync.Mutex
	done := make(chan struct{})
	go g.pingLoop(conn, done, &writeMu)

	for {
		select {
		case <-done:
			return
		case trade, ok := <-tradeChan:
			if !ok {
				return
			}
			if !mdsvc.MatchesFilter(trade.Symbol, filter) {
				continue
			}
			if err := g.writeTrade(conn, trade, &writeMu); err != nil {
				g.logger.Debug("trades client disconnected", zap.Error(err))
				close(done)
				return
			}
		}
	}
}

func (g *Gateway) writeTrade(conn *websocket.Conn, trade *hub.Trade, mu *sync.Mutex) error {
	payload, err := g.svc.MarshalTrade(trade)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, payload)
}

func (g *Gateway) pingLoop(conn *websocket.Conn, done <-chan struct{}, mu *sync.Mutex) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			mu.Lock()
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			err := conn.WriteMessage(websocket.PingMessage, nil)
			mu.Unlock()
			if err != nil {
				return
			}
		}
	}
}