package websocket

import (
	"encoding/json"
	"net/http"
	"time"

	mlpkg "github.com/anshul/hft/backend/internal/ml"
	mdsvc "github.com/anshul/hft/backend/internal/service/marketdata"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true }, // dev only
}

type Gateway struct {
	svc      *mdsvc.Service
	mlClient *mlpkg.Client
	mlHub    *mlpkg.PredictionHub
	logger   *zap.Logger
}

func NewGateway(svc *mdsvc.Service, mlClient *mlpkg.Client, mlHub *mlpkg.PredictionHub, logger *zap.Logger) *Gateway {
	return &Gateway{svc: svc, mlClient: mlClient, mlHub: mlHub, logger: logger}
}

type subscribeMsg struct {
	Action  string   `json:"action"`
	Symbols []string `json:"symbols"`
}

// readSubscribeFilter checks quickly for {"action":"subscribe","symbols":["AAPL"]}.
// Returns nil if no subscription message arrives → streams all symbols without delay.
func (g *Gateway) readSubscribeFilter(conn *websocket.Conn) map[string]struct{} {
	defer conn.SetReadDeadline(time.Time{})
	conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return nil
	}

	var msg subscribeMsg
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Action != "subscribe" {
		return nil
	}
	return mdsvc.SymbolFilter(msg.Symbols)
}

// pingLoop sends a WebSocket ping every 20s to keep the connection alive.
func (g *Gateway) pingLoop(conn *websocket.Conn, done chan struct{}, mu interface{ Lock(); Unlock() }) {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			mu.Lock()
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				mu.Unlock()
				return
			}
			mu.Unlock()
		}
	}
}
