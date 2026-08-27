package agent

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var Version = "unknown"

const ProtocolVersion = 1

var Capabilities = []string{
	"jobs.compose.deploy.v1",
	"jobs.compose.cleanup.v1",
	"jobs.backup.v1",
	"jobs.backup.cleanup.v1",
	"jobs.restore.v1",
	"runtime.logs.v1",
}

var (
	registerRetryInitial  = time.Second
	registerRetryMax      = 30 * time.Second
	heartbeatInterval     = 30 * time.Second
	heartbeatTimeout      = 20 * time.Second
	jobPollInterval       = 5 * time.Second
	errDeploymentCanceled = errors.New("deployment canceled")
)

type Runner struct {
	cfg                Config
	httpClient         *http.Client
	log                *slog.Logger
	runtimeCache       []string
	runtimeCacheUntil  time.Time
	runtimeLogSince    map[string]time.Time
	lastNetworkReadAt  time.Time
	lastNetworkRecv    uint64
	lastNetworkSent    uint64
	lastDiskReadAt     time.Time
	lastDiskReadBytes  uint64
	lastDiskWriteBytes uint64
	credentialMu       sync.RWMutex
	credential         string
}

func NewRunner(cfg Config, log *slog.Logger) Runner {
	if log == nil {
		log = slog.Default()
	}

	return Runner{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		log:             log,
		runtimeLogSince: map[string]time.Time{},
		credential:      cfg.Token,
	}
}

func (runner *Runner) currentCredential() string {
	runner.credentialMu.RLock()
	defer runner.credentialMu.RUnlock()
	return runner.credential
}

func (runner *Runner) loadCredential() error {
	path := filepath.Join(runner.cfg.StateDir, "credential")
	value, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	credential := strings.TrimSpace(string(value))
	if credential == "" {
		return errors.New("stored agent credential is empty")
	}
	runner.credentialMu.Lock()
	runner.credential = credential
	runner.credentialMu.Unlock()
	return nil
}

func (runner *Runner) acceptCredential(credential string) error {
	if credential == "" || credential == runner.currentCredential() {
		return nil
	}
	if err := os.MkdirAll(runner.cfg.StateDir, 0o750); err != nil {
		return err
	}
	path := filepath.Join(runner.cfg.StateDir, "credential")
	temporary, err := os.CreateTemp(runner.cfg.StateDir, ".credential-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if os.Geteuid() == 0 {
		stateInfo, err := os.Stat(runner.cfg.StateDir)
		if err != nil {
			temporary.Close()
			return err
		}
		if stat, ok := stateInfo.Sys().(*syscall.Stat_t); ok {
			if err := temporary.Chown(int(stat.Uid), int(stat.Gid)); err != nil {
				temporary.Close()
				return err
			}
		}
	}
	if _, err := temporary.WriteString(credential + "\n"); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	runner.credentialMu.Lock()
	runner.credential = credential
	runner.credentialMu.Unlock()
	return nil
}

func (runner *Runner) Run(ctx context.Context) error {
	if err := runner.loadCredential(); err != nil {
		return fmt.Errorf("load agent credential: %w", err)
	}
	runner.log.Info(
		"starting devpush agent",
		"server_url", runner.cfg.ServerURL,
		"state_dir", runner.cfg.StateDir,
	)

	serverID, err := runner.registerWithRetry(ctx)
	if err != nil {
		return err
	}

	runner.cfg.AgentID = serverID

	runAgentLoops(
		ctx,
		heartbeatInterval,
		jobPollInterval,
		func(loopCtx context.Context) {
			heartbeatCtx, cancel := context.WithTimeout(loopCtx, heartbeatTimeout)
			defer cancel()
			runner.sendHeartbeat(heartbeatCtx)
		},
		runner.claimAndRunJob,
	)
	runner.log.Info("stopping devpush agent")
	return nil
}

func (runner *Runner) RotateCredential(ctx context.Context) error {
	if err := runner.loadCredential(); err != nil {
		return fmt.Errorf("load agent credential: %w", err)
	}
	serverID, err := runner.register(ctx)
	if err != nil {
		return err
	}

	var response agentResponse
	if err := runner.post(ctx, "/api/agents/credentials/rotate", agentRequest{
		ServerID:        serverID,
		Token:           runner.currentCredential(),
		AgentVersion:    Version,
		ProtocolVersion: ProtocolVersion,
		Capabilities:    Capabilities,
	}, &response); err != nil {
		return fmt.Errorf("rotate agent credential: %w", err)
	}
	if response.Credential == "" {
		return errors.New("control plane returned an empty agent credential")
	}
	if err := runner.acceptCredential(response.Credential); err != nil {
		return fmt.Errorf("save agent credential: %w", err)
	}

	runner.log.Info("rotated agent credential", "server_id", serverID)
	return nil
}

func runAgentLoops(
	ctx context.Context,
	heartbeatEvery time.Duration,
	jobEvery time.Duration,
	heartbeat func(context.Context),
	job func(context.Context),
) {
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(heartbeatEvery)
		defer ticker.Stop()
		heartbeat(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				heartbeat(ctx)
			}
		}
	}()

	ticker := time.NewTicker(jobEvery)
	defer ticker.Stop()
	job(ctx)
	for {
		select {
		case <-ctx.Done():
			<-heartbeatDone
			return
		case <-ticker.C:
			job(ctx)
		}
	}
}

func (runner *Runner) registerWithRetry(ctx context.Context) (string, error) {
	delay := registerRetryInitial

	for {
		serverID, err := runner.register(ctx)
		if err == nil {
			return serverID, nil
		}

		runner.log.Warn("register agent failed", "error", err, "retry_in", delay)

		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}

		delay *= 2
		if delay > registerRetryMax {
			delay = registerRetryMax
		}
	}
}

func (runner *Runner) register(ctx context.Context) (string, error) {
	var response agentResponse
	if err := runner.post(ctx, "/api/agents/register", agentRequest{
		Token:           runner.currentCredential(),
		AgentVersion:    Version,
		ProtocolVersion: ProtocolVersion,
		Capabilities:    Capabilities,
	}, &response); err != nil {
		return "", fmt.Errorf("register agent: %w", err)
	}
	if err := runner.acceptCredential(response.Credential); err != nil {
		return "", fmt.Errorf("save agent credential: %w", err)
	}

	runner.log.Info("registered agent", "server_id", response.ServerID)

	return response.ServerID, nil
}

func (runner *Runner) sendHeartbeat(ctx context.Context) {
	var response agentResponse
	payload := agentRequest{
		ServerID:        runner.cfg.AgentID,
		Token:           runner.currentCredential(),
		AgentVersion:    Version,
		ProtocolVersion: ProtocolVersion,
		Capabilities:    Capabilities,
	}
	if metrics := runner.collectHostMetrics(ctx); metrics != nil {
		payload.Metrics = metrics
	}
	payload.System = collectHostDetails()
	runtimeIDs, err := runner.cachedComposeRuntimeIDs(ctx)
	if err != nil {
		runner.log.Warn("runtime discovery failed", "error", err)
	} else {
		payload.RuntimeIDs = runtimeIDs
	}
	if runtimes, err := runner.listComposeRuntimeStates(ctx); err != nil {
		runner.log.Warn("runtime state collection failed", "error", err)
	} else {
		payload.Runtimes = runtimes
	}

	err = runner.post(ctx, "/api/agents/heartbeat", payload, &response)
	if err != nil {
		runner.log.Warn("heartbeat failed", "error", err)
		return
	}
	if err := runner.acceptCredential(response.Credential); err != nil {
		runner.log.Warn("save rotated agent credential failed", "error", err)
		return
	}

	runner.reportRuntimeLogs(ctx, response.RuntimeLogTargets)
	runner.log.Info("heartbeat", "server_id", response.ServerID, "status", response.Status)
}

func (runner *Runner) reportRuntimeLogs(ctx context.Context, targets []runtimeLogTarget) {
	if len(targets) == 0 {
		return
	}

	logs := []runtimeLogLine{}
	now := time.Now().UTC()
	for _, target := range targets {
		runtimeID := strings.TrimSpace(target.RuntimeID)
		if runtimeID == "" {
			continue
		}

		since := runner.runtimeLogSince[runtimeID]
		if since.IsZero() {
			since = now.Add(-2 * time.Minute)
		}

		lines, err := runner.collectRuntimeLogs(ctx, runtimeID, since)
		if err != nil {
			runner.log.Warn("collect runtime logs failed", "runtime_id", runtimeID, "error", err)
			continue
		}

		logs = append(logs, lines...)
		runner.runtimeLogSince[runtimeID] = now.Add(-5 * time.Second)
	}

	if len(logs) == 0 {
		return
	}

	if len(logs) > 500 {
		logs = logs[len(logs)-500:]
	}

	if err := runner.post(ctx, "/api/agents/runtime-logs", runtimeLogsRequest{
		ServerID: runner.cfg.AgentID,
		Token:    runner.currentCredential(),
		Logs:     logs,
	}, &runtimeLogsResponse{}); err != nil {
		runner.log.Warn("report runtime logs failed", "error", err)
	}
}

func (runner *Runner) collectRuntimeLogs(ctx context.Context, runtimeID string, since time.Time) ([]runtimeLogLine, error) {
	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return nil, err
	}

	args := append(
		append([]string{}, composePrefix...),
		"-p",
		runtimeID,
		"logs",
		"--no-color",
		"--timestamps",
		"--tail",
		"200",
		"--since",
		since.UTC().Format(time.RFC3339),
	)
	output, err := runner.commandOutput(ctx, "", composeName, args...)
	if err != nil {
		return nil, err
	}

	lines := []runtimeLogLine{}
	for _, line := range strings.Split(output, "\n") {
		logLine, ok := parseComposeLogLine(runtimeID, line)
		if !ok {
			continue
		}
		lines = append(lines, logLine)
	}

	return lines, nil
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
		Content:    content,
	}, true
}

func (runner *Runner) claimAndRunJob(ctx context.Context) {
	var response nextJobResponse
	err := runner.post(ctx, "/api/agents/jobs/next", agentRequest{
		ServerID:        runner.cfg.AgentID,
		Token:           runner.currentCredential(),
		AgentVersion:    Version,
		ProtocolVersion: ProtocolVersion,
		Capabilities:    Capabilities,
	}, &response)
	if err != nil {
		runner.log.Warn("claim job failed", "error", err)
		return
	}
	if response.Job == nil {
		return
	}

	jobCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	switch response.Job.Type {
	case "", "deploy":
		runner.log.Info("claimed deployment job", "deployment_id", response.Job.ID)
		completion := runner.runDeploymentJob(jobCtx, response.Job.deploymentJob())
		if err := runner.completeJob(ctx, completion); err != nil {
			runner.log.Warn("complete job failed", "deployment_id", response.Job.ID, "error", err)
		}
	case "deprovision", "purge":
		runner.log.Info("claimed cleanup job", "job_id", response.Job.ID, "type", response.Job.Type)
		completion := runner.runDeprovisionJob(jobCtx, *response.Job)
		if err := runner.completeCleanupJob(ctx, completion); err != nil {
			runner.log.Warn("complete cleanup job failed", "job_id", response.Job.ID, "error", err)
		}
	case "backup":
		runner.log.Info("claimed backup job", "job_id", response.Job.ID, "backup_run_id", response.Job.Backup.BackupRunID)
		completion := runner.runBackupJob(jobCtx, *response.Job)
		if err := runner.completeBackupJob(ctx, completion); err != nil {
			runner.log.Warn("complete backup job failed", "job_id", response.Job.ID, "error", err)
		}
	case "backup_cleanup":
		runner.log.Info("claimed backup cleanup job", "job_id", response.Job.ID)
		completion := runner.runBackupCleanupJob(jobCtx, *response.Job)
		if err := runner.completeBackupCleanupJob(ctx, completion); err != nil {
			runner.log.Warn("complete backup cleanup job failed", "job_id", response.Job.ID, "error", err)
		}
	case "restore":
		runner.log.Info("claimed restore job", "job_id", response.Job.ID, "backup_run_id", response.Job.Restore.BackupRunID)
		completion := runner.runRestoreJob(jobCtx, *response.Job)
		if err := runner.completeRestoreJob(ctx, completion); err != nil {
			runner.log.Warn("complete restore job failed", "job_id", response.Job.ID, "error", err)
		}
	default:
		runner.log.Warn("unsupported job type", "job_id", response.Job.ID, "type", response.Job.Type)
	}
}

func (runner *Runner) reportProgress(ctx context.Context, progress jobProgress) error {
	var response progressJobResponse
	return runner.post(ctx, "/api/agents/jobs/progress", progress, &response)
}

func (runner *Runner) completeJob(ctx context.Context, completion jobCompletion) error {
	var response completeJobResponse
	return runner.post(ctx, "/api/agents/jobs/complete", completion, &response)
}

func (runner *Runner) completeCleanupJob(ctx context.Context, completion cleanupJobCompletion) error {
	var response completeJobResponse
	return runner.post(ctx, "/api/agents/jobs/complete", completion, &response)
}

func (runner *Runner) completeBackupJob(ctx context.Context, completion backupJobCompletion) error {
	var response completeJobResponse
	return runner.post(ctx, "/api/agents/jobs/complete", completion, &response)
}

func (runner *Runner) completeBackupCleanupJob(ctx context.Context, completion backupCleanupJobCompletion) error {
	var response completeJobResponse
	return runner.post(ctx, "/api/agents/jobs/complete", completion, &response)
}

func (runner *Runner) completeRestoreJob(ctx context.Context, completion restoreJobCompletion) error {
	var response completeJobResponse
	return runner.post(ctx, "/api/agents/jobs/complete", completion, &response)
}

func (runner *Runner) deploymentCanceled(ctx context.Context, deploymentID string) bool {
	if strings.TrimSpace(runner.cfg.ServerURL) == "" {
		return false
	}

	var response statusJobResponse
	err := runner.post(ctx, "/api/agents/jobs/status", statusJobRequest{
		ServerID:     runner.cfg.AgentID,
		Token:        runner.currentCredential(),
		DeploymentID: deploymentID,
	}, &response)
	if err != nil {
		runner.log.Warn("read deployment status failed", "deployment_id", deploymentID, "error", err)
		return false
	}

	return response.Status == "canceled"
}

func (runner *Runner) runCancellableCommand(ctx context.Context, deploymentID string, dir string, logs *[]string, name string, args ...string) error {
	return runner.runCancellableCommandWithEnv(ctx, deploymentID, dir, logs, nil, name, args...)
}

func (runner *Runner) runCancellableCommandWithEnv(ctx context.Context, deploymentID string, dir string, logs *[]string, env []string, name string, args ...string) error {
	if runner.deploymentCanceled(ctx, deploymentID) {
		return errDeploymentCanceled
	}

	commandCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	done := make(chan struct{})
	canceledByServer := make(chan struct{})
	go func() {
		defer close(done)

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-commandCtx.Done():
				return
			case <-ticker.C:
				if runner.deploymentCanceled(ctx, deploymentID) {
					close(canceledByServer)
					cancel()
					return
				}
			}
		}
	}()

	err := runner.runCommandWithEnv(commandCtx, dir, logs, env, name, args...)
	cancel()
	<-done

	select {
	case <-canceledByServer:
		return errDeploymentCanceled
	default:
	}

	return err
}

func (runner *Runner) runCommand(ctx context.Context, dir string, logs *[]string, name string, args ...string) error {
	return runner.runCommandWithEnv(ctx, dir, logs, nil, name, args...)
}

func (runner *Runner) runCommandWithEnv(ctx context.Context, dir string, logs *[]string, env []string, name string, args ...string) error {
	safeArgs := redactArgs(args)
	*logs = append(*logs, "$ "+name+" "+strings.Join(safeArgs, " "))

	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = mergeCommandEnv(runner.commandEnv(), env)
	output, err := command.CombinedOutput()
	outputLines := []string{}
	if len(output) > 0 {
		for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			if strings.TrimSpace(line) != "" {
				redactedLine := redactToken(line)
				outputLines = append(outputLines, redactedLine)
				*logs = append(*logs, redactedLine)
			}
		}
	}
	if err != nil {
		message := fmt.Sprintf("%s %s: %v", name, strings.Join(safeArgs, " "), err)
		if len(outputLines) > 0 {
			message += ": " + outputLines[len(outputLines)-1]
		}

		return fmt.Errorf("%s", message)
	}

	return nil
}

func deploymentCommandEnv(envVars []envVar, values map[string]string) []string {
	env := make([]string, 0, len(envVars)+len(values))
	for _, variable := range envVars {
		key := strings.TrimSpace(variable.Key)
		if key != "" {
			env = append(env, key+"="+variable.Value)
		}
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		env = append(env, key+"="+values[key])
	}
	return env
}

func mergeCommandEnv(groups ...[]string) []string {
	values := map[string]string{}
	order := []string{}
	for _, group := range groups {
		for _, item := range group {
			key, _, ok := strings.Cut(item, "=")
			if !ok || key == "" {
				continue
			}
			if _, exists := values[key]; !exists {
				order = append(order, key)
			}
			values[key] = item
		}
	}
	result := make([]string, 0, len(order))
	for _, key := range order {
		result = append(result, values[key])
	}
	return result
}

func (runner *Runner) removeComposeRuntime(ctx context.Context, runtimeID string, removeVolumes bool) error {
	label := "com.docker.compose.project=" + runtimeID

	containerIDs, err := runner.dockerIDsByLabel(ctx, "ps", "-aq", "--filter", "label="+label)
	if err != nil {
		return err
	}
	if len(containerIDs) > 0 {
		if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"rm", "-f"}, containerIDs...)...); err != nil {
			return err
		}
	}

	networkIDs, err := runner.dockerIDsByLabel(ctx, "network", "ls", "-q", "--filter", "label="+label)
	if err != nil {
		return err
	}
	if len(networkIDs) > 0 {
		if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"network", "rm"}, networkIDs...)...); err != nil {
			return err
		}
	}

	if !removeVolumes {
		return nil
	}

	volumeIDs, err := runner.dockerIDsByLabel(ctx, "volume", "ls", "-q", "--filter", "label="+label)
	if err != nil {
		return err
	}
	if len(volumeIDs) > 0 {
		if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"volume", "rm"}, volumeIDs...)...); err != nil {
			return err
		}
	}

	return nil
}

func (runner *Runner) dockerIDsByLabel(ctx context.Context, args ...string) ([]string, error) {
	output, err := runner.commandOutput(ctx, "", "docker", args...)
	if err != nil {
		return nil, err
	}

	ids := []string{}
	for _, line := range strings.Split(output, "\n") {
		id := strings.TrimSpace(line)
		if id != "" {
			ids = append(ids, id)
		}
	}

	return ids, nil
}

func (runner *Runner) cachedComposeRuntimeIDs(ctx context.Context) ([]string, error) {
	now := time.Now()
	if now.Before(runner.runtimeCacheUntil) {
		return runner.runtimeCache, nil
	}

	runtimeIDs, err := runner.listComposeRuntimeIDs(ctx)
	if err != nil {
		return nil, err
	}

	runner.runtimeCache = runtimeIDs
	runner.runtimeCacheUntil = now.Add(2 * time.Minute)

	return runtimeIDs, nil
}

func (runner *Runner) listComposeRuntimeIDs(ctx context.Context) ([]string, error) {
	output, err := runner.commandOutput(
		ctx,
		"",
		"docker",
		"ps",
		"-a",
		"--filter",
		"label=com.docker.compose.project",
		"--format",
		"{{.Label \"com.docker.compose.project\"}}",
	)
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	runtimeIDs := []string{}
	for _, line := range strings.Split(output, "\n") {
		runtimeID := strings.TrimSpace(line)
		if runtimeID == "" || seen[runtimeID] {
			continue
		}
		seen[runtimeID] = true
		runtimeIDs = append(runtimeIDs, runtimeID)
	}

	return runtimeIDs, nil
}

func (runner *Runner) listComposeRuntimeStates(ctx context.Context) ([]composeRuntime, error) {
	containerIDs, err := runner.dockerIDsByLabel(
		ctx,
		"ps",
		"-aq",
		"--filter",
		"label=com.docker.compose.project",
	)
	if err != nil || len(containerIDs) == 0 {
		return []composeRuntime{}, err
	}

	format := `{{index .Config.Labels "com.docker.compose.project"}}\t{{index .Config.Labels "com.docker.compose.service"}}\t{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}\t{{.RestartCount}}\t{{.State.StartedAt}}\t{{.State.ExitCode}}`
	args := append([]string{"inspect", "--format", format}, containerIDs...)
	output, err := runner.commandOutput(ctx, "", "docker", args...)
	if err != nil {
		return nil, err
	}

	runtimesByID := map[string]*composeRuntime{}
	order := []string{}
	for _, line := range nonEmptyLines(output) {
		fields := strings.Split(line, "\t")
		if len(fields) < 8 {
			continue
		}
		runtimeID := strings.TrimSpace(fields[0])
		serviceName := strings.TrimSpace(fields[1])
		if runtimeID == "" || serviceName == "" {
			continue
		}
		runtimeState := runtimesByID[runtimeID]
		if runtimeState == nil {
			runtimeState = &composeRuntime{RuntimeID: runtimeID}
			runtimesByID[runtimeID] = runtimeState
			order = append(order, runtimeID)
		}
		restartCount, _ := strconv.Atoi(fields[5])
		exitCode, _ := strconv.Atoi(fields[7])
		var health *string
		if value := strings.TrimSpace(fields[4]); value != "" {
			health = &value
		}
		var startedAt *string
		if value := strings.TrimSpace(fields[6]); value != "" && !strings.HasPrefix(value, "0001-") {
			startedAt = &value
		}
		runtimeState.Services = append(runtimeState.Services, composeService{
			Name:          serviceName,
			ContainerName: strings.TrimPrefix(strings.TrimSpace(fields[2]), "/"),
			State:         strings.TrimSpace(fields[3]),
			Health:        health,
			RestartCount:  restartCount,
			StartedAt:     startedAt,
			ExitCode:      exitCode,
		})
	}

	runtimes := make([]composeRuntime, 0, len(order))
	for _, runtimeID := range order {
		runtimes = append(runtimes, *runtimesByID[runtimeID])
	}
	return runtimes, nil
}

func (runner *Runner) commandOutput(ctx context.Context, dir string, name string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		details := strings.TrimSpace(stderr.String())
		if details != "" {
			return "", fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, details)
		}
		return "", fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}

	return string(output), nil
}

func (runner *Runner) checkReadiness(ctx context.Context, route route, path string) error {
	target := runner.readinessTarget(route, path)
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	client := readinessHTTPClient(route)

	for time.Now().Before(deadline) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.URL, nil)
		if err != nil {
			return err
		}
		request.Host = route.Host

		response, err := client.Do(request)
		if err == nil {
			response.Body.Close()
			if isReadinessStatus(response.StatusCode) {
				return nil
			}
			lastErr = fmt.Errorf("readiness returned %s", response.Status)
		} else {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	if lastErr != nil {
		return lastErr
	}

	return fmt.Errorf("readiness check timed out")
}

func (runner *Runner) waitForComposeHealthy(ctx context.Context, dir string, logs *[]string, composeName string, composePrefix []string, composeArgs []string) error {
	deadline := time.Now().Add(60 * time.Second)
	var lastErr error

	for time.Now().Before(deadline) {
		idsOutput, err := runner.commandOutput(ctx, dir, composeName, append(composePrefix, append(append([]string{}, composeArgs...), "ps", "-q")...)...)
		if err != nil {
			lastErr = err
		} else {
			containerIDs := nonEmptyLines(idsOutput)
			if len(containerIDs) == 0 {
				lastErr = fmt.Errorf("no Compose containers were found")
			} else {
				statuses, inspectErr := runner.inspectContainerHealth(ctx, containerIDs)
				if inspectErr != nil {
					lastErr = inspectErr
				} else if allContainersReady(statuses) {
					*logs = append(*logs, "Compose services are running and healthy.")
					return nil
				} else {
					lastErr = errors.New(describeContainerStatuses(statuses))
				}
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	if lastErr != nil {
		return lastErr
	}

	return fmt.Errorf("health check timed out")
}

type containerStatus struct {
	Name   string
	State  string
	Health string
}

func (runner *Runner) inspectContainerHealth(ctx context.Context, containerIDs []string) ([]containerStatus, error) {
	statuses := make([]containerStatus, 0, len(containerIDs))
	for _, id := range containerIDs {
		output, err := runner.commandOutput(
			ctx,
			"",
			"docker",
			"inspect",
			"-f",
			"{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}",
			id,
		)
		if err != nil {
			return nil, err
		}
		fields := strings.Split(strings.TrimSpace(output), "\t")
		status := containerStatus{}
		if len(fields) > 0 {
			status.Name = strings.TrimPrefix(fields[0], "/")
		}
		if len(fields) > 1 {
			status.State = fields[1]
		}
		if len(fields) > 2 {
			status.Health = fields[2]
		}
		statuses = append(statuses, status)
	}

	return statuses, nil
}

func allContainersReady(statuses []containerStatus) bool {
	if len(statuses) == 0 {
		return false
	}
	for _, status := range statuses {
		if status.State != "running" {
			return false
		}
		if status.Health != "" && status.Health != "healthy" {
			return false
		}
	}

	return true
}

func describeContainerStatuses(statuses []containerStatus) string {
	parts := make([]string, 0, len(statuses))
	for _, status := range statuses {
		health := status.Health
		if health == "" {
			health = "no-healthcheck"
		}
		parts = append(parts, fmt.Sprintf("%s=%s/%s", status.Name, status.State, health))
	}

	return strings.Join(parts, ", ")
}

func nonEmptyLines(value string) []string {
	lines := []string{}
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}

	return lines
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}

	return result
}

func isReadinessStatus(statusCode int) bool {
	return statusCode >= 200 && statusCode < 400
}

type readinessCheckTarget struct {
	URL string
}

func (runner *Runner) readinessTarget(route route, path string) readinessCheckTarget {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if route.HTTPS {
		return readinessCheckTarget{URL: fmt.Sprintf("https://127.0.0.1:%d%s", runner.traefikHTTPSPort(), path)}
	}

	return readinessCheckTarget{URL: fmt.Sprintf("http://127.0.0.1:%d%s", runner.traefikHTTPPort(), path)}
}

func readinessHTTPClient(route route) *http.Client {
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	if route.HTTPS {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				ServerName: route.Host,
			},
		}
	}

	return client
}

func (runner *Runner) ensureTraefik(ctx context.Context, logs *[]string) error {
	if err := runner.runCommand(ctx, "", logs, "docker", "network", "inspect", "devpush-proxy"); err != nil {
		if err := runner.runCommand(ctx, "", logs, "docker", "network", "create", "devpush-proxy"); err != nil {
			return fmt.Errorf("create Docker network devpush-proxy: %w", err)
		}
	}

	if err := runner.runCommand(ctx, "", logs, "docker", "volume", "inspect", "devpush-traefik-acme"); err != nil {
		if err := runner.runCommand(ctx, "", logs, "docker", "volume", "create", "devpush-traefik-acme"); err != nil {
			return fmt.Errorf("create Docker volume devpush-traefik-acme: %w", err)
		}
	}

	if err := runner.ensureDockerSocketProxy(ctx, logs); err != nil {
		return err
	}

	if runner.commandSucceeds(ctx, "", "docker", "inspect", "devpush-traefik") {
		configured, err := runner.traefikUsesSocketProxy(ctx)
		if err != nil {
			return err
		}
		if !configured {
			*logs = append(*logs, "Replacing devpush-traefik to use the devpush Docker socket proxy.")
			if err := runner.runCommand(ctx, "", logs, "docker", "rm", "-f", "devpush-traefik"); err != nil {
				return fmt.Errorf("replace devpush-traefik container: %w", err)
			}
		} else {
			running, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{.State.Running}}", "devpush-traefik")
			if err != nil {
				return fmt.Errorf("inspect devpush-traefik container state: %w", err)
			}
			if strings.TrimSpace(running) != "true" {
				if err := runner.runCommand(ctx, "", logs, "docker", "start", "devpush-traefik"); err != nil {
					return fmt.Errorf("start existing devpush-traefik container: %w", err)
				}
				return nil
			}

			*logs = append(*logs, "devpush Traefik is already running.")
			return nil
		}
	}

	args := []string{
		"run",
		"-d",
		"--name",
		"devpush-traefik",
		"--restart",
		"unless-stopped",
		"--network",
		"devpush-proxy",
		"-p",
		fmt.Sprintf("%d:80", runner.traefikHTTPPort()),
		"-p",
		fmt.Sprintf("%d:443", runner.traefikHTTPSPort()),
		"-v",
		"devpush-traefik-acme:/letsencrypt",
		"traefik:v3",
		"--providers.docker=true",
		"--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375",
		"--providers.docker.exposedbydefault=false",
		"--entrypoints.web.address=:80",
		"--entrypoints.websecure.address=:443",
		"--certificatesresolvers.devpush.acme.httpchallenge=true",
		"--certificatesresolvers.devpush.acme.httpchallenge.entrypoint=web",
		"--certificatesresolvers.devpush.acme.storage=/letsencrypt/acme.json",
	}
	if runner.cfg.TraefikEmail != "" {
		args = append(args, "--certificatesresolvers.devpush.acme.email="+runner.cfg.TraefikEmail)
	}

	if err := runner.runCommand(ctx, "", logs, "docker", args...); err != nil {
		return fmt.Errorf("start devpush-traefik container: %w", err)
	}

	return nil
}

func (runner *Runner) traefikHTTPPort() int {
	if runner.cfg.TraefikHTTPPort > 0 {
		return runner.cfg.TraefikHTTPPort
	}

	return 80
}

func (runner *Runner) traefikHTTPSPort() int {
	if runner.cfg.TraefikHTTPSPort > 0 {
		return runner.cfg.TraefikHTTPSPort
	}

	return 443
}

func (runner *Runner) traefikUsesSocketProxy(ctx context.Context) (bool, error) {
	command, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .Config.Cmd}}", "devpush-traefik")
	if err != nil {
		return false, fmt.Errorf("inspect devpush-traefik container command: %w", err)
	}
	if strings.Contains(command, "--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375") {
		return true, nil
	}

	mounts, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .Mounts}}", "devpush-traefik")
	if err != nil {
		return false, fmt.Errorf("inspect devpush-traefik container mounts: %w", err)
	}
	if strings.Contains(mounts, "/var/run/docker.sock") {
		return false, nil
	}

	return false, nil
}

func (runner *Runner) ensureDockerSocketProxy(ctx context.Context, logs *[]string) error {
	if runner.commandSucceeds(ctx, "", "docker", "inspect", "devpush-docker-socket-proxy") {
		configured, err := runner.dockerSocketProxySupportsEvents(ctx)
		if err != nil {
			return err
		}
		if !configured {
			*logs = append(*logs, "Replacing devpush-docker-socket-proxy to expose Docker events.")
			if err := runner.runCommand(ctx, "", logs, "docker", "rm", "-f", "devpush-docker-socket-proxy"); err != nil {
				return fmt.Errorf("replace devpush-docker-socket-proxy container: %w", err)
			}
		} else {
			running, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{.State.Running}}", "devpush-docker-socket-proxy")
			if err != nil {
				return fmt.Errorf("inspect devpush-docker-socket-proxy container state: %w", err)
			}
			if strings.TrimSpace(running) != "true" {
				if err := runner.runCommand(ctx, "", logs, "docker", "start", "devpush-docker-socket-proxy"); err != nil {
					return fmt.Errorf("start existing devpush-docker-socket-proxy container: %w", err)
				}
			}
			return nil
		}
	}

	args := []string{
		"run",
		"-d",
		"--name",
		"devpush-docker-socket-proxy",
		"--restart",
		"unless-stopped",
		"--network",
		"devpush-proxy",
		"-v",
		"/var/run/docker.sock:/var/run/docker.sock:ro",
		"-e",
		"CONTAINERS=1",
		"-e",
		"EVENTS=1",
		"-e",
		"INFO=1",
		"-e",
		"NETWORKS=1",
		"-e",
		"SERVICES=1",
		"-e",
		"TASKS=1",
		"-e",
		"VERSION=1",
		"tecnativa/docker-socket-proxy:0.3",
	}
	if err := runner.runCommand(ctx, "", logs, "docker", args...); err != nil {
		return fmt.Errorf("start devpush-docker-socket-proxy container: %w", err)
	}

	return nil
}

func (runner *Runner) dockerSocketProxySupportsEvents(ctx context.Context) (bool, error) {
	env, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .Config.Env}}", "devpush-docker-socket-proxy")
	if err != nil {
		return false, fmt.Errorf("inspect devpush-docker-socket-proxy environment: %w", err)
	}

	return strings.Contains(env, "EVENTS=1"), nil
}

func (runner *Runner) ensureDockerAvailable(ctx context.Context) error {
	if runner.commandSucceeds(ctx, "", "docker", "version") {
		return nil
	}

	return fmt.Errorf("Docker is not available to the devpush agent. Install Docker, start the Docker daemon, and make sure the devpush user can access it")
}

func (runner *Runner) composeCommand(ctx context.Context) (string, []string, error) {
	if runner.commandSucceeds(ctx, "", "docker", "compose", "version") {
		return "docker", []string{"compose"}, nil
	}

	return "", nil, fmt.Errorf("Docker Compose is not available to the devpush agent. Install the Docker Compose plugin")
}

func (runner *Runner) cloneURL(repo repo) string {
	baseURL := strings.TrimRight(runner.cfg.GitCloneBase, "/")
	if baseURL == "" || baseURL == "https://github.com" {
		return fmt.Sprintf(
			"https://x-access-token:%s@github.com/%s.git",
			repo.Token,
			repo.FullName,
		)
	}

	return fmt.Sprintf("%s/%s.git", baseURL, repo.FullName)
}

func (runner *Runner) post(ctx context.Context, path string, payload any, response any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := strings.TrimRight(runner.cfg.ServerURL, "/") + path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}

	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "devpush-agent/"+Version)

	result, err := runner.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer result.Body.Close()

	if result.StatusCode < 200 || result.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(result.Body, 4096))
		return fmt.Errorf("control plane returned %s: %s", result.Status, strings.TrimSpace(string(body)))
	}

	return json.NewDecoder(result.Body).Decode(response)
}

func (runner *Runner) commandSucceeds(ctx context.Context, dir string, name string, args ...string) bool {
	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
	return command.Run() == nil
}

func (runner *Runner) commandEnv() []string {
	env := os.Environ()
	if runner.cfg.DockerHost != "" {
		env = append(env, "DOCKER_HOST="+runner.cfg.DockerHost)
	}

	return env
}

func writeEnvFile(path string, envVars []envVar) error {
	lines := []string{}
	for _, envVar := range envVars {
		if strings.TrimSpace(envVar.Key) == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s=%s", envVar.Key, quoteEnvValue(envVar.Value)))
	}

	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}

func composeRiskWarnings(path string) []string {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	warnings := []string{}
	lines := strings.Split(string(content), "\n")
	inPorts := false
	inVolumeDefinition := false
	volumeIndent := -1
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := leadingSpaces(line)
		if inPorts && indent <= volumeIndent {
			inPorts = false
		}
		if inVolumeDefinition && indent <= volumeIndent {
			inVolumeDefinition = false
		}

		if strings.HasPrefix(trimmed, "container_name:") {
			warnings = append(warnings, "container_name disables Compose project scoping and can collide across deployments.")
		}
		if strings.HasPrefix(trimmed, "network_mode:") && strings.Contains(trimmed, "host") {
			warnings = append(warnings, "network_mode: host is ignored to preserve Compose network isolation and managed routing.")
		}
		if strings.HasPrefix(trimmed, "privileged:") && strings.Contains(trimmed, "true") {
			warnings = append(warnings, "privileged containers increase host-level risk.")
		}
		if strings.HasPrefix(trimmed, "ports:") {
			inPorts = true
			volumeIndent = indent
			warnings = append(warnings, "published host ports are ignored by devpush managed ingress.")
			continue
		}
		if inPorts && strings.Contains(trimmed, ":") && strings.HasPrefix(trimmed, "-") {
			warnings = append(warnings, "fixed host port mapping detected; devpush will remove it from the deployed Compose model.")
		}
		if strings.HasPrefix(trimmed, "volumes:") {
			inVolumeDefinition = true
			volumeIndent = indent
			continue
		}
		if inVolumeDefinition && strings.HasPrefix(trimmed, "name:") {
			warnings = append(warnings, "explicit volume names are global and may share or collide across runtimes.")
		}
		if inVolumeDefinition && strings.HasPrefix(trimmed, "external:") && strings.Contains(trimmed, "true") {
			warnings = append(warnings, "external volumes or networks are shared by design; ensure that is intentional.")
		}
	}

	return dedupeStrings(warnings)
}

func leadingSpaces(value string) int {
	count := 0
	for _, char := range value {
		if char != ' ' {
			break
		}
		count++
	}

	return count
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}

	return result
}

func writeRouteOverride(path string, projectName string, routes []route) error {
	return writeManagedComposeOverride(path, projectName, routes, nil, nil)
}

type resolvedComposeModel struct {
	Services map[string]resolvedComposeService `json:"services"`
}

type resolvedComposeService struct {
	Ports       []json.RawMessage `json:"ports"`
	NetworkMode string            `json:"network_mode"`
}

func parseComposeModel(value string) (resolvedComposeModel, error) {
	model := resolvedComposeModel{}
	if err := json.Unmarshal([]byte(value), &model); err != nil {
		return resolvedComposeModel{}, err
	}
	if model.Services == nil {
		return resolvedComposeModel{}, fmt.Errorf("resolved configuration has no services")
	}
	return model, nil
}

func (model resolvedComposeModel) servicesWithPublishedPorts() []string {
	services := []string{}
	for name, service := range model.Services {
		if len(service.Ports) > 0 {
			services = append(services, name)
		}
	}
	sort.Strings(services)
	return services
}

func (model resolvedComposeModel) servicesWithHostNetworking() []string {
	services := []string{}
	for name, service := range model.Services {
		if service.NetworkMode == "host" {
			services = append(services, name)
		}
	}
	sort.Strings(services)
	return services
}

func writeManagedComposeOverride(path string, projectName string, routes []route, resetPortServices []string, resetHostNetworkServices []string) error {
	labelsByService := map[string][]string{}
	for index, route := range routes {
		if err := validateRoute(route); err != nil {
			return fmt.Errorf("route %d: %w", index+1, err)
		}

		routerName := sanitizeLabelName(fmt.Sprintf("%s-%s-%d", projectName, route.Service, index+1))
		serviceName := routerName
		labels := []string{
			"traefik.enable=true",
			"traefik.docker.network=devpush-proxy",
			fmt.Sprintf("traefik.http.services.%s.loadbalancer.server.port=%d", serviceName, route.Port),
		}
		routeMiddlewares := []string{}
		if route.StripPrefix && normalizeRoutePath(route.Path) != "/" {
			stripName := routerName + "-strip"
			labels = append(labels, fmt.Sprintf("traefik.http.middlewares.%s.stripprefix.prefixes=%s", stripName, normalizeRoutePath(route.Path)))
			routeMiddlewares = append(routeMiddlewares, stripName)
		}
		if route.HTTPS {
			webRouterName := routerName + "-web"
			secureRouterName := routerName + "-secure"
			redirectName := routerName + "-https"
			webMiddlewares := append([]string{redirectName}, routeMiddlewares...)
			labels = append(
				labels,
				fmt.Sprintf("traefik.http.middlewares.%s.redirectscheme.scheme=https", redirectName),
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", webRouterName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", webRouterName),
				fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", webRouterName, strings.Join(webMiddlewares, ",")),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", webRouterName, serviceName),
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", secureRouterName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=websecure", secureRouterName),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", secureRouterName, serviceName),
				fmt.Sprintf("traefik.http.routers.%s.tls=true", secureRouterName),
				fmt.Sprintf("traefik.http.routers.%s.tls.certresolver=devpush", secureRouterName),
			)
			if len(routeMiddlewares) > 0 {
				labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", secureRouterName, strings.Join(routeMiddlewares, ",")))
			}
		} else {
			labels = append(
				labels,
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", routerName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", routerName),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", routerName, serviceName),
			)
			if len(routeMiddlewares) > 0 {
				labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", routerName, strings.Join(routeMiddlewares, ",")))
			}
		}
		labelsByService[route.Service] = append(labelsByService[route.Service], labels...)
	}

	resetPorts := map[string]bool{}
	for _, service := range resetPortServices {
		if strings.TrimSpace(service) != "" {
			resetPorts[service] = true
		}
	}
	resetHostNetwork := map[string]bool{}
	for _, service := range resetHostNetworkServices {
		if strings.TrimSpace(service) != "" {
			resetHostNetwork[service] = true
		}
	}

	if len(labelsByService) == 0 && len(resetPorts) == 0 && len(resetHostNetwork) == 0 {
		return os.WriteFile(path, []byte("services: {}\n"), 0o600)
	}

	serviceNames := make([]string, 0, len(labelsByService)+len(resetPorts)+len(resetHostNetwork))
	seenServices := map[string]bool{}
	for service := range labelsByService {
		seenServices[service] = true
		serviceNames = append(serviceNames, service)
	}
	for service := range resetPorts {
		if !seenServices[service] {
			seenServices[service] = true
			serviceNames = append(serviceNames, service)
		}
	}
	for service := range resetHostNetwork {
		if !seenServices[service] {
			seenServices[service] = true
			serviceNames = append(serviceNames, service)
		}
	}
	sort.Strings(serviceNames)

	var builder strings.Builder
	builder.WriteString("services:\n")
	for _, service := range serviceNames {
		labels := labelsByService[service]
		builder.WriteString("  " + yamlKey(service) + ":\n")
		if resetPorts[service] {
			builder.WriteString("    ports: !reset []\n")
		}
		if resetHostNetwork[service] {
			builder.WriteString("    network_mode: !reset null\n")
		}
		if len(labels) > 0 {
			builder.WriteString("    labels:\n")
			for _, label := range labels {
				builder.WriteString("      - " + yamlString(label) + "\n")
			}
			builder.WriteString("    networks:\n")
			builder.WriteString("      - devpush-proxy\n")
		}
	}
	if len(labelsByService) > 0 {
		builder.WriteString("networks:\n")
		builder.WriteString("  devpush-proxy:\n")
		builder.WriteString("    external: true\n")
	}

	return os.WriteFile(path, []byte(builder.String()), 0o600)
}

func validateRoute(route route) error {
	if strings.TrimSpace(route.Host) == "" {
		return fmt.Errorf("host is required")
	}
	if !isValidRouteHost(route.Host) {
		return fmt.Errorf("host must be a valid DNS hostname without protocol, path, wildcard, or port")
	}
	if strings.TrimSpace(route.Service) == "" {
		return fmt.Errorf("service is required")
	}
	for _, char := range route.Service {
		valid := (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' ||
			char == '_' ||
			char == '.'
		if !valid {
			return fmt.Errorf("service contains unsupported characters")
		}
	}
	if route.Port < 1 || route.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	if route.Path == "" {
		return fmt.Errorf("path is required")
	}
	if !strings.HasPrefix(route.Path, "/") {
		return fmt.Errorf("path must start with /")
	}
	if strings.ContainsAny(route.Path, "` \t\r\n?#") {
		return fmt.Errorf("path contains unsupported whitespace, query, fragment, or backtick character")
	}

	return nil
}

func isValidRouteHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" || len(host) > 253 {
		return false
	}
	if strings.Contains(host, "*") || strings.Contains(host, "/") || strings.Contains(host, "`") {
		return false
	}
	if _, port, err := strings.Cut(host, ":"); err {
		if port == "" {
			return false
		}
		if _, parseErr := strconv.Atoi(port); parseErr == nil {
			return false
		}
		return false
	}

	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			valid := (char >= 'a' && char <= 'z') ||
				(char >= 'A' && char <= 'Z') ||
				(char >= '0' && char <= '9') ||
				char == '-'
			if !valid {
				return false
			}
		}
	}

	return true
}

func routeRule(route route) string {
	rule := fmt.Sprintf("Host(`%s`)", route.Host)
	path := normalizeRoutePath(route.Path)
	if path != "/" {
		rule += fmt.Sprintf(" && PathPrefix(`%s`)", path)
	}

	return rule
}

func routeReadinessPath(routePath string, readinessPath string) string {
	readinessPath = strings.TrimSpace(readinessPath)
	if readinessPath == "" {
		readinessPath = "/"
	}
	if !strings.HasPrefix(readinessPath, "/") {
		readinessPath = "/" + readinessPath
	}

	routePath = normalizeRoutePath(routePath)
	if routePath == "" || routePath == "/" {
		return readinessPath
	}

	if readinessPath == routePath || strings.HasPrefix(readinessPath, routePath+"/") {
		return readinessPath
	}

	return routePath + readinessPath
}

func normalizeRoutePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if path != "/" {
		path = strings.TrimRight(path, "/")
	}
	if path == "" {
		return "/"
	}

	return path
}

func sanitizeLabelName(value string) string {
	value = strings.ToLower(value)
	var builder strings.Builder
	previousDash := false
	for _, char := range value {
		valid := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if valid {
			builder.WriteRune(char)
			previousDash = false
			continue
		}
		if !previousDash {
			builder.WriteRune('-')
			previousDash = true
		}
	}

	return strings.Trim(builder.String(), "-")
}

func sanitizeArtifactName(value string) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, char := range value {
		valid := (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '.' ||
			char == '_' ||
			char == '-'
		if valid {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('-')
		}
	}

	return strings.Trim(builder.String(), ".-_")
}

func pathJoinS3(parts ...string) string {
	cleaned := []string{}
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}

	return strings.Join(cleaned, "/")
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func yamlKey(value string) string {
	if value == "" {
		return "service"
	}

	return yamlString(value)
}

func yamlString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func quoteEnvValue(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}

	return &value
}

func redactArgs(args []string) []string {
	redacted := make([]string, len(args))
	for index, arg := range args {
		redacted[index] = redactToken(arg)
	}

	return redacted
}

func redactToken(value string) string {
	if !strings.Contains(value, "x-access-token:") {
		return value
	}

	prefix, rest, ok := strings.Cut(value, "x-access-token:")
	if !ok {
		return value
	}
	_, suffix, ok := strings.Cut(rest, "@")
	if !ok {
		return prefix + "x-access-token:***"
	}

	return prefix + "x-access-token:***@" + suffix
}
