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
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Version = "0.1.0"

var (
	registerRetryInitial  = time.Second
	registerRetryMax      = 30 * time.Second
	errDeploymentCanceled = errors.New("deployment canceled")
)

type Runner struct {
	cfg               Config
	httpClient        *http.Client
	log               *slog.Logger
	runtimeCache      []string
	runtimeCacheUntil time.Time
	runtimeLogSince   map[string]time.Time
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
	}
}

func (runner *Runner) Run(ctx context.Context) error {
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

	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()
	jobTicker := time.NewTicker(5 * time.Second)
	defer jobTicker.Stop()

	runner.sendHeartbeat(ctx)
	runner.claimAndRunJob(ctx)

	for {
		select {
		case <-ctx.Done():
			runner.log.Info("stopping devpush agent")
			return nil
		case <-heartbeatTicker.C:
			runner.sendHeartbeat(ctx)
		case <-jobTicker.C:
			runner.claimAndRunJob(ctx)
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
		Token:        runner.cfg.Token,
		AgentVersion: Version,
	}, &response); err != nil {
		return "", fmt.Errorf("register agent: %w", err)
	}

	runner.log.Info("registered agent", "server_id", response.ServerID)

	return response.ServerID, nil
}

func (runner *Runner) sendHeartbeat(ctx context.Context) {
	var response agentResponse
	payload := agentRequest{
		ServerID:     runner.cfg.AgentID,
		Token:        runner.cfg.Token,
		AgentVersion: Version,
	}
	if metrics := runner.collectHostMetrics(ctx); metrics != nil {
		payload.Metrics = metrics
	}
	runtimeIDs, err := runner.cachedComposeRuntimeIDs(ctx)
	if err != nil {
		runner.log.Warn("runtime discovery failed", "error", err)
	} else {
		payload.RuntimeIDs = runtimeIDs
	}

	err = runner.post(ctx, "/api/agents/heartbeat", payload, &response)
	if err != nil {
		runner.log.Warn("heartbeat failed", "error", err)
		return
	}

	runner.reportRuntimeLogs(ctx, response.RuntimeLogTargets)
	runner.log.Info("heartbeat", "server_id", response.ServerID, "status", response.Status)
}

func (runner *Runner) collectHostMetrics(ctx context.Context) *hostMetrics {
	metrics := hostMetrics{}

	if cpuPercent, err := sampleCPUPercent(ctx); err == nil {
		metrics.CPUPercent = &cpuPercent
	} else {
		runner.log.Debug("cpu metric unavailable", "error", err)
	}

	if load1, err := readLoad1(); err == nil {
		metrics.Load1 = &load1
	} else {
		runner.log.Debug("load metric unavailable", "error", err)
	}

	if used, total, err := readMemoryUsage(); err == nil {
		metrics.MemoryUsedBytes = &used
		metrics.MemoryTotalBytes = &total
	} else {
		runner.log.Debug("memory metric unavailable", "error", err)
	}

	if used, total, err := readDiskUsage("/"); err == nil {
		metrics.DiskUsedBytes = &used
		metrics.DiskTotalBytes = &total
	} else {
		runner.log.Debug("disk metric unavailable", "error", err)
	}

	if !metrics.hasValues() {
		return nil
	}

	return &metrics
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
		Token:    runner.cfg.Token,
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
		ServerID:     runner.cfg.AgentID,
		Token:        runner.cfg.Token,
		AgentVersion: Version,
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
	default:
		runner.log.Warn("unsupported job type", "job_id", response.Job.ID, "type", response.Job.Type)
	}
}

func (runner *Runner) runDeprovisionJob(ctx context.Context, job agentJob) cleanupJobCompletion {
	status := "succeeded"
	message := ""

	fail := func(err error) cleanupJobCompletion {
		status = "failed"
		message = err.Error()
		return cleanupJobCompletion{
			ServerID: runner.cfg.AgentID,
			Token:    runner.cfg.Token,
			Type:     job.Type,
			JobID:    job.ID,
			Status:   status,
			Message:  message,
		}
	}

	for _, runtimeID := range job.Cleanup.RuntimeIDs {
		if strings.TrimSpace(runtimeID) == "" {
			continue
		}

		if err := runner.removeComposeRuntime(ctx, runtimeID, job.Cleanup.RemoveVolumes); err != nil {
			return fail(fmt.Errorf("unable to deprovision runtime %s: %w", runtimeID, err))
		}
	}

	return cleanupJobCompletion{
		ServerID: runner.cfg.AgentID,
		Token:    runner.cfg.Token,
		Type:     job.Type,
		JobID:    job.ID,
		Status:   status,
		Message:  message,
	}
}

func (runner *Runner) runDeploymentJob(ctx context.Context, job deploymentJob) jobCompletion {
	logs := []string{}
	events := []jobEvent{}
	status := "succeeded"
	gitSha := ""
	baseLogSeq := job.LogStartSeq
	if baseLogSeq < 1 {
		baseLogSeq = 1
	}
	flushedLogs := 0
	flushedEvents := 0

	flushProgress := func() {
		if strings.TrimSpace(runner.cfg.ServerURL) == "" {
			return
		}
		if flushedLogs == len(logs) && flushedEvents == len(events) {
			return
		}

		progress := jobProgress{
			ServerID:     runner.cfg.AgentID,
			Token:        runner.cfg.Token,
			DeploymentID: job.ID,
			LogStartSeq:  baseLogSeq + flushedLogs,
			Logs:         append([]string{}, logs[flushedLogs:]...),
			Events:       append([]jobEvent{}, events[flushedEvents:]...),
		}
		if err := runner.reportProgress(ctx, progress); err != nil {
			runner.log.Warn("report deployment progress failed", "deployment_id", job.ID, "error", err)
			return
		}

		flushedLogs = len(logs)
		flushedEvents = len(events)
	}
	makeCompletion := func() jobCompletion {
		return jobCompletion{
			ServerID:     runner.cfg.AgentID,
			Token:        runner.cfg.Token,
			DeploymentID: job.ID,
			Status:       status,
			GitSha:       nullableString(gitSha),
			LogStartSeq:  baseLogSeq + flushedLogs,
			Logs:         append([]string{}, logs[flushedLogs:]...),
			Events:       append([]jobEvent{}, events[flushedEvents:]...),
		}
	}

	addEvent := func(phase string, message string) {
		events = append(events, jobEvent{Phase: phase, Message: message})
		logs = append(logs, message)
		flushProgress()
	}
	fail := func(err error) jobCompletion {
		if errors.Is(err, errDeploymentCanceled) {
			status = "canceled"
			message := "Deployment canceled because a newer deployment was queued."
			addEvent("completed", message)
			return makeCompletion()
		}

		status = "failed"
		message := fmt.Sprintf("Deployment failed: %v", err)
		addEvent("completed", message)
		return makeCompletion()
	}
	run := func(dir string, name string, args ...string) error {
		return runner.runCancellableCommand(ctx, job.ID, dir, &logs, name, args...)
	}

	workdir := filepath.Join(runner.cfg.StateDir, "deployments", job.ID)
	repoDir := filepath.Join(workdir, "repo")
	if err := os.RemoveAll(workdir); err != nil {
		return fail(err)
	}
	if err := os.MkdirAll(workdir, 0o750); err != nil {
		return fail(err)
	}

	addEvent("config_synced", "Deployment configuration received.")

	cloneURL := runner.cloneURL(job.Repo)
	if err := run(workdir, "git", "clone", "--depth", "1", "--branch", job.Repo.Branch, cloneURL, repoDir); err != nil {
		return fail(fmt.Errorf("unable to fetch repository %s branch %s. Check GitHub App repository access and branch name: %w", job.Repo.FullName, job.Repo.Branch, err))
	}
	if job.Repo.Sha != "" {
		if err := run(repoDir, "git", "fetch", "--depth", "1", "origin", job.Repo.Sha); err != nil {
			return fail(fmt.Errorf("unable to fetch commit %s: %w", job.Repo.Sha, err))
		}
		if err := run(repoDir, "git", "checkout", "--detach", job.Repo.Sha); err != nil {
			return fail(fmt.Errorf("unable to checkout commit %s: %w", job.Repo.Sha, err))
		}
	}
	addEvent("repo_fetched", fmt.Sprintf("Fetched %s:%s.", job.Repo.FullName, job.Repo.Branch))

	sha, err := runner.commandOutput(ctx, repoDir, "git", "rev-parse", "--short", "HEAD")
	if err != nil {
		return fail(fmt.Errorf("unable to read deployed Git SHA: %w", err))
	}
	gitSha = strings.TrimSpace(sha)

	composePath := filepath.Join(repoDir, job.Compose.Path)
	if _, err := os.Stat(composePath); err != nil {
		return fail(fmt.Errorf("Compose file %s was not found in the repository checkout. Update the project Compose path or add the file: %w", job.Compose.Path, err))
	}
	addEvent("compose_resolved", fmt.Sprintf("Resolved %s.", job.Compose.Path))
	for _, warning := range composeRiskWarnings(composePath) {
		logs = append(logs, "Warning: "+warning)
	}

	envFile := filepath.Join(workdir, "env")
	if err := writeEnvFile(envFile, job.Compose.EnvVars); err != nil {
		return fail(fmt.Errorf("unable to write deployment environment file: %w", err))
	}

	if err := runner.ensureDockerAvailable(ctx); err != nil {
		return fail(err)
	}
	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return fail(err)
	}

	overrideFile := filepath.Join(workdir, "devpush.compose.yml")
	if len(job.Compose.Routes) > 0 {
		if err := runner.ensureTraefik(ctx, &logs); err != nil {
			return fail(fmt.Errorf("unable to prepare managed Traefik routing. Check Docker access and whether ports 80/443 are already in use: %w", err))
		}
		if err := writeRouteOverride(overrideFile, job.Compose.ProjectName, job.Compose.Routes); err != nil {
			return fail(fmt.Errorf("unable to generate managed Traefik route labels: %w", err))
		}
		addEvent("config_synced", "Generated devpush routing override.")
	}

	composeArgs := []string{
		"--env-file",
		envFile,
		"-p",
		job.Compose.ProjectName,
		"-f",
		composePath,
	}
	if len(job.Compose.Routes) > 0 {
		composeArgs = append(composeArgs, "-f", overrideFile)
	}

	addEvent("revision_started", "Pulling Compose images.")
	pullArgs := append(append([]string{}, composeArgs...), "pull", "--ignore-pull-failures")
	if err := run(repoDir, composeName, append(composePrefix, pullArgs...)...); err != nil {
		return fail(fmt.Errorf("Docker Compose could not pull images. Check image names, registry credentials, and network access: %w", err))
	}

	addEvent("revision_started", "Building Compose services.")
	buildArgs := append(append([]string{}, composeArgs...), "build")
	if err := run(repoDir, composeName, append(composePrefix, buildArgs...)...); err != nil {
		return fail(fmt.Errorf("Docker Compose build failed. Check Dockerfile paths, build context, and build-time environment variables: %w", err))
	}
	addEvent("images_built_or_pulled", "Compose images are ready.")

	if job.Compose.ReleaseCommand != "" {
		addEvent("release_command_started", fmt.Sprintf("Running release command on %s.", job.Compose.ReleaseService))
		releaseArgs := append(
			append([]string{}, composeArgs...),
			"run",
			"--rm",
			job.Compose.ReleaseService,
			"sh",
			"-lc",
			job.Compose.ReleaseCommand,
		)
		if err := run(repoDir, composeName, append(composePrefix, releaseArgs...)...); err != nil {
			return fail(fmt.Errorf("release command failed on service %s. Fix the command or make it safe to rerun before deploying again: %w", job.Compose.ReleaseService, err))
		}
		addEvent("release_command_succeeded", "Release command completed.")
	}

	addEvent("revision_started", "Starting Compose services.")
	upArgs := append(append([]string{}, composeArgs...), "up", "-d", "--no-build")
	if err := run(repoDir, composeName, append(composePrefix, upArgs...)...); err != nil {
		return fail(fmt.Errorf("Docker Compose could not start services. Check service definitions, fixed port conflicts, volumes, and container health: %w", err))
	}
	if err := runner.waitForComposeHealthy(ctx, repoDir, &logs, composeName, composePrefix, composeArgs); err != nil {
		return fail(fmt.Errorf("Docker Compose services did not become healthy: %w", err))
	}

	if len(job.Compose.Routes) > 0 {
		route := job.Compose.Routes[0]
		readinessPath := routeReadinessPath(route.Path, job.Compose.ReadinessPath)
		addEvent("readiness_check_started", fmt.Sprintf("Checking %s%s through Traefik.", route.Host, readinessPath))
		if err := runner.checkReadiness(ctx, route, readinessPath); err != nil {
			return fail(fmt.Errorf("readiness check failed for %s%s through Traefik. Check that the service listens on port %d and returns a 2xx/3xx response: %w", route.Host, readinessPath, route.Port, err))
		}
	}

	addEvent("traffic_switched", "Deployment finished on the target server.")
	addEvent("completed", "Deployment completed.")

	return makeCompletion()
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

func (runner *Runner) deploymentCanceled(ctx context.Context, deploymentID string) bool {
	if strings.TrimSpace(runner.cfg.ServerURL) == "" {
		return false
	}

	var response statusJobResponse
	err := runner.post(ctx, "/api/agents/jobs/status", statusJobRequest{
		ServerID:     runner.cfg.AgentID,
		Token:        runner.cfg.Token,
		DeploymentID: deploymentID,
	}, &response)
	if err != nil {
		runner.log.Warn("read deployment status failed", "deployment_id", deploymentID, "error", err)
		return false
	}

	return response.Status == "canceled"
}

func (runner *Runner) runCancellableCommand(ctx context.Context, deploymentID string, dir string, logs *[]string, name string, args ...string) error {
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

	err := runner.runCommand(commandCtx, dir, logs, name, args...)
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
	safeArgs := redactArgs(args)
	*logs = append(*logs, "$ "+name+" "+strings.Join(safeArgs, " "))

	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
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

func (runner *Runner) commandOutput(ctx context.Context, dir string, name string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
	output, err := command.Output()
	if err != nil {
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

func isReadinessStatus(statusCode int) bool {
	return statusCode >= 200 && statusCode < 400
}

type readinessCheckTarget struct {
	URL string
}

func (runner Runner) readinessTarget(route route, path string) readinessCheckTarget {
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
				ServerName:         route.Host,
				InsecureSkipVerify: true,
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

func (runner Runner) traefikHTTPPort() int {
	if runner.cfg.TraefikHTTPPort > 0 {
		return runner.cfg.TraefikHTTPPort
	}

	return 80
}

func (runner Runner) traefikHTTPSPort() int {
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

	if runner.commandSucceeds(ctx, "", "docker-compose", "version") {
		return "docker-compose", []string{}, nil
	}

	return "", nil, fmt.Errorf("Docker Compose is not available to the devpush agent. Install the Docker Compose plugin or docker-compose")
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

func sampleCPUPercent(ctx context.Context) (float64, error) {
	first, err := readCPUStat()
	if err != nil {
		return 0, err
	}

	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}

	second, err := readCPUStat()
	if err != nil {
		return 0, err
	}

	totalDelta := second.total - first.total
	idleDelta := second.idle - first.idle
	if totalDelta <= 0 {
		return 0, errors.New("cpu total did not advance")
	}

	return roundMetric(100 * float64(totalDelta-idleDelta) / float64(totalDelta)), nil
}

type cpuStat struct {
	total uint64
	idle  uint64
}

func readCPUStat() (cpuStat, error) {
	content, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuStat{}, err
	}

	line, _, _ := strings.Cut(string(content), "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuStat{}, errors.New("invalid /proc/stat cpu line")
	}

	values := make([]uint64, 0, len(fields)-1)
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuStat{}, err
		}
		values = append(values, value)
	}

	var total uint64
	for _, value := range values {
		total += value
	}

	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}

	return cpuStat{total: total, idle: idle}, nil
}

func readLoad1() (float64, error) {
	content, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, err
	}

	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0, errors.New("invalid /proc/loadavg")
	}

	load1, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, err
	}

	return roundMetric(load1), nil
}

func readMemoryUsage() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}

	values := map[string]uint64{}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[key] = value * 1024
	}

	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 || available > total {
		return 0, 0, errors.New("invalid /proc/meminfo")
	}

	return total - available, total, nil
}

func readDiskUsage(path string) (uint64, uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}

	blockSize := uint64(stat.Bsize)
	total := stat.Blocks * blockSize
	available := stat.Bavail * blockSize
	if total == 0 || available > total {
		return 0, 0, errors.New("invalid statfs values")
	}

	return total - available, total, nil
}

func roundMetric(value float64) float64 {
	return math.Round(value*100) / 100
}

type agentRequest struct {
	ServerID     string       `json:"serverId,omitempty"`
	Token        string       `json:"token"`
	AgentVersion string       `json:"agentVersion"`
	RuntimeIDs   []string     `json:"runtimeIds,omitempty"`
	Metrics      *hostMetrics `json:"metrics,omitempty"`
}

type hostMetrics struct {
	CPUPercent       *float64 `json:"cpuPercent,omitempty"`
	Load1            *float64 `json:"load1,omitempty"`
	MemoryUsedBytes  *uint64  `json:"memoryUsedBytes,omitempty"`
	MemoryTotalBytes *uint64  `json:"memoryTotalBytes,omitempty"`
	DiskUsedBytes    *uint64  `json:"diskUsedBytes,omitempty"`
	DiskTotalBytes   *uint64  `json:"diskTotalBytes,omitempty"`
}

func (metrics hostMetrics) hasValues() bool {
	return metrics.CPUPercent != nil ||
		metrics.Load1 != nil ||
		metrics.MemoryUsedBytes != nil ||
		metrics.MemoryTotalBytes != nil ||
		metrics.DiskUsedBytes != nil ||
		metrics.DiskTotalBytes != nil
}

type agentResponse struct {
	ServerID          string             `json:"serverId"`
	Status            string             `json:"status"`
	RuntimeLogTargets []runtimeLogTarget `json:"runtimeLogTargets"`
}

type runtimeLogTarget struct {
	RuntimeID string `json:"runtimeId"`
}

type runtimeLogsRequest struct {
	ServerID string           `json:"serverId"`
	Token    string           `json:"token"`
	Logs     []runtimeLogLine `json:"logs"`
}

type runtimeLogLine struct {
	RuntimeID  string `json:"runtimeId"`
	Service    string `json:"service"`
	ObservedAt string `json:"observedAt"`
	Content    string `json:"content"`
}

type runtimeLogsResponse struct {
	OK       bool `json:"ok"`
	Inserted int  `json:"inserted"`
}

type nextJobResponse struct {
	Job *agentJob `json:"job"`
}

type agentJob struct {
	Type        string        `json:"type"`
	ID          string        `json:"id"`
	LogStartSeq int           `json:"logStartSeq"`
	Repo        repo          `json:"repo"`
	Project     projectConfig `json:"project"`
	Compose     composeConfig `json:"compose"`
	Cleanup     cleanupConfig `json:"cleanup"`
}

type deploymentJob struct {
	ID          string        `json:"id"`
	LogStartSeq int           `json:"logStartSeq"`
	Repo        repo          `json:"repo"`
	Project     projectConfig `json:"project"`
	Compose     composeConfig `json:"compose"`
}

func (job agentJob) deploymentJob() deploymentJob {
	return deploymentJob{
		ID:          job.ID,
		LogStartSeq: job.LogStartSeq,
		Repo:        job.Repo,
		Project:     job.Project,
		Compose:     job.Compose,
	}
}

type projectConfig struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type repo struct {
	FullName string `json:"fullName"`
	Branch   string `json:"branch"`
	Sha      string `json:"sha"`
	Token    string `json:"token"`
}

type composeConfig struct {
	Path           string   `json:"path"`
	ProjectName    string   `json:"projectName"`
	ReleaseCommand string   `json:"releaseCommand"`
	ReleaseService string   `json:"releaseService"`
	ReadinessPath  string   `json:"readinessPath"`
	EnvVars        []envVar `json:"envVars"`
	Routes         []route  `json:"routes"`
}

type envVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type route struct {
	Host        string `json:"host"`
	Service     string `json:"service"`
	Port        int    `json:"port"`
	Path        string `json:"path"`
	HTTPS       bool   `json:"https"`
	StripPrefix bool   `json:"stripPrefix"`
}

type cleanupConfig struct {
	RuntimeIDs    []string `json:"runtimeIds"`
	RemoveVolumes bool     `json:"removeVolumes"`
	Reason        string   `json:"reason"`
}

type jobCompletion struct {
	ServerID     string     `json:"serverId"`
	Token        string     `json:"token"`
	DeploymentID string     `json:"deploymentId"`
	Status       string     `json:"status"`
	GitSha       *string    `json:"gitSha"`
	LogStartSeq  int        `json:"logStartSeq,omitempty"`
	Logs         []string   `json:"logs"`
	Events       []jobEvent `json:"events"`
}

type cleanupJobCompletion struct {
	ServerID string `json:"serverId"`
	Token    string `json:"token"`
	Type     string `json:"type"`
	JobID    string `json:"jobId"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

type jobProgress struct {
	ServerID     string     `json:"serverId"`
	Token        string     `json:"token"`
	DeploymentID string     `json:"deploymentId"`
	LogStartSeq  int        `json:"logStartSeq"`
	Logs         []string   `json:"logs"`
	Events       []jobEvent `json:"events"`
}

type statusJobRequest struct {
	ServerID     string `json:"serverId"`
	Token        string `json:"token"`
	DeploymentID string `json:"deploymentId"`
}

type statusJobResponse struct {
	DeploymentID string `json:"deploymentId"`
	Status       string `json:"status"`
}

type jobEvent struct {
	Phase   string `json:"phase"`
	Message string `json:"message"`
}

type progressJobResponse struct {
	OK bool `json:"ok"`
}

type completeJobResponse struct {
	OK bool `json:"ok"`
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
			warnings = append(warnings, "network_mode: host bypasses Compose network isolation and managed routing.")
		}
		if strings.HasPrefix(trimmed, "privileged:") && strings.Contains(trimmed, "true") {
			warnings = append(warnings, "privileged containers increase host-level risk.")
		}
		if strings.HasPrefix(trimmed, "ports:") {
			inPorts = true
			volumeIndent = indent
			warnings = append(warnings, "published host ports can collide; prefer internal service ports routed by devpush.")
			continue
		}
		if inPorts && strings.Contains(trimmed, ":") && strings.HasPrefix(trimmed, "-") {
			warnings = append(warnings, "fixed host port mapping detected; only the platform proxy should normally bind public ports.")
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

	if len(labelsByService) == 0 {
		return os.WriteFile(path, []byte("services: {}\n"), 0o600)
	}

	var builder strings.Builder
	builder.WriteString("services:\n")
	for service, labels := range labelsByService {
		builder.WriteString("  " + yamlKey(service) + ":\n")
		builder.WriteString("    labels:\n")
		for _, label := range labels {
			builder.WriteString("      - " + yamlString(label) + "\n")
		}
		builder.WriteString("    networks:\n")
		builder.WriteString("      - devpush-proxy\n")
	}
	builder.WriteString("networks:\n")
	builder.WriteString("  devpush-proxy:\n")
	builder.WriteString("    external: true\n")

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
