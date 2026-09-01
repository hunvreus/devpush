package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestAgentJobTimeoutHonorsLongDeploymentCommands(t *testing.T) {
	if got := agentJobTimeout(agentJob{Type: "deploy"}); got != 3*time.Hour {
		t.Fatalf("deployment timeout = %s, want 3h", got)
	}
	if got := agentJobTimeout(agentJob{Type: "backup"}); got != 24*time.Hour {
		t.Fatalf("backup timeout = %s, want 24h", got)
	}
}
