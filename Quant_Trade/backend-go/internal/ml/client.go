package ml

import (
	"context"
	"time"

	"github.com/anshul/hft/backend/generated/proto/prediction"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials/insecure"
)

// Client wraps the gRPC prediction client with connection resilience.
type Client struct {
	addr   string
	conn   *grpc.ClientConn
	stub   prediction.PredictionServiceClient
	logger *zap.Logger
}

// NewClient dials the ML predictor and returns a ready-to-use Client.
// addr example: "hft-ml-predictor-svc:50051"
func NewClient(addr string, logger *zap.Logger) (*Client, error) {
	conn, err := grpc.NewClient(
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, err
	}
	return &Client{
		addr:   addr,
		conn:   conn,
		stub:   prediction.NewPredictionServiceClient(conn),
		logger: logger,
	}, nil
}

// IsReady returns true when the underlying gRPC connection is usable.
func (c *Client) IsReady() bool {
	if c.conn == nil {
		return false
	}
	s := c.conn.GetState()
	return s == connectivity.Ready || s == connectivity.Idle || s == connectivity.Connecting
}

// Predict sends bid/ask/bid_sz/ask_sz to the ML service and returns the response.
// It uses a short timeout so the hot-path is never blocked.
func (c *Client) Predict(symbol string, bid, ask, bidSz, askSz float64, tsNs int64) (*prediction.PredictionResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	req := &prediction.PredictionRequest{
		Symbol:      symbol,
		Features:    []float64{bid, ask, bidSz, askSz},
		TimestampNs: tsNs,
	}

	resp, err := c.stub.Predict(ctx, req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// Close shuts down the underlying gRPC connection.
func (c *Client) Close() {
	if c.conn != nil {
		_ = c.conn.Close()
	}
}
