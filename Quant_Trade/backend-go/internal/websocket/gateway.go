package websocket

import (
	"encoding/json"
	"net/http"
	
	"time"

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
	svc    *mdsvc.Service
	logger *zap.Logger
}

func NewGateway(svc *mdsvc.Service, logger *zap.Logger) *Gateway {
	return &Gateway{svc: svc, logger: logger}
}

type subscribeMsg struct {
	Action  string   `json:"action"`
	Symbols []string `json:"symbols"`
}

func (g *Gateway) readSubscribeFilter(conn *websocket.Conn) map[string]struct{} {
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return nil // no filter = all symbols
	}
	conn.SetReadDeadline(time.Time{})

	var msg subscribeMsg
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Action != "subscribe" {
		return nil
	}
	return mdsvc.SymbolFilter(msg.Symbols)
}
