package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/devpush/devpush/agent/internal/agent"
)

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "metrics" && os.Args[2] == "resync" {
		metricsResync(os.Args[3:])
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "maintenance" {
		maintenance(os.Args[2:])
		return
	}
	if (len(os.Args) == 2 || len(os.Args) == 3 && os.Args[2] == "--json") && (os.Args[1] == "version" || os.Args[1] == "--version") {
		if err := writeVersion(os.Stdout, len(os.Args) == 3); err != nil {
			slog.Error("write version", "error", err)
			os.Exit(1)
		}
		return
	}

	if len(os.Args) >= 3 && os.Args[1] == "credential" && os.Args[2] == "rotate" {
		rotateCredential(os.Args[3:])
		return
	}

	var configPath string
	var checkConfig bool
	flag.BoolVar(&checkConfig, "check-config", false, "validate configuration and exit")
	flag.StringVar(&configPath, "config", "/etc/devpush/agent.env", "agent config path")
	flag.Parse()

	cfg, err := agent.LoadConfig(configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if checkConfig {
		return
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

	lock, err := os.OpenFile(*configPath+".maintenance.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		slog.Error("open maintenance lock", "error", err)
		os.Exit(1)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		slog.Error("another maintenance operation is running")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if err := agent.Drain(ctx, cfg); err != nil {
		slog.Error("credential rotation postponed", "error", err)
		os.Exit(1)
	}
	defer agent.Resume(cfg)
	runner := agent.NewRunner(cfg, slog.Default())
	if err := runner.RotateCredential(ctx); err != nil {
		_ = agent.Resume(cfg)
		slog.Error("failed to rotate credential", "error", err)
		os.Exit(1)
	}
	if err := exec.Command("systemctl", "restart", "devpush-agent").Run(); err != nil {
		_ = agent.Resume(cfg)
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

func metricsResync(args []string) {
	if os.Geteuid() != 0 {
		slog.Error("metrics resync requires root", "hint", "use sudo devpush-agent metrics resync")
		os.Exit(1)
	}
	flags := flag.NewFlagSet("metrics resync", flag.ExitOnError)
	path := flags.String("config", "/etc/devpush/agent.env", "agent config path")
	_ = flags.Parse(args)
	cfg, err := agent.LoadConfig(*path)
	if err == nil {
		err = agent.RequestMetricsResync(cfg)
	}
	if err != nil {
		slog.Error("request metric resync failed", "error", err)
		os.Exit(1)
	}
	fmt.Println("Metrics resync requested. The running agent will replay retained history on its next heartbeat.")
}
