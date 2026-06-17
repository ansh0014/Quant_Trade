package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/anshul/hft/backend/internal/config"
	"github.com/anshul/hft/backend/internal/grpc"
	"github.com/anshul/hft/backend/internal/hub"
	"github.com/anshul/hft/backend/internal/ingestor"
	"github.com/anshul/hft/backend/internal/storage"
	"github.com/anshul/hft/backend/internal/websocket"
	"go.uber.org/zap"
)

func main() {
	configPath := flag.String("config", "configs/dev.yaml", "path to config file")
	flag.Parse()

	// 1. Initialize Logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// 2. Load Config
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Fatal("Failed to load config", zap.Error(err))
	}

	// 3. Create Hub & Storage
	hub := hub.NewHub()
	writer := storage.NewParquetWriter(cfg.Storage, logger)
	reader := storage.NewParquetReader(cfg.Storage)

	// 4. Start Storage Writer
	writer.Start()

	// 5. Start Ingestor (Client connecting to C++ simulator)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ingest := ingestor.NewIngestor(cfg.Exchange, cfg.SymbolMap, hub, writer, logger)
	go ingest.Run(ctx)

	// 6. Start gRPC Server (StreamTicks / GetHistoricalTicks)
	grpcServer := grpc.NewServer(cfg.Server.GRPCPort, hub, reader, logger)
	go grpcServer.Start()

	// 7. Start WebSocket HTTP Gateway (/ws/market-data)
	wsGateway := websocket.NewGateway(cfg.Server.WSPort, hub, logger)
	go wsGateway.Start()

	// 8. Graceful Shutdown block
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutdown signal received, cleaning up...")
	cancel()          // Stop ingestor
	grpcServer.Stop() // Stop gRPC connections
	wsGateway.Stop()  // Stop WS connections
	writer.Stop()     // Flush memory and close Parquet files cleanly
}
