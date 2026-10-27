package agent

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestNoisyCommandLogsAreBoundedWithoutChangingFailureStatus(t *testing.T) {
	runner := NewRunner(Config{}, nil)
	logs := []string{}
	err := runner.runCommand(t.Context(), "", &logs, "sh", "-c", "i=0; while [ $i -lt 12000 ]; do echo line; i=$((i+1)); done; echo final-error; exit 7")
	if err == nil || !strings.Contains(err.Error(), "final-error") {
		t.Fatalf("lost command failure: %v", err)
	}
	if len(logs) > 10001 {
		t.Fatalf("retained %d log lines", len(logs))
	}
	if !strings.Contains(strings.Join(logs, "\n"), "logs truncated") {
		t.Fatal("missing truncation notice")
	}
}

type readyOutput chan struct{}

func (w readyOutput) Write(p []byte) (int, error) {
	select {
	case w <- struct{}{}:
	default:
	}
	return len(p), nil
}
func TestCancellationStopsDescendantsHoldingOutputPipes(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ready := make(readyOutput, 1)
	command := agentCommand(ctx, "sh", "-c", "sleep 30 & echo ready; wait")
	command.WaitDelay = 10 * time.Second
	command.Stdout = ready
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("child did not start")
	}
	cancel()
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled command succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("descendant held command output open after cancellation")
	}
}
func TestTruncatedGitOutputDoesNotExposeCredentialFragments(t *testing.T) {
	dir := t.TempDir()
	token := "test-private-github-credential-boundary"
	tail := "\nsafe diagnostic\n"
	padding := maxCommandOutputBytes - len(token)/2 - len(tail)
	path := filepath.Join(dir, "output")
	if err := os.WriteFile(path, []byte(token+strings.Repeat("x", padding)+tail), 0600); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(dir, "git"), "#!/bin/sh\ncat "+shellQuote(path)+"\nexit 1\n")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	runner := NewRunner(Config{}, nil)
	logs := []string{}
	err := runner.runCommandWithEnv(t.Context(), dir, &logs, runner.gitAuthEnv(repo{Token: token}), "git", "fetch")
	if err == nil {
		t.Fatal("expected failed command")
	}
	captured := strings.Join(logs, "\n") + err.Error()
	if strings.Contains(captured, token[len(token)/2:]) {
		t.Fatal("credential fragment escaped tail redaction")
	}
	if !strings.Contains(captured, "safe diagnostic") {
		t.Fatal("lost complete safe diagnostic")
	}
}
func TestCappedTailBufferWrapsAcrossSmallWrites(t *testing.T) {
	buffer := cappedTailBuffer{maxBytes: 11}
	input := ""
	for _, part := range []string{"12345", "67890", "ab", "cde", "fghijklmnop", "qrs", "tuv"} {
		input += part
		_, _ = buffer.Write([]byte(part))
		want := input
		if len(want) > 11 {
			want = want[len(want)-11:]
		}
		if string(buffer.Bytes()) != want {
			t.Fatalf("tail mismatch: %q != %q", buffer.Bytes(), want)
		}
	}
}

func TestInventoryCommandRejectsOversizedOutputRatherThanReturningPartialData(t *testing.T) {
	runner := NewRunner(Config{}, nil)
	output, err := runner.commandOutput(t.Context(), "", "sh", "-c", "head -c 4194305 /dev/zero")
	if err == nil || output != "" || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("returned partial inventory: %d bytes, %v", len(output), err)
	}
}

func TestExitedCommandCleansUpDescendantsAfterPipeTimeout(t *testing.T) {
	for _, exit := range []string{"0", "7"} {
		t.Run("exit-"+exit, func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), "orphan")
			command := agentCommand(t.Context(), "sh", "-c", "(sleep 1; touch "+shellQuote(marker)+") & exit "+exit)
			command.Stdout = readyOutput(make(chan struct{}, 1))
			command.WaitDelay = 100 * time.Millisecond
			err := command.Run()
			if err == nil || (exit == "0" && !errors.Is(err, exec.ErrWaitDelay)) {
				t.Fatalf("expected command/pipe failure: %v", err)
			}
			time.Sleep(1100 * time.Millisecond)
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatal("descendant survived completed command's pipe timeout")
			}
		})
	}
}
