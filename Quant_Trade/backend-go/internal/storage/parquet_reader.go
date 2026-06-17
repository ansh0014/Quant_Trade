package storage

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/anshul/hft/backend/generated/proto/marketdata"
	"github.com/anshul/hft/backend/internal/config"
	"github.com/parquet-go/parquet-go"
)

type ParquetReader struct {
	cfg config.StorageConfig
}

func NewParquetReader(cfg config.StorageConfig) *ParquetReader {
	return &ParquetReader{
		cfg: cfg,
	}
}

func (r *ParquetReader) GetTicks(symbol string, startNs, endNs int64, maxRows int32) ([]*marketdata.Tick, error) {
	symbolDir := filepath.Join(r.cfg.OutputDir, symbol)
	if _, err := os.Stat(symbolDir); os.IsNotExist(err) {
		return nil, nil // No data recorded for this symbol
	}

	// 1. Find and sort date directories (YYYYMMDD)
	dateDirs, err := os.ReadDir(symbolDir)
	if err != nil {
		return nil, err
	}

	var dates []string
	for _, entry := range dateDirs {
		if entry.IsDir() {
			dates = append(dates, entry.Name())
		}
	}
	sort.Strings(dates)

	var ticks []*marketdata.Tick
	count := int32(0)

	// 2. Scan parquet files in date order
	for _, dateStr := range dates {
		if maxRows > 0 && count >= maxRows {
			break
		}

		dateDir := filepath.Join(symbolDir, dateStr)
		files, err := os.ReadDir(dateDir)
		if err != nil {
			continue
		}

		var fileNames []string
		for _, entry := range files {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".parquet") {
				fileNames = append(fileNames, entry.Name())
			}
		}
		sort.Strings(fileNames)

		for _, fileName := range fileNames {
			if maxRows > 0 && count >= maxRows {
				break
			}

			filePath := filepath.Join(dateDir, fileName)
			fileTicks, err := r.readFile(filePath)
			if err != nil {
				continue // skip corrupt files
			}

			for _, t := range fileTicks {
				if t.TimestampNs >= startNs && (endNs == 0 || t.TimestampNs <= endNs) {
					ticks = append(ticks, t)
					count++
					if maxRows > 0 && count >= maxRows {
						break
					}
				}
			}
		}
	}

	return ticks, nil
}

func (r *ParquetReader) readFile(path string) ([]*marketdata.Tick, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := parquet.NewReader(f, parquet.SchemaOf(ParquetTick{}))
	defer reader.Close()

	var ticks []*marketdata.Tick
	for {
		var pt ParquetTick
		err := reader.Read(&pt)
		if err != nil {
			break
		}
		ticks = append(ticks, &marketdata.Tick{
			TimestampNs: pt.TimestampNs,
			Symbol:      pt.Symbol,
			Bid:         pt.Bid,
			Ask:         pt.Ask,
			BidSz:       pt.BidSz,
			AskSz:       pt.AskSz,
			LastPrice:   pt.LastPrice,
			Volume:      pt.Volume,
			Sequence:    pt.Sequence,
			SeqGap:      pt.SeqGap,
		})
	}
	return ticks, nil
}
