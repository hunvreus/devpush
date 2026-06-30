package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/devpush/devpush/agent/internal/agent"
)

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", "/etc/devpush/agent.env", "agent config path")
	flag.Parse()

	cfg, err := agent.LoadConfig(configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	runner := agent.NewRunner(cfg, slog.Default())
	if err := runner.Run(ctx); err != nil {
		slog.Error("agent stopped", "error", err)
		os.Exit(1)
	}
}

func init() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	time.Local = time.UTC
}
