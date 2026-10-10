package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"syscall"
	"time"

	"github.com/devpush/devpush/agent/internal/agent"
)

func maintenance(args []string) {
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "maintenance requires root")
		os.Exit(1)
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "use maintenance drain, resume, update, or switch")
		os.Exit(1)
	}
	flags := flag.NewFlagSet("maintenance", flag.ExitOnError)
	path := flags.String("config", "/etc/devpush/agent.env", "config path")
	timeout := flags.Duration("timeout", 30*time.Minute, "maximum drain duration; timeout postpones maintenance")
	binary := flags.String("binary", "", "verified replacement binary for update")
	url := flags.String("url", "", "destination HTTPS origin")
	tokenFile := flags.String("token-file", "", "file containing destination enrollment token")
	_ = flags.Parse(args[1:])
	cfg, err := agent.LoadConfig(*path)
	if err == nil {
		lock, lockErr := os.OpenFile(*path+".maintenance.lock", os.O_CREATE|os.O_RDWR, 0600)
		if lockErr != nil {
			fmt.Fprintln(os.Stderr, lockErr)
			os.Exit(1)
		}
		defer lock.Close()
		if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
			fmt.Fprintln(os.Stderr, "another maintenance operation is running")
			os.Exit(1)
		}
		ctx, cancel := context.WithTimeout(context.Background(), *timeout)
		defer cancel()
		ctx = agent.WithMaintenanceProgress(ctx, func(message string) { fmt.Println(message) })
		switch args[0] {
		case "drain":
			err = agent.Drain(ctx, cfg)
		case "resume":
			err = agent.Resume(cfg)
		case "update":
			err = agent.Update(ctx, cfg, *binary)
		case "switch":
			err = agent.SwitchControlPlane(ctx, cfg, *path, *url, *tokenFile)
		default:
			err = fmt.Errorf("unknown maintenance command")
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Maintenance completed.")
}
