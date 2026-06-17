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
}

func NewParquetWriter(cfg config.StorageConfig, logger *zap.Logger) *ParquetWriter {
	return &ParquetWriter{
		cfg:          cfg,
		buffers:      make(map[string][]ParquetTick),
		ticksWritten: make(map[string]int),
		currentPart:  make(map[string]int),
		logger:       logger,
		stopChan:     make(chan struct{}),
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

	// Final flush to ensure no ticks are left in buffer
	w.Flush()
}

func (w *ParquetWriter) Add(tick *marketdata.Tick) {
	w.mu.Lock()
	defer w.mu.Unlock()

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

	// If buffer size limit exceeded, trigger immediate flush for this symbol in a non-blocking way
	var totalBuffered int
	for _, buf := range w.buffers {
		totalBuffered += len(buf)
	}

	if totalBuffered >= w.cfg.BufferSize {
		go w.Flush()
	}
}

func (w *ParquetWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()

	for symbol, ticks := range w.buffers {
		if len(ticks) == 0 {
			continue
		}

		// Partition ticks by date (YYYYMMDD) based on exchange timestamp
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

		// Clear buffer for this symbol
		w.buffers[symbol] = nil
	}
}

func (w *ParquetWriter) writeToParquet(symbol, dateStr string, ticks []ParquetTick) error {
	key := fmt.Sprintf("%s_%s", symbol, dateStr)

	// Determine output directory
	dir := filepath.Join(w.cfg.OutputDir, symbol, dateStr)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	partIdx := w.currentPart[key]
	filePath := filepath.Join(dir, fmt.Sprintf("part_%04d.parquet", partIdx))

	// Check if file exists to determine if we append or create fresh
	var f *os.File
	var err error
	var writer *parquet.Writer

	// Wait, parquet-go doesn't support appending easily to an existing closed file because of footer blocks.
	// So we will open a new part or recreate it. In case we write to an existing part in the same run,
	// we keep it open, or we write it. Wait! Since we flush periodically, we might write to the same part multiple times.
	// A simple and reliable way is: read existing file, append new ticks, write new file (since buffer sizes are moderate).
	// However, if the file already has 400,000 ticks, loading and rewriting is simple, but we must make sure we don't exceed max_file_ticks.
	// Let's implement this by writing new parts or accumulating in memory. Or even better: open in append mode if supported, or read-rewrite.
	// Since max_file_ticks is 500,000, read-rewrite is safe and robust, or we can just start a new part index when the counter rolls over!
	
	var existingTicks []ParquetTick
	if _, err := os.Stat(filePath); err == nil {
		// Read existing ticks
		existingTicks, err = w.readParquetFile(filePath)
		if err != nil {
			w.logger.Warn("Failed to read existing Parquet file for append, creating new one", zap.Error(err))
			existingTicks = nil
		}
	}

	allTicks := append(existingTicks, ticks...)
	w.ticksWritten[key] = len(allTicks)

	// Check rotation
	if len(allTicks) > w.cfg.MaxFileTicks {
		// We exceed the max limit! Split the ticks.
		keepTicks := allTicks[:w.cfg.MaxFileTicks]
		spillTicks := allTicks[w.cfg.MaxFileTicks:]

		// Write current file up to limit
		err = w.writeFreshParquet(filePath, keepTicks)
		if err != nil {
			return err
		}

		// Rotate!
		w.currentPart[key]++
		partIdx = w.currentPart[key]
		filePath = filepath.Join(dir, fmt.Sprintf("part_%04d.parquet", partIdx))
		w.ticksWritten[key] = len(spillTicks)

		// Write the spilled ticks to the new file
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

func (w *ParquetWriter) readParquetFile(path string) ([]ParquetTick, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := parquet.NewReader(f, parquet.SchemaOf(ParquetTick{}))
	defer reader.Close()

	var ticks []ParquetTick
	for {
		var t ParquetTick
		err := reader.Read(&t)
		if err != nil {
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

