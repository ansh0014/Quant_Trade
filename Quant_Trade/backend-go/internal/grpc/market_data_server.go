package grpc

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"github.com/anshul/hft/backend/internal/hub"
	"github.com/anshul/hft/backend/internal/storage"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

type Server struct {
	marketdata.UnimplementedMarketDataServiceServer
	port       int
	hub        *hub.Hub
	reader     *storage.ParquetReader
	writer     *storage.ParquetWriter
	logger     *zap.Logger
	server     *grpc.Server
	startTime  time.Time
}

func NewServer(port int, h *hub.Hub, r *storage.ParquetReader, w *storage.ParquetWriter, logger *zap.Logger) *Server {
	return &Server{
		port:      port,
		hub:       h,
		reader:    r,
		writer:    w,
		logger:    logger,
		startTime: time.Now(),
	}
}

func (s *Server) Start() {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
	if err != nil {
		s.logger.Fatal("Failed to listen on gRPC port", zap.Int("port", s.port), zap.Error(err))
	}

	s.server = grpc.NewServer()
	marketdata.RegisterMarketDataServiceServer(s.server, s)

	s.logger.Info("gRPC MarketDataService started", zap.Int("port", s.port))
	if err := s.server.Serve(lis); err != nil {
		s.logger.Error("gRPC server error", zap.Error(err))
	}
}

func (s *Server) Stop() {
	if s.server != nil {
		s.server.GracefulStop()
		s.logger.Info("gRPC MarketDataService stopped gracefully")
	}
}

// StreamTicks implements streaming real-time ticks to clients
func (s *Server) StreamTicks(req *marketdata.StreamTicksRequest, stream marketdata.MarketDataService_StreamTicksServer) error {
	s.logger.Info("New client subscribed to live ticks stream", zap.Any("symbols", req.Symbols))

	tickChan := s.hub.Subscribe()
	defer s.hub.Unsubscribe(tickChan)

	// Create a lookup map for filtering symbols
	filterMap := make(map[string]struct{})
	for _, sym := range req.Symbols {
		filterMap[sym] = struct{}{}
	}

	for {
		select {
		case <-stream.Context().Done():
			s.logger.Info("Client disconnected from live ticks stream")
			return stream.Context().Err()
		case tick, ok := <-tickChan:
			if !ok {
				return nil
			}

		
			if len(filterMap) > 0 {
				if _, ok := filterMap[tick.Symbol]; !ok {
					continue
				}
			}

			resp := &marketdata.StreamTicksResponse{
				Tick: tick,
			}

			if err := stream.Send(resp); err != nil {
				s.logger.Error("Failed to send tick to stream client", zap.Error(err))
				return err
			}
		}
	}
}

// GetHistoricalTicks implements historical queries over Parquet storage
func (s *Server) GetHistoricalTicks(ctx context.Context, req *marketdata.GetHistoricalTicksRequest) (*marketdata.GetHistoricalTicksResponse, error) {
	s.logger.Info("Received historical ticks query",
		zap.String("symbol", req.Symbol),
		zap.Int64("start_ns", req.StartNs),
		zap.Int64("end_ns", req.EndNs),
		zap.Int32("max_rows", req.MaxRows),
	)

	ticks, err := s.reader.GetTicks(req.Symbol, req.StartNs, req.EndNs, req.MaxRows)
	if err != nil {
		s.logger.Error("Failed to fetch historical ticks", zap.Error(err))
		return nil, err
	}

	return &marketdata.GetHistoricalTicksResponse{
		Ticks:      ticks,
		TotalCount: int64(len(ticks)),
	}, nil
}

// HealthCheck returns server runtime diagnostics
func (s *Server) HealthCheck(ctx context.Context, req *marketdata.HealthCheckRequest) (*marketdata.HealthCheckResponse, error) {
	uptime := time.Since(s.startTime).Seconds()
	ticksIngested := s.hub.TotalBroadcasts()
	ticksStored := s.writer.TotalFlushed()

	return &marketdata.HealthCheckResponse{
		Status:      "ok",
		UptimeS:     int64(uptime),
		TickCount:   ticksIngested,
		TicksStored: ticksStored,
		Version:     "1.0.0",
	}, nil
}
