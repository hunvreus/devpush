package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompletionOutboxRetriesPersistedCompletion(t *testing.T) {
	var fail atomic.Bool
	var receivedToken atomic.Value
	fail.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/agents/jobs/complete" {
			http.NotFound(response, request)
			return
		}
		if fail.Load() {
			http.Error(response, "temporary failure", http.StatusServiceUnavailable)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			http.Error(response, "invalid completion", http.StatusBadRequest)
			return
		}
		receivedToken.Store(body["token"])
		writeJSON(t, response, completeJobResponse{OK: true})
	}))
	defer server.Close()

	stateDir := t.TempDir()
	runner := NewRunner(Config{BaseURL: server.URL, StateDir: stateDir, Token: "current-secret"}, nil)
	completion := cleanupJobCompletion{JobID: "job-1", Status: "succeeded", Token: "stale-secret"}

	if err := runner.deliverCompletion(context.Background(), "job-1", completion); err == nil {
		t.Fatal("expected the first delivery to fail")
	}
	entries, err := os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
	if err != nil || len(entries) != 1 {
		t.Fatalf("expected one persisted completion, entries=%d err=%v", len(entries), err)
	}
	persisted, err := os.ReadFile(filepath.Join(stateDir, completionOutboxDir, entries[0].Name()))
	if err != nil {
		t.Fatalf("read persisted completion: %v", err)
	}
	var stored map[string]any
	if err := json.Unmarshal(persisted, &stored); err != nil {
		t.Fatalf("decode persisted completion: %v", err)
	}
	if _, ok := stored["token"]; ok {
		t.Fatal("persisted completion contains the agent credential")
	}

	fail.Store(false)
	if err := runner.flushPendingCompletions(context.Background()); err != nil {
		t.Fatalf("flush pending completion: %v", err)
	}
	entries, err = os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
	if err != nil || len(entries) != 0 {
		t.Fatalf("expected an empty outbox, entries=%d err=%v", len(entries), err)
	}
	if got := receivedToken.Load(); got != "current-secret" {
		t.Fatalf("completion token = %v, want current credential", got)
	}
}

func TestDeploymentDeliveryRequires200StorageAcknowledgment(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		status int
		body   string
	}{
		{"accepted status", http.StatusAccepted, `{"ok":true}`},
		{"negative acknowledgment", http.StatusOK, `{"ok":false}`},
		{"missing acknowledgment", http.StatusOK, `{}`},
		{"malformed acknowledgment", http.StatusOK, `invalid`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var acknowledge atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if acknowledge.Load() {
					writeJSON(t, response, completeJobResponse{OK: true})
					return
				}
				response.WriteHeader(testCase.status)
				_, _ = response.Write([]byte(testCase.body))
			}))
			defer server.Close()
			stateDir := t.TempDir()
			runner := NewRunner(Config{BaseURL: server.URL, StateDir: stateDir, Token: "token"}, nil)
			if err := runner.reportProgress(context.Background(), jobProgress{DeploymentID: "deployment", LogStartSeq: 1}); err == nil {
				t.Fatal("unacknowledged progress was marked delivered")
			}
			completion := jobCompletion{DeploymentID: "deployment", LogStartSeq: 1, Status: "succeeded"}
			if err := runner.deliverCompletion(context.Background(), "deployment", completion); err == nil {
				t.Fatal("unacknowledged completion was marked delivered")
			}
			entries, err := os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
			if err != nil || len(entries) != 1 {
				t.Fatalf("pending completion lost: entries=%d err=%v", len(entries), err)
			}
			acknowledge.Store(true)
			restarted := NewRunner(Config{BaseURL: server.URL, StateDir: stateDir, Token: "token"}, nil)
			if err := restarted.flushPendingCompletions(context.Background()); err != nil {
				t.Fatalf("retry acknowledged completion: %v", err)
			}
			entries, err = os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
			if err != nil || len(entries) != 0 {
				t.Fatalf("acknowledged completion retained: entries=%d err=%v", len(entries), err)
			}
		})
	}
}

func TestAgentJobTimeoutHonorsLongDeploymentCommands(t *testing.T) {
	if got := agentJobTimeout(agentJob{Type: "deploy"}); got != 3*time.Hour {
		t.Fatalf("deployment timeout = %s, want 3h", got)
	}
	if got := agentJobTimeout(agentJob{Type: "backup"}); got != 24*time.Hour {
		t.Fatalf("backup timeout = %s, want 24h", got)
	}
}

func TestDeploymentCompletionReplaysEveryCapturedLineAcrossRestart(t *testing.T) {
	for _, failurePath := range []string{"/api/agents/jobs/progress", "/api/agents/jobs/complete"} {
		t.Run(failurePath, func(t *testing.T) {
			var allow atomic.Bool
			var mutex sync.Mutex
			stored := map[int]string{}
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				var payload jobCompletion
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					http.Error(response, err.Error(), 400)
					return
				}
				if len(payload.Logs) > maxDeploymentLogBatchLines || len(payload.Events) > maxDeploymentEventBatch {
					t.Errorf("unbounded upload: logs=%d events=%d", len(payload.Logs), len(payload.Events))
				}
				mutex.Lock()
				for index, line := range payload.Logs {
					seq := payload.LogStartSeq + index
					if prior, exists := stored[seq]; exists && prior != line {
						t.Errorf("sequence %d changed from %q to %q", seq, prior, line)
					}
					stored[seq] = line
				}
				mutex.Unlock()
				// Simulate persistence succeeding but its acknowledgment failing.
				if request.URL.Path == failurePath && !allow.Load() {
					http.Error(response, "retry", http.StatusServiceUnavailable)
					return
				}
				writeJSON(t, response, completeJobResponse{OK: true})
			}))
			defer server.Close()
			stateDir := t.TempDir()
			completion := jobCompletion{Type: "deploy", DeploymentID: "deployment", LogStartSeq: 7, Status: "succeeded"}
			for index := 0; index < maxDeploymentLogBatchLines+2; index++ {
				completion.Logs = append(completion.Logs, fmt.Sprintf("captured line %d", index))
			}
			for index := 0; index < maxDeploymentEventBatch+2; index++ {
				completion.Events = append(completion.Events, jobEvent{Phase: "completed", Message: fmt.Sprintf("event %d", index)})
			}
			runner := NewRunner(Config{BaseURL: server.URL, StateDir: stateDir, Token: "old-secret"}, nil)
			if err := runner.deliverCompletion(context.Background(), "deployment", completion); err == nil {
				t.Fatal("expected failed acknowledgment")
			}
			entries, err := os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
			if err != nil || len(entries) != 1 {
				t.Fatalf("completion not retained: entries=%d err=%v", len(entries), err)
			}
			body, err := os.ReadFile(filepath.Join(stateDir, completionOutboxDir, entries[0].Name()))
			if err != nil {
				t.Fatal(err)
			}
			var pending jobCompletion
			if err := json.Unmarshal(body, &pending); err != nil {
				t.Fatal(err)
			}
			if len(pending.Logs) != len(completion.Logs) || pending.LogStartSeq != 7 || pending.Token != "" {
				t.Fatal("full pending output or its original sequence was lost")
			}
			allow.Store(true)
			restarted := NewRunner(Config{BaseURL: server.URL, StateDir: stateDir, Token: "new-secret"}, nil)
			if err := restarted.flushPendingCompletions(context.Background()); err != nil {
				t.Fatal(err)
			}
			mutex.Lock()
			if len(stored) != len(completion.Logs) {
				t.Errorf("stored %d of %d lines", len(stored), len(completion.Logs))
			}
			for index, line := range completion.Logs {
				if stored[7+index] != line {
					t.Errorf("missing original line at sequence %d", 7+index)
				}
			}
			mutex.Unlock()
			entries, err = os.ReadDir(filepath.Join(stateDir, completionOutboxDir))
			if err != nil || len(entries) != 0 {
				t.Fatalf("delivered completion remains: entries=%d err=%v", len(entries), err)
			}
		})
	}
}

func TestDeploymentChunksBoundEscapedLogAndEventBytes(t *testing.T) {
	line := strings.Repeat("\x00", maxDeploymentLogLineLen)
	logs := []string{line, line, line, line}
	_, batch := deploymentLogBatch(logs, 0)
	encoded, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxDeploymentLogBatchBytes || len(batch) == len(logs) {
		t.Fatalf("escaped logs unbounded: bytes=%d lines=%d", len(encoded), len(batch))
	}
	events := []jobEvent{{Phase: "completed", Message: line}, {Phase: "completed", Message: line}, {Phase: "completed", Message: line}}
	end := deploymentEventBatchEnd(events, 0)
	encoded, err = json.Marshal(events[:end])
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxDeploymentLogBatchBytes || end == len(events) {
		t.Fatalf("escaped events unbounded: bytes=%d events=%d", len(encoded), end)
	}
}
