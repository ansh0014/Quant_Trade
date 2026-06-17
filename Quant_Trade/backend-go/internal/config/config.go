package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type ServerConfig struct {
	GRPCPort int `yaml:"grpc_port"`
	WSPort   int `yaml:"ws_port"`
}

type ExchangeConfig struct {
	WSURL              string  `yaml:"ws_url"`
	ReconnectDelayS    float64 `yaml:"reconnect_delay_s"`
	MaxReconnectDelayS float64 `yaml:"max_reconnect_delay_s"`
}

type StorageConfig struct {
	OutputDir      string  `yaml:"output_dir"`
	BufferSize     int     `yaml:"buffer_size"`
	FlushIntervalS float64 `yaml:"flush_interval_s"`
	MaxFileTicks   int     `yaml:"max_file_ticks"`
}

type LoggingConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

type Config struct {
	Server    ServerConfig          `yaml:"server"`
	Exchange  ExchangeConfig        `yaml:"exchange"`
	Storage   StorageConfig         `yaml:"storage"`
	SymbolMap map[uint16]string     `yaml:"symbol_map"`
	Logging   LoggingConfig         `yaml:"logging"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
