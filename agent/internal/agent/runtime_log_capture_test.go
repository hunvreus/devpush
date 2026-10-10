package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRuntimeLogCaptureKeepsBurstBeyondOldTail(t *testing.T) {
	bin := t.TempDir()
	writeExecutable(t, filepath.Join(bin, "docker"), `#!/bin/sh
if [ "$2" = "version" ]; then exit 0; fi
case " $* " in *" --tail "*) exit 1;; esac
n=0
while [ "$n" -lt 600 ]; do
 echo "web | 2026-10-07T00:00:01Z burst-$n"
 n=$((n+1))
done
`)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	runner := NewRunner(Config{StateDir: t.TempDir()}, nil)
	since := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	until := since.Add(time.Minute)
	lines, cursor, err := runner.collectRuntimeLogWindow(t.Context(), "dp_test", since, until)
	if err != nil || len(lines) != 600 || lines[0].Content != "burst-0" || lines[599].Content != "burst-599" || !cursor.Equal(until) {
		t.Fatalf("burst lost: %d lines, %v", len(lines), err)
	}
}

func TestRuntimeLogCaptureCancelsOnMemoryLimit(t *testing.T) {
	cancelled := false
	capture := runtimeLogCapture{cancel: func() { cancelled = true }}
	if _, err := capture.Write(make([]byte, maxRuntimeLogCaptureBytes)); err != nil {
		t.Fatal(err)
	}
	if _, err := capture.Write([]byte("extra")); err == nil || !cancelled || capture.Len() != maxRuntimeLogCaptureBytes {
		t.Fatal("capture did not bound memory and cancel")
	}
}

func TestRuntimeLogQueueFailureIsVisibleInApplicationLogs(t *testing.T) {
	var received runtimeLogsRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeJSON(t, r, &received)
		writeJSON(t, w, runtimeLogsResponse{OK: true, Accepted: len(received.Logs)})
	}))
	defer server.Close()
	runner := NewRunner(Config{StateDir: t.TempDir(), AgentID: "server", BaseURL: server.URL}, nil)
	if err := os.MkdirAll(filepath.Dir(runner.runtimeLogStatePath("dp_test")), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(runner.runtimeLogStatePath("dp_test"), []byte("invalid state"), 0600); err != nil {
		t.Fatal(err)
	}
	runner.reportRuntimeLogs(context.Background(), []runtimeLogTarget{{RuntimeID: "dp_test"}})
	if len(received.Logs) != 1 || received.Logs[0].Service != "devpush" || !strings.Contains(received.Logs[0].Content, "collection paused") {
		t.Fatalf("missing diagnostic: %#v", received)
	}
}

func TestRuntimeLogCaptureResumesShortenedOverflowWindow(t *testing.T) {
	bin := t.TempDir()
	writeExecutable(t, filepath.Join(bin, "docker"), `#!/bin/sh
if [ "$2" = "version" ]; then exit 0; fi
case "$*" in
 *"--since 2026-10-07T00:00:00Z --until 2026-10-07T00:01:00Z"*)
  dd if=/dev/zero bs=1048576 count=2 2>/dev/null
  ;;
 *"--until 2026-10-07T00:00:30Z"*) echo "web | 2026-10-07T00:00:01Z first-window" ;;
 *"--since 2026-10-07T00:00:30Z --until 2026-10-07T00:01:00Z"*) echo "web | 2026-10-07T00:00:45Z resumed-window" ;;
 *) exit 1 ;;
esac
`)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	runner := NewRunner(Config{StateDir: t.TempDir()}, nil)
	since := time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC)
	until := since.Add(time.Minute)
	lines, cursor, err := runner.collectRuntimeLogWindow(t.Context(), "dp_test", since, until)
	if err != nil || len(lines) != 1 || lines[0].Content != "first-window" || !cursor.Equal(since.Add(30*time.Second)) {
		t.Fatalf("overflow cursor advanced incorrectly: lines=%v cursor=%v error=%v", lines, cursor, err)
	}
	lines, cursor, err = runner.collectRuntimeLogWindow(t.Context(), "dp_test", cursor, until)
	if err != nil || len(lines) != 1 || lines[0].Content != "resumed-window" || !cursor.Equal(until) {
		t.Fatalf("window did not resume: lines=%v cursor=%v error=%v", lines, cursor, err)
	}
}
