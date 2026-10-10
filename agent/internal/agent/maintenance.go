package agent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type maintenanceProgressKey struct{}

// WithMaintenanceProgress reports operator-facing phases without credentials.
func WithMaintenanceProgress(ctx context.Context, report func(string)) context.Context {
	return context.WithValue(ctx, maintenanceProgressKey{}, report)
}

func maintenanceProgress(ctx context.Context, message string) {
	if report, ok := ctx.Value(maintenanceProgressKey{}).(func(string)); ok {
		report(message)
	}
}

const drainFile = "maintenance-drain"
const jobLockFile = "maintenance-job.lock"

// The lock covers claiming, execution and durable completion delivery.
func (runner *Runner) lockJob() (*os.File, error) {
	if err := os.MkdirAll(runner.cfg.StateDir, 0750); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(runner.cfg.StateDir, jobLockFile), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	if _, err = os.Stat(filepath.Join(runner.cfg.StateDir, drainFile)); !errors.Is(err, os.ErrNotExist) {
		unlockJob(f)
		return nil, errors.New("agent is draining")
	}
	return f, nil
}

func unlockJob(f *os.File) { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }

// Drain does not cancel a job or heartbeat. Failure restores normal job claiming.
func Drain(ctx context.Context, cfg Config) error {
	marker := filepath.Join(cfg.StateDir, drainFile)
	if err := os.WriteFile(marker, []byte("draining\n"), 0600); err != nil {
		return err
	}
	maintenanceProgress(ctx, "New job claims paused. Waiting for active work and completion acknowledgement; heartbeats continue.")
	success := false
	defer func() {
		if !success {
			_ = os.Remove(marker)
		}
	}()
	f, err := os.OpenFile(filepath.Join(cfg.StateDir, jobLockFile), os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("running agent does not support safe draining: %w", err)
	}
	defer f.Close()
	for {
		err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			return err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("maintenance postponed; active work continues and job claiming resumes: %w", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	maintenanceProgress(ctx, "Active work finished. Confirming pending completion reports...")
	runner := NewRunner(cfg, nil)
	if err := runner.loadCredential(); err != nil {
		return err
	}
	if err := runner.flushPendingCompletions(ctx); err != nil {
		return fmt.Errorf("maintenance postponed; agent remains running and job claiming resumes: %w", err)
	}
	maintenanceProgress(ctx, "Drain complete; completion reports acknowledged.")
	success = true
	return nil
}

func Resume(cfg Config) error {
	err := os.Remove(filepath.Join(cfg.StateDir, drainFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
