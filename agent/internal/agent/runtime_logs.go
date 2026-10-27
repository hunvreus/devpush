package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (runner *Runner) reportRuntimeLogs(ctx context.Context, targets []runtimeLogTarget) {
	active := map[string]bool{}
	for _, target := range targets {
		active[strings.TrimSpace(target.RuntimeID)] = true
	}
	// Copy before appending: the caller owns its target slice.
	targets = append(append([]runtimeLogTarget{}, targets...), runner.pendingRuntimeLogTargets(ctx, active)...)
	if len(targets) == 0 {
		return
	}
	start := runner.runtimeLogTargetOffset % len(targets)
	runner.runtimeLogTargetOffset = (start + 1) % len(targets)
	for index := range targets {
		if ctx.Err() != nil {
			return
		}
		runtimeID := strings.TrimSpace(targets[(start+index)%len(targets)].RuntimeID)
		if runtimeID == "" {
			continue
		}
		if err := runner.deliverRuntimeLogTarget(ctx, runtimeID, active[runtimeID]); err != nil {
			runner.log.Warn("report runtime logs failed; keeping pending logs", "runtime_id", runtimeID, "error", err)
			// Diagnostics use the ingestion endpoint directly: a saturated local
			// outbox must not hide its own warning behind that same queue.
			var response runtimeLogsResponse
			_ = runner.postWithStatus(ctx, "/api/agents/runtime-logs", runtimeLogsRequest{
				ServerID: runner.cfg.AgentID, Token: runner.currentCredential(),
				Logs: []runtimeLogLine{{RuntimeID: runtimeID, Service: "devpush", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Content: "Runtime log collection paused: " + err.Error() + ". Pending logs are retained; Docker rotation before collection can cause gaps."}},
			}, &response, 200)
		}
	}
}

func (runner *Runner) reportRuntimeLogTarget(ctx context.Context, runtimeID string) error {
	return runner.deliverRuntimeLogTarget(ctx, runtimeID, true)
}

func (runner *Runner) deliverRuntimeLogTarget(ctx context.Context, runtimeID string, collect bool) error {
	state, err := runner.loadRuntimeLogState(runtimeID)
	if err != nil {
		return err
	}
	if len(state.Logs) == 0 && collect {
		now := time.Now().UTC()
		since := state.Since
		if since.IsZero() {
			since = now.Add(-2 * time.Minute)
		}
		lines, until, err := runner.collectRuntimeLogWindow(ctx, runtimeID, since, now.Add(-5*time.Second))
		if err != nil {
			return err
		}
		state.Logs = lines
		state.PendingUntil = until
		if len(lines) == 0 {
			state.Since = state.PendingUntil
		}
		// Persist collected output before attempting delivery. Since only advances
		// after the entire pending capture has been acknowledged.
		if err := runner.saveRuntimeLogState(state); err != nil {
			return err
		}
	}
	if len(state.Logs) == 0 {
		return nil
	}
	batch := runtimeLogBatch(state.Logs)
	var response runtimeLogsResponse
	if err := runner.postWithStatus(ctx, "/api/agents/runtime-logs", runtimeLogsRequest{
		ServerID: runner.cfg.AgentID, Token: runner.currentCredential(), Logs: batch,
	}, &response, 200); err != nil {
		return err
	}
	if !response.OK || response.Accepted != len(batch) {
		return fmt.Errorf("runtime log batch was not fully acknowledged: accepted %d of %d", response.Accepted, len(batch))
	}
	state.Logs = state.Logs[len(batch):]
	if len(state.Logs) == 0 {
		state.Since = state.PendingUntil
		if !collect {
			return runner.removeRuntimeLogState(runtimeID)
		}
	}
	return runner.saveRuntimeLogState(state)
}

func runtimeLogBatch(logs []runtimeLogLine) []runtimeLogLine {
	batchEnd, batchBytes := 0, 2
	for index, line := range logs {
		if index == 500 {
			break
		}
		encoded, err := json.Marshal(line)
		if err != nil {
			break
		}
		if batchEnd > 0 && batchBytes+len(encoded)+1 > maxRuntimeLogBatchBytes {
			break
		}
		batchEnd = index + 1
		batchBytes += len(encoded) + 1
	}
	return append([]runtimeLogLine{}, logs[:batchEnd]...)
}

const maxRuntimeLogCaptureBytes = 1 << 20

var errRuntimeLogCaptureFull = errors.New("runtime log capture exceeds memory limit")

// Keep Buffer private: embedding exposes ReadFrom, which lets io.Copy bypass
// Write and its capture limit when os/exec streams command output.
type runtimeLogCapture struct {
	buffer bytes.Buffer
	full   bool
	cancel context.CancelFunc
}

func (capture *runtimeLogCapture) Write(body []byte) (int, error) {
	if capture.buffer.Len()+len(body) > maxRuntimeLogCaptureBytes {
		capture.full = true
		if capture.cancel != nil {
			capture.cancel()
		}
		return 0, errRuntimeLogCaptureFull
	}
	return capture.buffer.Write(body)
}

func (capture *runtimeLogCapture) Len() int       { return capture.buffer.Len() }
func (capture *runtimeLogCapture) String() string { return capture.buffer.String() }

func (runner *Runner) collectRuntimeLogWindow(ctx context.Context, runtimeID string, since, until time.Time) ([]runtimeLogLine, time.Time, error) {
	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return nil, since, err
	}
	// Read from the beginning of an explicit time interval. On overflow shrink
	// the interval, then resume at its end after durable delivery acknowledgement.
	// Unlike --tail, this never skips the beginning of a busy interval.
	for {
		args := append(append([]string{}, composePrefix...), "-p", runtimeID, "logs", "--no-color", "--timestamps", "--since", since.UTC().Format(time.RFC3339Nano), "--until", until.UTC().Format(time.RFC3339Nano))
		captureCtx, cancel := context.WithCancel(ctx)
		command := agentCommand(captureCtx, composeName, args...)
		command.Env = runner.commandEnv()
		output := runtimeLogCapture{cancel: cancel}
		stderr := runtimeLogCapture{cancel: cancel}
		command.Stdout, command.Stderr = &output, &stderr
		err := command.Run()
		cancel()
		if output.full || stderr.full {
			if until.Sub(since) <= time.Nanosecond {
				return nil, since, errRuntimeLogCaptureFull
			}
			until = since.Add(until.Sub(since) / 2)
			continue
		}
		if err != nil {
			return nil, since, fmt.Errorf("runtime log capture: %w: %s", err, stderr.String())
		}
		lines := []runtimeLogLine{}
		for _, line := range strings.Split(output.String(), "\n") {
			if logLine, ok := parseComposeLogLine(runtimeID, line); ok {
				lines = append(lines, logLine)
			}
		}
		return lines, until, nil
	}
}

func parseComposeLogLine(runtimeID string, line string) (runtimeLogLine, bool) {
	line = strings.TrimRight(line, "\r")
	if strings.TrimSpace(line) == "" {
		return runtimeLogLine{}, false
	}

	service := "runtime"
	content := line
	if before, after, ok := strings.Cut(line, "|"); ok {
		service = strings.TrimSpace(before)
		content = strings.TrimSpace(after)
	}

	observedAt := time.Now().UTC()
	if timestamp, rest, ok := strings.Cut(content, " "); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(timestamp)); err == nil {
			observedAt = parsed.UTC()
			content = strings.TrimSpace(rest)
		}
	}

	if content == "" {
		return runtimeLogLine{}, false
	}

	return runtimeLogLine{
		RuntimeID:  runtimeID,
		Service:    service,
		ObservedAt: observedAt.Format(time.RFC3339Nano),
		Content:    truncateLogLine(content, maxRuntimeLogLineLen),
	}, true
}
