package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/devpush/devpush/agent/internal/agent"
)

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "credential" && os.Args[2] == "rotate" {
		rotateCredential(os.Args[3:])
		return
	}

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

func rotateCredential(args []string) {
	if os.Geteuid() != 0 {
		slog.Error("credential rotation must be run as root", "hint", "use sudo devpush-agent credential rotate")
		os.Exit(1)
	}

	flags := flag.NewFlagSet("credential rotate", flag.ExitOnError)
	configPath := flags.String("config", "/etc/devpush/agent.env", "agent config path")
	if err := flags.Parse(args); err != nil {
		slog.Error("failed to parse command", "error", err)
		os.Exit(1)
	}

	cfg, err := agent.LoadConfig(*configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	runner := agent.NewRunner(cfg, slog.Default())
	if err := runner.RotateCredential(ctx); err != nil {
		slog.Error("failed to rotate credential", "error", err)
		os.Exit(1)
	}
	if err := exec.Command("systemctl", "restart", "devpush-agent").Run(); err != nil {
		slog.Error("credential rotated but agent restart failed", "error", err, "hint", "run systemctl restart devpush-agent")
		os.Exit(1)
	}
}

func init() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	time.Local = time.UTC
}
