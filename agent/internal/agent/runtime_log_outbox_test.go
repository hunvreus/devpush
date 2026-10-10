package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRuntimeLogsRetainUnacknowledgedBatchAcrossRestart(t *testing.T) {
	for _, failure := range []string{"503", "202", "invalid-json", "ok-false", "partial"} {
		t.Run(failure, func(t *testing.T) {
			fail := true
			var received []runtimeLogsRequest
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body runtimeLogsRequest
				decodeJSON(t, r, &body)
				received = append(received, body)
				if fail {
					switch failure {
					case "503":
						http.Error(w, "unavailable", 503)
					case "202":
						w.WriteHeader(202)
						writeJSON(t, w, runtimeLogsResponse{OK: true, Accepted: 1})
					case "invalid-json":
						_, _ = w.Write([]byte("invalid"))
					case "ok-false":
						writeJSON(t, w, runtimeLogsResponse{Accepted: 1})
					case "partial":
						writeJSON(t, w, runtimeLogsResponse{OK: true})
					}
					return
				}
				writeJSON(t, w, runtimeLogsResponse{OK: true, Accepted: len(body.Logs)})
			}))
			defer server.Close()
			cfg := Config{StateDir: t.TempDir(), AgentID: "server", BaseURL: server.URL, Token: "credential"}
			runner := NewRunner(cfg, nil)
			state := pendingRuntimeState("server", "dp_runtime", 1)
			if err := runner.saveRuntimeLogState(state); err != nil {
				t.Fatal(err)
			}
			if err := runner.reportRuntimeLogTarget(t.Context(), state.RuntimeID); err == nil {
				t.Fatal("expected failed acknowledgment")
			}
			stored, err := runner.loadRuntimeLogState(state.RuntimeID)
			if err != nil || len(stored.Logs) != 1 || !stored.Since.Equal(state.Since) {
				t.Fatalf("pending state changed: %#v, %v", stored, err)
			}
			body, err := os.ReadFile(runner.runtimeLogStatePath(state.RuntimeID))
			if err != nil || strings.Contains(string(body), "credential") {
				t.Fatalf("credential persisted or file unreadable: %v", err)
			}
			fail = false
			cfg.Token = "rotated"
			restarted := NewRunner(cfg, nil)
			if err := restarted.reportRuntimeLogTarget(t.Context(), state.RuntimeID); err != nil {
				t.Fatal(err)
			}
			stored, err = restarted.loadRuntimeLogState(state.RuntimeID)
			if err != nil || len(stored.Logs) != 0 || !stored.Since.Equal(state.PendingUntil) {
				t.Fatalf("acknowledged state incorrect: %#v, %v", stored, err)
			}
			if len(received) != 2 || received[1].Token != "rotated" || received[0].Logs[0] != received[1].Logs[0] {
				t.Fatal("retry did not preserve original batch with current credential")
			}
		})
	}
}

func TestRuntimeLogsChunkWithoutDiscardingAndGiveEachRuntimeATurn(t *testing.T) {
	var received []runtimeLogsRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body runtimeLogsRequest
		decodeJSON(t, r, &body)
		received = append(received, body)
		writeJSON(t, w, runtimeLogsResponse{OK: true, Accepted: len(body.Logs)})
	}))
	defer server.Close()
	runner := NewRunner(Config{StateDir: t.TempDir(), AgentID: "server", BaseURL: server.URL}, nil)
	for _, state := range []runtimeLogState{pendingRuntimeState("server", "dp_busy", 700), pendingRuntimeState("server", "dp_quiet", 1)} {
		if err := runner.saveRuntimeLogState(state); err != nil {
			t.Fatal(err)
		}
	}
	runner.reportRuntimeLogs(t.Context(), []runtimeLogTarget{{RuntimeID: "dp_busy"}, {RuntimeID: "dp_quiet"}})
	if len(received) != 2 || len(received[0].Logs) != 500 || len(received[1].Logs) != 1 {
		t.Fatalf("unfair batches: %#v", received)
	}
	stored, err := runner.loadRuntimeLogState("dp_busy")
	if err != nil || len(stored.Logs) != 200 || stored.Logs[0].Content != "line 500" {
		t.Fatalf("unsent lines missing: %#v, %v", stored, err)
	}
	if err := runner.reportRuntimeLogTarget(context.Background(), "dp_busy"); err != nil {
		t.Fatal(err)
	}
	if len(received[2].Logs) != 200 || received[2].Logs[199].Content != "line 699" {
		t.Fatal("remaining lines were not delivered")
	}
}

func TestRuntimeLogQueueLimitDoesNotOverwritePendingData(t *testing.T) {
	runner := NewRunner(Config{StateDir: t.TempDir(), AgentID: "server"}, nil)
	state := pendingRuntimeState("server", "dp_runtime", 1)
	if err := runner.saveRuntimeLogState(state); err != nil {
		t.Fatal(err)
	}
	runner.cfg.RuntimeLogQueueBytes = 1
	larger := pendingRuntimeState("server", "dp_runtime", 2)
	if err := runner.saveRuntimeLogState(larger); err == nil {
		t.Fatal("expected full queue error")
	}
	stored, err := runner.loadRuntimeLogState(state.RuntimeID)
	if err != nil || len(stored.Logs) != 1 {
		t.Fatalf("pending logs overwritten: %#v, %v", stored, err)
	}
	state.Logs = nil
	if err := runner.saveRuntimeLogState(state); err != nil {
		t.Fatalf("queue could not drain after reducing limit: %v", err)
	}
}

func pendingRuntimeState(serverID, runtimeID string, count int) runtimeLogState {
	state := runtimeLogState{ServerID: serverID, RuntimeID: runtimeID, Since: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC), PendingUntil: time.Date(2026, 6, 1, 0, 1, 0, 0, time.UTC)}
	for index := 0; index < count; index++ {
		state.Logs = append(state.Logs, runtimeLogLine{RuntimeID: runtimeID, Service: "web", ObservedAt: state.Since.Format(time.RFC3339Nano), Content: fmt.Sprintf("line %d", index)})
	}
	return state
}

func TestRuntimeLogChunksFitByteAndLineLimits(t *testing.T) {
	state := pendingRuntimeState("server", "dp_runtime", 600)
	for index := range state.Logs {
		state.Logs[index].Content = strings.Repeat("\x00", maxRuntimeLogLineLen)
	}
	delivered := 0
	for len(state.Logs) > 0 {
		batch := runtimeLogBatch(state.Logs)
		body, err := json.Marshal(batch)
		if err != nil || len(batch) == 0 || len(batch) > 500 || len(body) > maxRuntimeLogBatchBytes {
			t.Fatalf("invalid chunk: %d lines, %d bytes, %v", len(batch), len(body), err)
		}
		delivered += len(batch)
		state.Logs = state.Logs[len(batch):]
	}
	if delivered != 600 {
		t.Fatalf("delivered %d lines", delivered)
	}
}
