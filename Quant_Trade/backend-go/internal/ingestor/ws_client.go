package ingestor

import (
	"context"
	"encoding/json"
	"net/url"
	"time"

	"github.com/anshul/hft/backend/internal/config"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type RawExchangeTick struct {
	Type           string `json:"type"`
	SymbolID       uint16 `json:"symbol_id"`
	TimestampNs    int64  `json:"timestamp_ns"`
	BestBidPrice   uint32 `json:"bid"`
	BestAskPrice   uint32 `json:"ask"`
	BestBidQty     uint32 `json:"bid_sz"`
	BestAskQty     uint32 `json:"ask_sz"`
	LastTradePrice uint32 `json:"last_price"`
	Volume         uint32 `json:"volume"`
	Sequence       int64  `json:"sequence"`
}

type WSClient struct {
	cfg        config.ExchangeConfig
	logger     *zap.Logger
	msgChan    chan []byte
	disconnect chan struct{}
}

func NewWSClient(cfg config.ExchangeConfig, logger *zap.Logger) *WSClient {
	return &WSClient{
		cfg:        cfg,
		logger:     logger,
		msgChan:    make(chan []byte, 10000),
		disconnect: make(chan struct{}),
	}
}

func (c *WSClient) Start(ctx context.Context) <-chan []byte {
	go c.connectLoop(ctx)
	return c.msgChan
}

func (c *WSClient) connectLoop(ctx context.Context) {
	u, err := url.Parse(c.cfg.WSURL)
	if err != nil {
		c.logger.Error("Invalid exchange WS URL", zap.String("url", c.cfg.WSURL), zap.Error(err))
		return
	}

	delay := time.Duration(c.cfg.ReconnectDelayS * float64(time.Second))
	maxDelay := time.Duration(c.cfg.MaxReconnectDelayS * float64(time.Second))

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		c.logger.Info("Connecting to exchange simulator WebSocket", zap.String("url", u.String()))
		conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if err != nil {
			c.logger.Warn("Failed to connect to exchange, retrying...", zap.Error(err), zap.Duration("delay", delay))
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
				delay = c.backoff(delay, maxDelay)
				continue
			}
		}

		c.logger.Info("Connected to exchange simulator WebSocket successfully")
		delay = time.Duration(c.cfg.ReconnectDelayS * float64(time.Second)) // Reset delay on successful connection

		// Start reading messages
		c.readMessages(ctx, conn)

		c.logger.Warn("Connection closed, scheduled for reconnect")
	}
}

func (c *WSClient) readMessages(ctx context.Context, conn *websocket.Conn) {
	defer conn.Close()

	// Handle close signal from context
	go func() {
		<-ctx.Done()
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		conn.Close()
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			c.logger.Error("Read error from exchange WebSocket", zap.Error(err))
			return
		}

		select {
		case <-ctx.Done():
			return
		case c.msgChan <- message:
		default:
			// Buffer full, drop message to prevent blocking low latency loop
			c.logger.Warn("Ingest message channel full, dropping incoming exchange message")
		}
	}
}

func (c *WSClient) backoff(current, max time.Duration) time.Duration {
	next := current * 2
	if next > max {
		return max
	}
	return next
}

func ParseRawTick(data []byte) (*RawExchangeTick, error) {
	var tick RawExchangeTick
	err := json.Unmarshal(data, &tick)
	return &tick, err
}
