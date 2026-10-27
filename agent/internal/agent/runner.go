package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

var Version = "unknown"

const ProtocolVersion = 1

const (
	maxCommandOutputBytes   = 4 << 20
	maxDeploymentLogLineLen = 65_536
	maxRuntimeLogBatchBytes = 8 << 20
	maxRuntimeLogLineLen    = 16_384
)

var Capabilities = []string{
	"jobs.compose.deploy.v1",
	"jobs.compose.cleanup.v2",
	"jobs.backup.v1",
	"jobs.backup.archive.v1",
	"jobs.backup.cleanup.v1",
	"jobs.restore.v1",
	"runtime.logs.v1",
	"metrics.history.v1",
	"ingress.certificates.v1",
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
	certificateNextAt time.Time
	discoverAddress   func(context.Context, string, string) (string, error)
	addressMu         sync.RWMutex
	publicIpv4        string
	publicIpv6        string

	cfg                    Config
	httpClient             *http.Client
	log                    *slog.Logger
	runtimeCache           []string
	runtimeCacheUntil      time.Time
	runtimeLogTargetOffset int
	lastNetworkReadAt      time.Time
	lastNetworkRecv        uint64
	lastNetworkSent        uint64
	lastDiskReadAt         time.Time
	lastDiskReadBytes      uint64
	lastDiskWriteBytes     uint64
	credentialMu           sync.RWMutex
	credential             string
}

func NewRunner(cfg Config, log *slog.Logger) Runner {
	if log == nil {
		log = slog.Default()
	}

	return Runner{
		discoverAddress: discoverPublicAddress, cfg: cfg,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		log:        log,
		credential: cfg.Token,
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
		"base_url", runner.cfg.BaseURL,
		"state_dir", runner.cfg.StateDir,
	)

	runner.refreshPublicAddresses(ctx)
	go runner.refreshPublicAddressLoop(ctx)
	serverID, err := runner.registerWithRetry(ctx)
	if err != nil {
		return err
	}

	runner.cfg.AgentID = serverID
	// A new process resumes claims only after registration with its selected origin.
	if err := Resume(runner.cfg); err != nil {
		return err
	}

	logCtx, cancelLogs := context.WithCancel(ctx)
	defer cancelLogs()
	go runner.runJobLogUploads(logCtx)

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
	ipv4, ipv6 := runner.publicAddresses()
	var response agentResponse
	if err := runner.post(ctx, "/api/agents/register", agentRequest{
		PublicIpv4: ipv4, PublicIpv6: ipv6, RoutingAddress: runner.cfg.RoutingAddress,
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
	ipv4, ipv6 := runner.publicAddresses()
	var response agentResponse
	payload := agentRequest{
		PublicIpv4: ipv4, PublicIpv6: ipv6, RoutingAddress: runner.cfg.RoutingAddress,
		ServerID:        runner.cfg.AgentID,
		Token:           runner.currentCredential(),
		AgentVersion:    Version,
		ProtocolVersion: ProtocolVersion,
		Capabilities:    Capabilities,
	}
	history, samples, metricErr := runner.prepareMetricBatch(runner.collectHostMetrics(ctx), time.Now())
	if metricErr != nil {
		runner.log.Error("persist metric history failed", "error", metricErr)
	} else {
		payload.MetricSamples = samples
	}
	payload.System = collectHostDetails()
	runtimeIDs, err := runner.cachedComposeRuntimeIDs(ctx)
	if err == nil {
		runtimeIDs, err = heartbeatRuntimeIDs(runtimeIDs)
	}
	if err != nil {
		runner.log.Warn("runtime discovery failed", "error", err)
	} else {
		payload.RuntimeIDs = runtimeIDs
	}
	runtimes, stateErr := runner.listComposeRuntimeStates(ctx)
	if stateErr == nil {
		runtimes, stateErr = heartbeatRuntimeStates(runtimes)
	}
	if stateErr != nil {
		runner.log.Warn("runtime state collection failed", "error", stateErr)
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

	if metricErr == nil {
		if err := runner.acknowledgeMetrics(history, samples, response.MetricsAcceptedThrough); err != nil {
			runner.log.Warn("metric acknowledgment failed", "error", err)
		}
	}
	if response.ManagedCertificates {
		if err := runner.syncManagedCertificate(ctx); err != nil {
			runner.log.Warn("managed certificate sync failed", "error", err)
		}
	}
	runner.reportRuntimeLogs(ctx, response.RuntimeLogTargets)
	runner.log.Info("heartbeat", "server_id", response.ServerID, "status", response.Status)
	if response.Status == "connected" {
		if err := os.WriteFile(filepath.Join(runner.cfg.StateDir, readyFile), []byte(runner.cfg.BaseURL+"\n"), 0600); err != nil {
			runner.log.Warn("write maintenance readiness failed", "error", err)
		}
	}
}

func (runner *Runner) claimAndRunJob(ctx context.Context) {
	lock, err := runner.lockJob()
	if err != nil {
		return
	}
	defer unlockJob(lock)
	if err := runner.recoverInterruptedRestores(ctx); err != nil {
		runner.log.Error("restore recovery blocks job claims", "error", err)
		return
	}
	if err := runner.flushPendingCompletions(ctx); err != nil {
		runner.log.Warn("deliver pending completion failed", "error", err)
		return
	}

	var response nextJobResponse
	err = runner.post(ctx, "/api/agents/jobs/next", agentRequest{
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

	if err := runner.prepareInterruptedCompletion(*response.Job); err != nil {
		runner.log.Error("cannot persist job recovery record; job will not execute", "job_id", response.Job.ID, "error", err)
		if reportErr := runner.reportUnstartedJob(ctx, *response.Job); reportErr != nil {
			runner.log.Error("cannot report unstarted job; control-plane timeout recovery required", "job_id", response.Job.ID, "error", reportErr)
		}
		return
	}

	jobCtx, cancel := context.WithTimeout(ctx, agentJobTimeout(*response.Job))
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
	if err := runner.postWithStatus(ctx, "/api/agents/jobs/progress", progress, &response, http.StatusOK); err != nil {
		return err
	}
	if !response.OK {
		return errors.New("control plane did not acknowledge deployment progress")
	}
	return nil
}

func (runner *Runner) completeJob(ctx context.Context, completion jobCompletion) error {
	return runner.deliverCompletion(ctx, completion.DeploymentID, completion)
}

func (runner *Runner) completeCleanupJob(ctx context.Context, completion cleanupJobCompletion) error {
	return runner.deliverCompletion(ctx, completion.JobID, completion)
}

func (runner *Runner) completeBackupJob(ctx context.Context, completion backupJobCompletion) error {
	return runner.deliverCompletion(ctx, completion.JobID, completion)
}

func (runner *Runner) completeBackupCleanupJob(ctx context.Context, completion backupCleanupJobCompletion) error {
	return runner.deliverCompletion(ctx, completion.JobID, completion)
}

func (runner *Runner) completeRestoreJob(ctx context.Context, completion restoreJobCompletion) error {
	return runner.deliverCompletion(ctx, completion.JobID, completion)
}

func agentJobTimeout(job agentJob) time.Duration {
	switch job.Type {
	case "backup", "backup_cleanup", "restore":
		return 24 * time.Hour
	case "deprovision", "purge":
		return 2 * time.Hour
	default:
		return 3 * time.Hour
	}
}

func (runner *Runner) deploymentCanceled(ctx context.Context, deploymentID string) bool {
	if strings.TrimSpace(runner.cfg.BaseURL) == "" {
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
	commandEnv := mergeCommandEnv(runner.commandEnv(), env)
	var secrets []string
	if name == "git" {
		commandEnv, secrets = gitCommandEnvironment(commandEnv)
	}
	safeArgs := redactArgs(args)
	for index := range safeArgs {
		safeArgs[index] = redactCommandOutput(safeArgs[index], secrets)
	}
	// Retain bounded diagnostics across all commands, without affecting execution.
	const marker = "[deployment command logs truncated; execution continues]"
	used := 0
	truncated := false
	for _, line := range *logs {
		used += len(line)
		truncated = truncated || line == marker
	}
	appendOutput := func(line string) {
		if len(*logs) >= 10_000 || used+len(line) > (10<<20)-len(marker) {
			if !truncated {
				truncated = true
				*logs = append(*logs, marker)
				used += len(marker)
			}
			return
		}
		*logs = append(*logs, line)
		used += len(line)
	}
	appendOutput(truncateLogLine("$ "+name+" "+strings.Join(safeArgs, " "), maxDeploymentLogLineLen))

	command := agentCommand(ctx, name, args...)
	command.Dir = dir
	command.Env = commandEnv
	output := cappedTailBuffer{maxBytes: maxCommandOutputBytes}
	command.Stdout = &output
	command.Stderr = &output
	err := command.Run()
	lastOutput := ""
	retained := output.Bytes()
	if output.truncated {
		appendOutput("[command output truncated to the last 4 MiB]")
		// A tail may begin inside a credential. Never expose its partial line.
		if newline := bytes.IndexByte(retained, '\n'); newline >= 0 {
			retained = retained[newline+1:]
		} else {
			retained = nil
		}
	}
	if len(retained) > 0 {
		for line := range strings.SplitSeq(strings.TrimSpace(string(retained)), "\n") {
			if strings.TrimSpace(line) != "" {
				redactedLine := truncateLogLine(
					redactCommandOutput(line, secrets),
					maxDeploymentLogLineLen,
				)
				lastOutput = redactedLine
				appendOutput(redactedLine)
			}
		}
	}
	if err != nil {
		message := fmt.Sprintf("%s %s: %v", name, strings.Join(safeArgs, " "), err)
		if lastOutput != "" {
			message += ": " + lastOutput
		}

		return fmt.Errorf("%s", message)
	}

	return nil
}

type cappedTailBuffer struct {
	data      []byte
	maxBytes  int
	head      int
	truncated bool
}

func (buffer *cappedTailBuffer) Write(value []byte) (int, error) {
	written := len(value)
	if written == 0 || buffer.maxBytes <= 0 {
		return written, nil
	}
	if written >= buffer.maxBytes {
		buffer.truncated = buffer.truncated || written > buffer.maxBytes || len(buffer.data) > 0
		buffer.data = append(buffer.data[:0], value[written-buffer.maxBytes:]...)
		buffer.head = 0
		return written, nil
	}
	if len(buffer.data) < buffer.maxBytes {
		fill := min(buffer.maxBytes-len(buffer.data), len(value))
		buffer.data = append(buffer.data, value[:fill]...)
		value = value[fill:]
	}
	if len(value) > 0 {
		buffer.truncated = true
		first := copy(buffer.data[buffer.head:], value)
		copy(buffer.data, value[first:])
		buffer.head = (buffer.head + len(value)) % buffer.maxBytes
	}
	return written, nil
}
func (buffer *cappedTailBuffer) Bytes() []byte {
	if buffer.head == 0 {
		return buffer.data
	}
	result := make([]byte, len(buffer.data))
	n := copy(result, buffer.data[buffer.head:])
	copy(result[n:], buffer.data[:buffer.head])
	return result
}

func truncateLogLine(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}

	const suffix = "... [truncated]"
	if maxBytes <= len(suffix) {
		return suffix[:maxBytes]
	}

	return strings.ToValidUTF8(value[:maxBytes-len(suffix)], "") + suffix
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
		return fmt.Sprintf("https://github.com/%s.git", repo.FullName)
	}

	return fmt.Sprintf("%s/%s.git", baseURL, repo.FullName)
}

// Git configuration in the child environment keeps credentials out of argv and .git/config.
func (runner *Runner) gitAuthEnv(repository repo) []string {
	if repository.Token == "" || (runner.cfg.GitCloneBase != "" && strings.TrimRight(runner.cfg.GitCloneBase, "/") != "https://github.com") {
		return nil
	}
	header := "AUTHORIZATION: basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+repository.Token))
	return []string{"GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader", "GIT_CONFIG_VALUE_0=" + header, "GIT_TERMINAL_PROMPT=0"}
}

func (runner *Runner) post(ctx context.Context, path string, payload any, response any) error {
	return runner.postWithStatus(ctx, path, payload, response, 0)
}

func (runner *Runner) postWithStatus(ctx context.Context, path string, payload any, response any, expectedStatus int) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := strings.TrimRight(runner.cfg.BaseURL, "/") + path
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

	if result.StatusCode < 200 || result.StatusCode >= 300 || (expectedStatus != 0 && result.StatusCode != expectedStatus) {
		body, _ := io.ReadAll(io.LimitReader(result.Body, 4096))
		return fmt.Errorf("control plane returned %s: %s", result.Status, strings.TrimSpace(string(body)))
	}

	const maxControlPlaneResponseBytes = 16 * 1024 * 1024
	if result.ContentLength > maxControlPlaneResponseBytes {
		return fmt.Errorf("control plane response exceeds %d bytes", maxControlPlaneResponseBytes)
	}
	data, err := io.ReadAll(io.LimitReader(result.Body, maxControlPlaneResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxControlPlaneResponseBytes {
		return fmt.Errorf("control plane response exceeds %d bytes", maxControlPlaneResponseBytes)
	}
	return json.Unmarshal(data, response)
}

func (runner *Runner) commandSucceeds(ctx context.Context, dir string, name string, args ...string) bool {
	command := agentCommand(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
	return command.Run() == nil
}

func (runner *Runner) commandEnv() []string {
	env := make([]string, 0, len(os.Environ())+1)
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if !strings.HasPrefix(key, "DEVPUSH_") {
			env = append(env, item)
		}
	}
	if runner.cfg.DockerHost != "" {
		env = append(env, "DOCKER_HOST="+runner.cfg.DockerHost)
	}

	return env
}
