package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"github.com/anshul/hft/backend/internal/config"
	"github.com/parquet-go/parquet-go"
	"go.uber.org/zap"
)

type ParquetTick struct {
	TimestampNs int64   `parquet:"timestamp_ns,type=INT64"`
	Symbol      string  `parquet:"symbol,type=BYTE_ARRAY,convertedtype=UTF8"`
	Bid         float64 `parquet:"bid,type=DOUBLE"`
	Ask         float64 `parquet:"ask,type=DOUBLE"`
	BidSz       float64 `parquet:"bid_sz,type=DOUBLE"`
	AskSz       float64 `parquet:"ask_sz,type=DOUBLE"`
	LastPrice   float64 `parquet:"last_price,type=DOUBLE"`
	Volume      float64 `parquet:"volume,type=DOUBLE"`
	Sequence    int64   `parquet:"sequence,type=INT64"`
	SeqGap      bool    `parquet:"seq_gap,type=BOOLEAN"`
}

type ParquetWriter struct {
	mu             sync.Mutex
	cfg            config.StorageConfig
	buffers        map[string][]ParquetTick
	ticksWritten   map[string]int // symbol -> count in current file
	currentPart    map[string]int // symbol -> part index
	logger         *zap.Logger
	stopChan       chan struct{}
	flushTicker    *time.Ticker
	running        bool
	totalFlushed   int64
	flushQueue     chan map[string][]ParquetTick
	wg             sync.WaitGroup
}

func NewParquetWriter(cfg config.StorageConfig, logger *zap.Logger) *ParquetWriter {
	return &ParquetWriter{
		cfg:          cfg,
		buffers:      make(map[string][]ParquetTick),
		ticksWritten: make(map[string]int),
		currentPart:  make(map[string]int),
		logger:       logger,
		stopChan:     make(chan struct{}),
		flushQueue:   make(chan map[string][]ParquetTick, 1000),
	}
}

func (w *ParquetWriter) Start() {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	// Start background writer worker
	w.wg.Add(1)
	go w.writerWorker()

	w.flushTicker = time.NewTicker(time.Duration(w.cfg.FlushIntervalS * float64(time.Second)))
	go func() {
		for {
			select {
			case <-w.flushTicker.C:
				w.Flush()
			case <-w.stopChan:
				return
			}
		}
	}()
}

func (w *ParquetWriter) Stop() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	w.running = false
	w.mu.Unlock()

	if w.flushTicker != nil {
		w.flushTicker.Stop()
	}
	close(w.stopChan)
	close(w.flushQueue)

	// Wait for background worker to flush queue
	w.wg.Wait()

	// Final sync flush
	w.FlushSync()
}

// Add appends a tick to the in-memory buffer.
// Locking is minimal: it only locks to append to the map/slice.
func (w *ParquetWriter) Add(tick *marketdata.Tick) {
	w.mu.Lock()
	pt := ParquetTick{
		TimestampNs: tick.TimestampNs,
		Symbol:      tick.Symbol,
		Bid:         tick.Bid,
		Ask:         tick.Ask,
		BidSz:       tick.BidSz,
		AskSz:       tick.AskSz,
		LastPrice:   tick.LastPrice,
		Volume:      tick.Volume,
		Sequence:    tick.Sequence,
		SeqGap:      tick.SeqGap,
	}

	w.buffers[tick.Symbol] = append(w.buffers[tick.Symbol], pt)
	w.totalFlushed++

	var totalBuffered int
	for _, buf := range w.buffers {
		totalBuffered += len(buf)
	}

	if totalBuffered >= w.cfg.BufferSize {
		w.triggerFlush()
	}
	w.mu.Unlock()
}

// Flush triggers an asynchronous flush of all buffers.
func (w *ParquetWriter) Flush() {
	w.mu.Lock()
	w.triggerFlush()
	w.mu.Unlock()
}

// triggerFlush extracts buffers and pushes them to the queue without holding the lock.
// Caller MUST hold w.mu lock.
func (w *ParquetWriter) triggerFlush() {
	snapshot := make(map[string][]ParquetTick)
	for symbol, ticks := range w.buffers {
		if len(ticks) > 0 {
			snapshot[symbol] = ticks
			w.buffers[symbol] = nil
		}
	}

	if len(snapshot) > 0 {
		select {
		case w.flushQueue <- snapshot:
		default:
			w.logger.Warn("ParquetWriter flush queue full, blocking till free space available")
			w.flushQueue <- snapshot
		}
	}
}

// FlushSync performs a synchronous flush (used during shutdown).
func (w *ParquetWriter) FlushSync() {
	w.mu.Lock()
	snapshot := make(map[string][]ParquetTick)
	for symbol, ticks := range w.buffers {
		if len(ticks) > 0 {
			snapshot[symbol] = ticks
			w.buffers[symbol] = nil
		}
	}
	w.mu.Unlock()

	if len(snapshot) > 0 {
		w.processFlushSnapshot(snapshot)
	}
}

func (w *ParquetWriter) writerWorker() {
	defer w.wg.Done()
	for snapshot := range w.flushQueue {
		w.processFlushSnapshot(snapshot)
	}
}

func (w *ParquetWriter) processFlushSnapshot(snapshot map[string][]ParquetTick) {
	for symbol, ticks := range snapshot {
		byDate := make(map[string][]ParquetTick)
		for _, t := range ticks {
			dateStr := time.Unix(0, t.TimestampNs).UTC().Format("20060102")
			byDate[dateStr] = append(byDate[dateStr], t)
		}

		for dateStr, dateTicks := range byDate {
			err := w.writeToParquet(symbol, dateStr, dateTicks)
			if err != nil {
				w.logger.Error("Failed to write Parquet file",
					zap.String("symbol", symbol),
					zap.String("date", dateStr),
					zap.Error(err),
				)
			}
		}
	}
}

func (w *ParquetWriter) writeToParquet(symbol, dateStr string, ticks []ParquetTick) error {
	key := fmt.Sprintf("%s_%s", symbol, dateStr)

	dir := filepath.Join(w.cfg.OutputDir, symbol, dateStr)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	partIdx := w.currentPart[key]
	filePath := filepath.Join(dir, fmt.Sprintf("part_%04d.parquet", partIdx))

	var existingTicks []ParquetTick
	if _, err := os.Stat(filePath); err == nil {
		existingTicks, err = w.readParquetFile(filePath)
		if err != nil {
			w.logger.Warn("Failed to read existing Parquet file for append, creating new one", zap.Error(err))
			existingTicks = nil
		}
	}

	allTicks := append(existingTicks, ticks...)
	w.ticksWritten[key] = len(allTicks)

	if len(allTicks) > w.cfg.MaxFileTicks {
		keepTicks := allTicks[:w.cfg.MaxFileTicks]
		spillTicks := allTicks[w.cfg.MaxFileTicks:]

		if err := w.writeFreshParquet(filePath, keepTicks); err != nil {
			return err
		}

		w.currentPart[key]++
		partIdx = w.currentPart[key]
		filePath = filepath.Join(dir, fmt.Sprintf("part_%04d.parquet", partIdx))
		w.ticksWritten[key] = len(spillTicks)

		return w.writeFreshParquet(filePath, spillTicks)
	}

	return w.writeFreshParquet(filePath, allTicks)
}

func (w *ParquetWriter) writeFreshParquet(path string, ticks []ParquetTick) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	writer := parquet.NewWriter(f, parquet.SchemaOf(ParquetTick{}))
	for _, t := range ticks {
		if err := writer.Write(t); err != nil {
			writer.Close()
			return err
		}
	}

	return writer.Close()
}

func (w *ParquetWriter) readParquetFile(path string) (ticks []ParquetTick, retErr error) {
	// Guard: parquet.NewReader panics on empty/truncated files — recover gracefully.
	defer func() {
		if r := recover(); r != nil {
			w.logger.Warn("Corrupted parquet file detected, will overwrite",
				zap.String("path", path),
				zap.Any("panic", r),
			)
			ticks = nil
			retErr = fmt.Errorf("corrupted parquet file: %v", r)
		}
	}()

	// Skip files that are too small to be a valid parquet file (magic bytes = 4 bytes header + 4 bytes footer).
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() < 12 {
		return nil, fmt.Errorf("parquet file too small (%d bytes), skipping", info.Size())
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := parquet.NewReader(f, parquet.SchemaOf(ParquetTick{}))
	defer reader.Close()

	for {
		var t ParquetTick
		if err := reader.Read(&t); err != nil {
			break
		}
		ticks = append(ticks, t)
	}
	return ticks, nil
}

func (w *ParquetWriter) TotalFlushed() int64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.totalFlushed
}
