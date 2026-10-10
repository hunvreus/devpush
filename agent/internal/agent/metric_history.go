package agent

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const metricHistoryFile = "metric-history.json"
const metricResyncFile = "metric-resync"
const metricBatchSize = 240
const metricHistoryLimit = 3600
const metricRetention = 24 * time.Hour

type metricSample struct {
	ID         string      `json:"id"`
	ObservedAt time.Time   `json:"observedAt"`
	Metrics    hostMetrics `json:"metrics"`
}

type metricHistory struct {
	Samples     []metricSample    `json:"samples"`
	Checkpoints map[string]string `json:"checkpoints"`
	ResyncToken string            `json:"resyncToken,omitempty"`
}

func metricID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

// The CLI writes a marker instead of editing history owned by the heartbeat loop.
// A unique token prevents a request made during an upload from being lost.
func RequestMetricsResync(cfg Config) error {
	token, err := metricID()
	if err != nil {
		return err
	}
	return writeMetricFile(filepath.Join(cfg.StateDir, metricResyncFile), []byte(token))
}

func writeMetricFile(path string, body []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".metric-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return err
	}
	// Root-run commands must leave the marker readable by the service user.
	if os.Geteuid() == 0 {
		directory, err := os.Stat(filepath.Dir(path))
		if err != nil {
			return err
		}
		if owner, ok := directory.Sys().(*syscall.Stat_t); ok {
			if err := file.Chown(int(owner.Uid), int(owner.Gid)); err != nil {
				return err
			}
		}
	}
	if _, err := file.Write(body); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (runner *Runner) metricDestination() string {
	return strings.TrimRight(runner.cfg.BaseURL, "/") + "\n" + runner.cfg.AgentID
}

func (runner *Runner) loadMetricHistory() (metricHistory, error) {
	history := metricHistory{Checkpoints: map[string]string{}}
	body, err := os.ReadFile(filepath.Join(runner.cfg.StateDir, metricHistoryFile))
	if errors.Is(err, os.ErrNotExist) {
		return history, nil
	}
	if err != nil {
		return history, err
	}
	if err := json.Unmarshal(body, &history); err != nil {
		return history, fmt.Errorf("read metric history: %w", err)
	}
	if history.Checkpoints == nil {
		history.Checkpoints = map[string]string{}
	}
	for _, sample := range history.Samples {
		if sample.ID == "" || sample.ObservedAt.IsZero() {
			return history, errors.New("invalid metric history sample")
		}
	}
	return history, nil
}

func (runner *Runner) saveMetricHistory(history metricHistory) error {
	body, err := json.Marshal(history)
	if err != nil {
		return err
	}
	return writeMetricFile(filepath.Join(runner.cfg.StateDir, metricHistoryFile), body)
}

func (history *metricHistory) prune(now time.Time) {
	cutoff := now.Add(-metricRetention)
	kept := history.Samples[:0]
	for _, sample := range history.Samples {
		if !sample.ObservedAt.Before(cutoff) {
			kept = append(kept, sample)
		}
	}
	history.Samples = kept
	if len(kept) > metricHistoryLimit {
		history.Samples = kept[len(kept)-metricHistoryLimit:]
	}
}

func (history metricHistory) pending(destination string) []metricSample {
	start := 0
	checkpoint := history.Checkpoints[destination]
	for i, sample := range history.Samples {
		if sample.ID == checkpoint {
			start = i + 1
			break
		}
	}
	end := min(start+metricBatchSize, len(history.Samples))
	return history.Samples[start:end]
}

func (runner *Runner) prepareMetricBatch(metrics *hostMetrics, now time.Time) (metricHistory, []metricSample, error) {
	history, err := runner.loadMetricHistory()
	if err != nil {
		return history, nil, err
	}
	token, err := os.ReadFile(filepath.Join(runner.cfg.StateDir, metricResyncFile))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return history, nil, err
	}
	if len(token) > 0 && string(token) != history.ResyncToken {
		delete(history.Checkpoints, runner.metricDestination())
		history.ResyncToken = string(token)
	}
	if metrics != nil {
		id, err := metricID()
		if err != nil {
			return history, nil, err
		}
		history.Samples = append(history.Samples, metricSample{ID: id, ObservedAt: now.UTC(), Metrics: *metrics})
	}
	history.prune(now)
	if err := runner.saveMetricHistory(history); err != nil {
		return history, nil, err
	}
	return history, history.pending(runner.metricDestination()), nil
}

func (runner *Runner) acknowledgeMetrics(history metricHistory, samples []metricSample, acceptedThrough string) error {
	if len(samples) == 0 {
		return nil
	}
	last := samples[len(samples)-1].ID
	if acceptedThrough != last {
		return errors.New("metric batch was not acknowledged; retained for retry")
	}
	history.Checkpoints[runner.metricDestination()] = last
	return runner.saveMetricHistory(history)
}
