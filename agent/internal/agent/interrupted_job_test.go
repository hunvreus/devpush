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
)

func TestInterruptedJobsReportFailureWithoutPersistingSecrets(t *testing.T) {
	for _, kind := range []string{"deploy", "backup", "backup_cleanup", "restore", "deprovision", "purge"} {
		t.Run(kind, func(t *testing.T) {
			var received map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
					t.Error(err)
				}
				writeJSON(t, w, completeJobResponse{OK: true})
			}))
			defer server.Close()
			cfg := Config{BaseURL: server.URL, AgentID: "server", StateDir: t.TempDir(), Token: "secret-agent"}
			runner := NewRunner(cfg, nil)
			job := agentJob{ID: "job", Attempt: 3, Type: kind, LogStartSeq: 5, Repo: repo{Token: "secret-github"}, EnvVars: []envVar{{Key: "PASSWORD", Value: "secret-app"}}, Backup: backupConfig{BackupRunID: "run"}, Cleanup: cleanupConfig{BackupRunIDs: []string{"run"}}}
			if err := runner.prepareInterruptedCompletion(job); err != nil {
				t.Fatal(err)
			}
			entries, _ := os.ReadDir(filepath.Join(cfg.StateDir, completionOutboxDir))
			data, err := os.ReadFile(filepath.Join(cfg.StateDir, completionOutboxDir, entries[0].Name()))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), "secret-") {
				t.Fatal("recovery record contains a secret")
			}
			restarted := NewRunner(cfg, nil)
			if err := restarted.flushPendingCompletions(context.Background()); err != nil {
				t.Fatal(err)
			}
			if kind == "deploy" {
				events := received["events"].([]any)
				if events[0].(map[string]any)["phase"] != "completed" {
					t.Fatal("invalid deployment event phase")
				}
			}
			if (kind == "purge" || kind == "deprovision") && received["attempt"] != float64(3) {
				t.Fatalf("lost cleanup attempt: %v", received)
			}
			if received["status"] != "failed" || received["type"] != kind || received["token"] != "secret-agent" {
				t.Fatalf("unexpected recovery: %v", received)
			}
			entries, _ = os.ReadDir(filepath.Join(cfg.StateDir, completionOutboxDir))
			if len(entries) != 0 {
				t.Fatal("acknowledged recovery remains pending")
			}
		})
	}
}

func TestNormalCompletionReplacesInterruptedFailure(t *testing.T) {
	cfg := Config{StateDir: t.TempDir(), AgentID: "server"}
	runner := NewRunner(cfg, nil)
	if err := runner.prepareInterruptedCompletion(agentJob{ID: "job", Type: "restore"}); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(restoreJobCompletion{JobID: "job", Type: "restore", Status: "succeeded"})
	file, err := runner.persistCompletion("job", encoded)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(file)
	if string(data) != string(encoded) {
		t.Fatal("normal result did not replace interruption fallback")
	}
}

func TestRecoveryWriteFailureReportsWithoutExecutingClaimedJob(t *testing.T) {
	cfg := Config{StateDir: t.TempDir(), AgentID: "server", Token: "token"}
	completed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agents/jobs/next" {
			// Fail persistence only after the claim, so the preceding outbox flush succeeds.
			if err := os.WriteFile(filepath.Join(cfg.StateDir, completionOutboxDir), []byte("blocked"), 0600); err != nil {
				t.Error(err)
			}
			writeJSON(t, w, nextJobResponse{Job: &agentJob{ID: "job", Type: "restore"}})
			return
		}
		if r.URL.Path != "/api/agents/jobs/complete" {
			t.Errorf("unexpected execution request: %s", r.URL.Path)
		}
		var body restoreJobCompletion
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Status != "failed" || body.JobID != "job" {
			t.Errorf("unexpected result: %+v", body)
		}
		completed = true
		writeJSON(t, w, completeJobResponse{OK: true})
	}))
	defer server.Close()
	cfg.BaseURL = server.URL
	runner := NewRunner(cfg, nil)
	runner.claimAndRunJob(context.Background())
	if !completed {
		t.Fatal("unstarted job was not failed immediately")
	}
}

func TestCleanupCompletionKeepsClaimAttempt(t *testing.T) {
	runner := NewRunner(Config{AgentID: "server", Token: "token", StateDir: t.TempDir()}, nil)
	completion := runner.runDeprovisionJob(context.Background(), agentJob{ID: "job", Type: "purge", Attempt: 4})
	if completion.Attempt != 4 || completion.Status != "succeeded" {
		t.Fatalf("unexpected completion: %+v", completion)
	}
}
