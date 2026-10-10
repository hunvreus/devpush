package agent

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func metricTestRunner(t *testing.T) *Runner {
	t.Helper()
	runner := NewRunner(Config{StateDir: t.TempDir(), BaseURL: "https://one.test", AgentID: "server"}, nil)
	return &runner
}

func TestMetricHistoryRetriesRetainsAndSurvivesRestart(t *testing.T) {
	runner := metricTestRunner(t)
	now := time.Now()
	cpu := 12.0
	history, batch, err := runner.prepareMetricBatch(&hostMetrics{CPUPercent: &cpu}, now)
	if err != nil || len(batch) != 1 {
		t.Fatalf("prepare: %v, %v", batch, err)
	}
	if err := runner.acknowledgeMetrics(history, batch, ""); err == nil {
		t.Fatal("missing acknowledgment advanced checkpoint")
	}
	restarted := NewRunner(runner.cfg, nil)
	history, retry, err := restarted.prepareMetricBatch(nil, now.Add(time.Minute))
	if err != nil || len(retry) != 1 || retry[0].ID != batch[0].ID {
		t.Fatalf("retry: %v, %v", retry, err)
	}
	if err := restarted.acknowledgeMetrics(history, retry, retry[0].ID); err != nil {
		t.Fatal(err)
	}
	history, pending, err := restarted.prepareMetricBatch(nil, now.Add(2*time.Minute))
	if err != nil || len(pending) != 0 || len(history.Samples) != 1 {
		t.Fatalf("ack deleted history or replayed: %#v, %v", history, err)
	}
	restarted.cfg.BaseURL = "https://two.test"
	_, pending, err = restarted.prepareMetricBatch(nil, now.Add(3*time.Minute))
	if err != nil || len(pending) != 1 {
		t.Fatalf("new URL did not replay: %v", err)
	}
	restarted.cfg.BaseURL = "https://one.test"
	_, pending, err = restarted.prepareMetricBatch(nil, now.Add(4*time.Minute))
	if err != nil || len(pending) != 0 {
		t.Fatal("URL checkpoints were not independent")
	}
	restarted.cfg.AgentID = "new-server"
	_, pending, err = restarted.prepareMetricBatch(nil, now.Add(5*time.Minute))
	if err != nil || len(pending) != 1 {
		t.Fatal("new enrollment reused old checkpoint")
	}
}

func TestMetricResyncDuringUploadIsNotLost(t *testing.T) {
	runner := metricTestRunner(t)
	now := time.Now()
	cpu := 1.0
	history, batch, err := runner.prepareMetricBatch(&hostMetrics{CPUPercent: &cpu}, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := RequestMetricsResync(runner.cfg); err != nil {
		t.Fatal(err)
	}
	if err := runner.acknowledgeMetrics(history, batch, batch[0].ID); err != nil {
		t.Fatal(err)
	}
	history, batch, err = runner.prepareMetricBatch(nil, now)
	if err != nil || len(batch) != 1 {
		t.Fatal("resync request overwritten by acknowledgment")
	}
	if err := runner.acknowledgeMetrics(history, batch, batch[0].ID); err != nil {
		t.Fatal(err)
	}
	_, batch, err = runner.prepareMetricBatch(nil, now)
	if err != nil || len(batch) != 0 {
		t.Fatal("resync repeated after acknowledgment")
	}
	if err := RequestMetricsResync(runner.cfg); err != nil {
		t.Fatal(err)
	}
	_, batch, err = runner.prepareMetricBatch(nil, now)
	if err != nil || len(batch) != 1 {
		t.Fatal("second resync did not trigger")
	}
}

func TestMetricRetentionAndOrderedBatching(t *testing.T) {
	runner := metricTestRunner(t)
	now := time.Now()
	history := metricHistory{Checkpoints: map[string]string{}}
	for i := 0; i < metricBatchSize+5; i++ {
		id, err := metricID()
		if err != nil {
			t.Fatal(err)
		}
		history.Samples = append(history.Samples, metricSample{ID: id, ObservedAt: now.Add(time.Duration(i) * time.Second)})
	}
	expiredID, _ := metricID()
	history.Samples = append([]metricSample{{ID: expiredID, ObservedAt: now.Add(-metricRetention - time.Second)}}, history.Samples...)
	if err := runner.saveMetricHistory(history); err != nil {
		t.Fatal(err)
	}
	history, batch, err := runner.prepareMetricBatch(nil, now)
	if err != nil || len(batch) != metricBatchSize || batch[0].ID == expiredID {
		t.Fatal("wrong first batch or retention")
	}
	if err := runner.acknowledgeMetrics(history, batch, batch[len(batch)-1].ID); err != nil {
		t.Fatal(err)
	}
	_, batch, err = runner.prepareMetricBatch(nil, now)
	if err != nil || len(batch) != 5 {
		t.Fatal("skipped or resent records between batches")
	}
	history.prune(now.Add(25 * time.Hour))
	if len(history.Samples) != 0 {
		t.Fatal("did not expire old records")
	}
	// Bound memory/disk even if the host clock moves backwards.
	history.Samples = make([]metricSample, metricHistoryLimit+10)
	for i := range history.Samples {
		history.Samples[i].ObservedAt = now.Add(time.Hour)
	}
	history.prune(now)
	if len(history.Samples) != metricHistoryLimit {
		t.Fatal("count cap not enforced")
	}
}

func TestMetricHistoryLostCheckpointAndCorruption(t *testing.T) {
	runner := metricTestRunner(t)
	now := time.Now()
	cpu := 1.0
	history, batch, err := runner.prepareMetricBatch(&hostMetrics{CPUPercent: &cpu}, now)
	if err != nil {
		t.Fatal(err)
	}
	history.Checkpoints[runner.metricDestination()] = "missing-sample"
	if len(history.pending(runner.metricDestination())) != 1 {
		t.Fatal("lost checkpoint did not replay available samples")
	}
	if err := os.WriteFile(filepath.Join(runner.cfg.StateDir, metricHistoryFile), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runner.prepareMetricBatch(&hostMetrics{CPUPercent: &cpu}, now); err == nil {
		t.Fatal("corrupt history silently discarded")
	}
	if err := os.Remove(filepath.Join(runner.cfg.StateDir, metricHistoryFile)); err != nil {
		t.Fatal(err)
	}
	_, replacement, err := runner.prepareMetricBatch(&hostMetrics{CPUPercent: &cpu}, now)
	if err != nil || replacement[0].ID == batch[0].ID {
		t.Fatal("lost state reused sample identity")
	}
}

func TestMetricHeartbeatRequiresPersistenceAcknowledgment(t *testing.T) {
	runner := metricTestRunner(t)
	binDir := filepath.Join(t.TempDir(), "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "docker"), "#!/bin/sh\nexit 1\n")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	var batches [][]metricSample
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var payload agentRequest
		decodeJSON(t, request, &payload)
		batches = append(batches, payload.MetricSamples)
		if len(batches) == 1 {
			http.Error(response, "database unavailable", 500)
			return
		}
		ack := ""
		if len(batches) == 3 {
			ack = payload.MetricSamples[len(payload.MetricSamples)-1].ID
		}
		writeJSON(t, response, agentResponse{ServerID: runner.cfg.AgentID, Status: "connected", MetricsAcceptedThrough: ack})
	}))
	defer server.Close()
	runner.cfg.BaseURL = server.URL
	for i := 0; i < 3; i++ {
		runner.sendHeartbeat(t.Context())
	}
	for i, batch := range batches {
		if len(batch) != i+1 || batch[0].ID != batches[0][0].ID {
			t.Fatalf("skipped failed/unacknowledged samples: %#v", batches)
		}
	}
	history, pending, err := runner.prepareMetricBatch(nil, time.Now())
	if err != nil || len(pending) != 0 || len(history.Samples) != 3 {
		t.Fatalf("wrong retained/checkpoint state: %#v, %v", history, err)
	}
}

func TestMetricResyncMarkerPermissionsMatchServiceDirectory(t *testing.T) {
	runner := metricTestRunner(t)
	if err := RequestMetricsResync(runner.cfg); err != nil {
		t.Fatal(err)
	}
	directory, err := os.Stat(runner.cfg.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	marker, err := os.Stat(filepath.Join(runner.cfg.StateDir, metricResyncFile))
	if err != nil {
		t.Fatal(err)
	}
	dirOwner := directory.Sys().(*syscall.Stat_t)
	markerOwner := marker.Sys().(*syscall.Stat_t)
	if dirOwner.Uid != markerOwner.Uid || dirOwner.Gid != markerOwner.Gid || marker.Mode().Perm() != 0600 {
		t.Fatal("resync marker inaccessible to service owner or not private")
	}
}
