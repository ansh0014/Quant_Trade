package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/anshul/hft/backend/internal/config"
	"github.com/anshul/hft/backend/internal/grpc"
	"github.com/anshul/hft/backend/internal/hub"
	httpserver "github.com/anshul/hft/backend/internal/http"
	"github.com/anshul/hft/backend/internal/ingestor"
	mdsvc "github.com/anshul/hft/backend/internal/service/marketdata"
	"github.com/anshul/hft/backend/internal/storage"
	"go.uber.org/zap"
)

func main() {
	configPath := flag.String("config", "configs/dev.yaml", "path to config file")
	flag.Parse()

	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Fatal("Failed to load config", zap.Error(err))
	}

	tickHub := hub.NewHub()
	tradeHub := hub.NewTradeHub()
	writer := storage.NewParquetWriter(cfg.Storage, logger)
	reader := storage.NewParquetReader(cfg.Storage)
	svc := mdsvc.New(tickHub, tradeHub, reader, writer)

	writer.Start()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ingest := ingestor.NewIngestor(cfg.Exchange, cfg.SymbolMap, tickHub, tradeHub, writer, logger)
	go ingest.Run(ctx)

	grpcServer := grpc.NewServer(cfg.Server.GRPCPort, tickHub, reader, writer, logger)
	go grpcServer.Start()

	httpServer := httpserver.NewServer(cfg.Server.WSPort, svc, logger)
	go httpServer.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutdown signal received, cleaning up...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	httpServer.Stop(shutdownCtx)
	grpcServer.Stop()
	writer.Stop()
}