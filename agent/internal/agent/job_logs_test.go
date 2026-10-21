package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestJobLogsCaptureRedactReplayAndBound(t *testing.T) {
	runner := NewRunner(Config{StateDir: t.TempDir()}, nil)
	job := agentJob{ID: "job-test", Type: "backup", Backup: backupConfig{Destination: backupDestination{SecretAccessKey: "secret-storage"}}}
	ctx, finish := runner.beginJobLog(context.Background(), job)
	writeJobProgress(ctx, "Uploaded using secret-storage.")
	finish("succeeded", "")
	result := runner.readJobLog(jobLogRead{JobID: job.ID})
	text := result["content"].(string)
	if strings.Contains(text, "secret-storage") || !strings.Contains(text, "backup succeeded") || !strings.Contains(text, "***") {
		t.Fatalf("unexpected log: %s", text)
	}
	cursor := result["offset"].(int64)
	if runner.readJobLog(jobLogRead{JobID: job.ID, Offset: cursor})["content"] != "" {
		t.Fatal("cursor replayed duplicate logs")
	}
	if runner.readJobLog(jobLogRead{JobID: "../secret"})["unavailable"] != true {
		t.Fatal("accepted traversal")
	}
	ctx, finish = runner.beginJobLog(context.Background(), agentJob{ID: "big", Type: "restore"})
	writeJobProgress(ctx, strings.Repeat("x", maxJobLogBytes+1))
	finish("succeeded", "")
	info, _ := os.Stat(filepath.Join(runner.cfg.StateDir, "logs", "jobs", "big.log"))
	if info.Size() > maxJobLogBytes {
		t.Fatal("log cap exceeded")
	}
}
func TestJobLogRetention(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "old.log")
	_ = os.WriteFile(old, []byte("old"), 0600)
	then := time.Now().Add(-jobLogRetention - time.Hour)
	_ = os.Chtimes(old, then, then)
	recent := filepath.Join(dir, "recent.log")
	_ = os.WriteFile(recent, []byte("recent"), 0600)
	pruneJobLogs(dir, time.Now())
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("expired log retained")
	}
	if _, err := os.Stat(recent); err != nil {
		t.Fatal("recent log removed")
	}
}

func TestJobLogTotalBudgetReservesSpaceForNextJob(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a.log", "b.log", "c.log"} {
		file, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err = file.Truncate(40 << 20); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
	}
	pruneJobLogs(dir, time.Now())
	entries, _ := os.ReadDir(dir)
	var total int64
	for _, entry := range entries {
		info, _ := entry.Info()
		total += info.Size()
	}
	if total+maxJobLogBytes > maxJobLogTotalBytes {
		t.Fatal("host log budget exceeded")
	}
}

func TestJobLogHTTPUploadRetriesWithoutDuplicatingAcknowledgedBytes(t *testing.T) {
	var offsets []int64
	fail := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agents/job-logs" {
			t.Errorf("unexpected route %s", r.URL.Path)
		}
		var payload struct {
			Offset  int64  `json:"offset"`
			Content string `json:"content"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		offsets = append(offsets, payload.Offset)
		if fail {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	runner := NewRunner(Config{StateDir: t.TempDir(), BaseURL: server.URL, AgentID: "server"}, nil)
	ctx, finish := runner.beginJobLog(context.Background(), agentJob{ID: "job", Type: "backup"})
	writeJobProgress(ctx, "Captured diagnostics.")
	finish("succeeded", "")
	runner.flushJobLogs(context.Background())
	fail = false
	runner.flushJobLogs(context.Background())
	runner.flushJobLogs(context.Background())
	if len(offsets) != 2 || offsets[0] != 0 || offsets[1] != 0 {
		t.Fatalf("unexpected retries: %v", offsets)
	}
}
