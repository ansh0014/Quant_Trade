package http

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	mdsvc "github.com/anshul/hft/backend/internal/service/marketdata"
	"github.com/anshul/hft/backend/internal/websocket"
	"go.uber.org/zap"
)

type Server struct {
	port    int
	svc     *mdsvc.Service
	logger  *zap.Logger
	httpSrv *http.Server
}

func NewServer(port int, svc *mdsvc.Service, logger *zap.Logger) *Server {
	return &Server{
		port:   port,
		svc:    svc,
		logger: logger,
	}
}

func (s *Server) Start() {
	mux := http.NewServeMux()

	gw := websocket.NewGateway(s.svc, s.logger)
	mux.HandleFunc("/ws/market-data", gw.HandleMarketData)
	mux.HandleFunc("/ws/trades", gw.HandleTrades)

	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ready", s.handleReady)

	s.httpSrv = &http.Server{
		Addr:              fmt.Sprintf(":%d", s.port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	s.logger.Info("HTTP gateway started",
		zap.Int("port", s.port),
		zap.Strings("routes", []string{"/ws/market-data", "/ws/trades", "/health", "/ready"}),
	)

	if err := s.httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		s.logger.Error("HTTP server error", zap.Error(err))
	}
}

func (s *Server) Stop(ctx context.Context) {
	if s.httpSrv == nil {
		return
	}
	if err := s.httpSrv.Shutdown(ctx); err != nil {
		s.logger.Error("HTTP server shutdown error", zap.Error(err))
	}
	s.logger.Info("HTTP gateway stopped")
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.svc.Health())
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}