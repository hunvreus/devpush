package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxDeploymentLogBatchBytes = 1 << 20
	maxDeploymentLogBatchLines = 5_000
	maxDeploymentEventBatch    = 100
)

func nullableString(value string) *string {
	if value == "" {
		return nil
	}

	return &value
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
		if strings.TrimSpace(runner.cfg.BaseURL) == "" {
			return
		}
		if flushedLogs == len(logs) && flushedEvents == len(events) {
			return
		}

		for flushedLogs < len(logs) || flushedEvents < len(events) {
			logStart, pendingLogs := deploymentLogBatch(logs, flushedLogs)
			eventEnd := deploymentEventBatchEnd(events, flushedEvents)
			progress := jobProgress{
				ServerID: runner.cfg.AgentID, Token: runner.currentCredential(),
				DeploymentID: job.ID, LogStartSeq: baseLogSeq + logStart,
				Logs: pendingLogs, Events: append([]jobEvent{}, events[flushedEvents:eventEnd]...),
			}
			if err := runner.reportProgress(ctx, progress); err != nil {
				runner.log.Warn("report deployment progress failed", "deployment_id", job.ID, "error", err)
				return
			}
			flushedLogs += len(pendingLogs)
			flushedEvents = eventEnd
		}
	}
	makeCompletion := func() jobCompletion {
		return jobCompletion{
			ServerID:     runner.cfg.AgentID,
			Token:        runner.currentCredential(),
			Type:         "deploy",
			DeploymentID: job.ID,
			Status:       status,
			GitSha:       nullableString(gitSha),
			LogStartSeq:  baseLogSeq + flushedLogs,
			Logs:         append([]string{}, logs[flushedLogs:]...),
			Events:       append([]jobEvent{}, events[flushedEvents:]...),
		}
	}

	addEvent := func(phase string, message string) {
		message = truncateLogLine(message, maxDeploymentLogLineLen)
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
		var env []string
		if name == "git" && len(args) > 0 && (args[0] == "clone" || args[0] == "fetch") {
			env = runner.gitAuthEnv(job.Repo)
		}
		return runner.runCancellableCommandWithEnv(ctx, job.ID, dir, &logs, env, name, args...)
	}

	workdir := filepath.Join(runner.cfg.StateDir, "deployments", job.ID)
	repoDir := filepath.Join(workdir, "repo")
	if err := os.RemoveAll(workdir); err != nil {
		return fail(err)
	}
	if err := os.MkdirAll(workdir, 0o750); err != nil {
		return fail(err)
	}

	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		keep := workdir
		if status != "succeeded" {
			keep = ""
		}
		if err := runner.pruneDeploymentDirectories(cleanupCtx, keep); err != nil {
			runner.log.Warn("deployment directory cleanup failed", "error", err)
		}
	}()

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

	sha, err := runner.commandOutput(ctx, repoDir, "git", "rev-parse", "HEAD")
	if err != nil {
		return fail(fmt.Errorf("unable to read deployed Git SHA: %w", err))
	}
	gitSha = strings.TrimSpace(sha)

	switch job.Runtime.Type {
	case "compose":
		// Compose is the only runtime driver currently implemented.
	default:
		return fail(fmt.Errorf("unsupported deployment runtime type %q", job.Runtime.Type))
	}
	composePath, err := resolveRepositoryFile(repoDir, job.Runtime.Path)
	if err != nil {
		return fail(fmt.Errorf("Compose file %s was not found in the repository checkout. Update the project Compose path or add the file: %w", job.Runtime.Path, err))
	}
	addEvent("compose_resolved", fmt.Sprintf("Resolved %s.", job.Runtime.Path))
	for _, warning := range composeRiskWarnings(composePath) {
		logs = append(logs, "Warning: "+warning)
	}

	envFile := filepath.Join(workdir, "env")
	if err := writeEnvFile(envFile, job.EnvVars); err != nil {
		return fail(fmt.Errorf("unable to write deployment environment file: %w", err))
	}

	if err := runner.ensureDockerAvailable(ctx); err != nil {
		return fail(err)
	}
	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return fail(err)
	}
	baseComposeArgs := []string{
		"--env-file",
		envFile,
		"-p",
		job.Runtime.ProjectName,
		"-f",
		composePath,
	}
	configArgs := append(append([]string{}, baseComposeArgs...), "config", "--format", "json")
	resolvedConfig, err := runner.commandOutput(ctx, repoDir, composeName, append(composePrefix, configArgs...)...)
	if err != nil {
		return fail(fmt.Errorf("Docker Compose configuration is invalid for this commit and environment: %w", err))
	}
	model, err := parseComposeModel(resolvedConfig)
	if err != nil {
		return fail(fmt.Errorf("unable to inspect the resolved Docker Compose configuration: %w", err))
	}
	for _, warning := range model.riskWarnings() {
		logs = append(logs, truncateLogLine("Warning: "+warning, maxDeploymentLogLineLen))
	}
	publishedPortServices := model.servicesWithPublishedPorts()
	if len(publishedPortServices) > 0 {
		logs = append(logs, truncateLogLine(
			fmt.Sprintf("Warning: devpush managed ingress ignores published ports for services: %s.", strings.Join(publishedPortServices, ", ")),
			maxDeploymentLogLineLen,
		))
	}
	hostNetworkServices := model.servicesWithHostNetworking()
	if len(hostNetworkServices) > 0 {
		logs = append(logs, truncateLogLine(
			fmt.Sprintf("Warning: devpush managed ingress ignores host networking for services: %s.", strings.Join(hostNetworkServices, ", ")),
			maxDeploymentLogLineLen,
		))
	}
	for _, route := range job.Routes {
		if _, exists := model.Services[route.Service]; !exists {
			return fail(fmt.Errorf("route %s targets Compose service %q, which does not exist in this commit", normalizeRoutePath(route.Path), route.Service))
		}
	}
	action := job.Runtime.Action
	if action == "" {
		action = "deploy"
	}
	command, commandLabel := resolveLifecycleCommand(job.Runtime, action)
	usesCustomCommand := strings.TrimSpace(command) != ""
	preDeployService := job.Runtime.ReleaseService
	if action != "rollback" && job.Runtime.ReleaseCommand != "" {
		if preDeployService == "" && len(model.Services) == 1 {
			for service := range model.Services {
				preDeployService = service
			}
		}
		if preDeployService == "" {
			return fail(fmt.Errorf("pre-deploy command target is automatic, but this commit defines %d Compose services and has no routed service; choose a target service", len(model.Services)))
		}
		if _, exists := model.Services[preDeployService]; !exists {
			return fail(fmt.Errorf("pre-deploy command targets Compose service %q, which does not exist in this commit", preDeployService))
		}
	}

	overrideFile := filepath.Join(workdir, "devpush.compose.yml")
	needsOverride := usesCustomCommand || len(job.Routes) > 0 || len(publishedPortServices) > 0 || len(hostNetworkServices) > 0
	if len(job.Routes) > 0 {
		if err := runner.ensureTraefik(ctx, &logs); err != nil {
			return fail(fmt.Errorf("unable to prepare managed Traefik routing. Check Docker access and whether ports 80/443 are already in use: %w", err))
		}
	}
	if needsOverride {
		managedNames, err := runner.managedCertificateNames()
		if err != nil {
			return fail(err)
		}
		if err := writeManagedComposeOverride(overrideFile, job.Runtime.ProjectName, job.Routes, publishedPortServices, hostNetworkServices, managedNames...); err != nil {
			return fail(fmt.Errorf("unable to generate managed Compose override: %w", err))
		}
		addEvent("config_synced", "Generated devpush managed-ingress override.")
	}

	composeArgs := append([]string{}, baseComposeArgs...)
	if needsOverride {
		composeArgs = append(composeArgs, "-f", overrideFile)
	}
	finalConfigArgs := append(append([]string{}, composeArgs...), "config", "--quiet")
	if err := run(repoDir, composeName, append(composePrefix, finalConfigArgs...)...); err != nil {
		return fail(fmt.Errorf("devpush managed routing is incompatible with this Compose configuration: %w", err))
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

	if action != "rollback" && job.Runtime.ReleaseCommand != "" {
		addEvent("release_command_started", fmt.Sprintf("Running pre-deploy command on %s.", preDeployService))
		preDeployArgs := append(
			append([]string{}, composeArgs...),
			"run",
			"--rm",
			preDeployService,
			"sh",
			"-lc",
			job.Runtime.ReleaseCommand,
		)
		if err := run(repoDir, composeName, append(composePrefix, preDeployArgs...)...); err != nil {
			return fail(fmt.Errorf("pre-deploy command failed on service %s. Fix the command or make it safe to rerun before deploying again: %w", preDeployService, err))
		}
		addEvent("release_command_succeeded", "Pre-deploy command completed.")
	}

	if usesCustomCommand {
		customEnv := deploymentCommandEnv(job.EnvVars, map[string]string{
			"DEVPUSH_ACTION":               action,
			"DEVPUSH_COMPOSE_PATH":         composePath,
			"DEVPUSH_COMPOSE_OVERRIDE":     overrideFile,
			"DEVPUSH_COMPOSE_PROJECT_NAME": job.Runtime.ProjectName,
			"DEVPUSH_ENV_FILE":             envFile,
		})
		timeout := time.Duration(job.Runtime.TimeoutSeconds) * time.Second
		if timeout < time.Minute || timeout > 2*time.Hour {
			timeout = 30 * time.Minute
		}
		commandCtx, cancel := context.WithTimeout(ctx, timeout)
		addEvent("lifecycle_command_started", fmt.Sprintf("Running custom %s command.", commandLabel))
		err := runner.runCancellableCommandWithEnv(commandCtx, job.ID, repoDir, &logs, customEnv, "sh", "-lc", command)
		cancel()
		if err != nil {
			if errors.Is(commandCtx.Err(), context.DeadlineExceeded) {
				return fail(fmt.Errorf("custom %s command timed out after %s", commandLabel, timeout))
			}
			return fail(fmt.Errorf("custom %s command failed: %w", commandLabel, err))
		}
		addEvent("lifecycle_command_succeeded", fmt.Sprintf("Custom %s command completed.", commandLabel))
	} else {
		addEvent("revision_started", "Starting Compose services.")
		upArgs := append(append([]string{}, composeArgs...), "up", "-d", "--no-build")
		if err := run(repoDir, composeName, append(composePrefix, upArgs...)...); err != nil {
			return fail(fmt.Errorf("Docker Compose could not start services. Check service definitions, fixed port conflicts, volumes, and container health: %w", err))
		}
	}

	if err := runner.waitForComposeHealthy(ctx, repoDir, &logs, composeName, composePrefix, composeArgs); err != nil {
		return fail(fmt.Errorf("Docker Compose services did not become healthy: %w", err))
	}

	if err := runner.checkDeploymentRoutes(ctx, job.Routes, job.Runtime.ReadinessPath, addEvent); err != nil {
		return fail(err)
	}

	addEvent("traffic_switched", "Deployment finished on the target server.")
	addEvent("completed", "Deployment completed.")

	return makeCompletion()
}

func deploymentLogBatch(logs []string, start int) (int, []string) {
	if start >= len(logs) {
		return start, []string{}
	}

	end := start
	batchBytes := 1
	for end < len(logs) && end-start < maxDeploymentLogBatchLines {
		encoded, _ := json.Marshal(logs[end])
		lineBytes := len(encoded) + 1
		if end > start && batchBytes+lineBytes > maxDeploymentLogBatchBytes {
			break
		}
		batchBytes += lineBytes
		end++
	}
	return start, append([]string{}, logs[start:end]...)

}

func deploymentEventBatchEnd(events []jobEvent, start int) int {
	end, bytes := start, 1
	for end < len(events) && end-start < maxDeploymentEventBatch {
		encoded, _ := json.Marshal(events[end])
		if end > start && bytes+len(encoded)+1 > maxDeploymentLogBatchBytes {
			break
		}
		bytes += len(encoded) + 1
		end++
	}
	return end
}

func resolveLifecycleCommand(runtime runtimeConfig, action string) (string, string) {
	if action == "rollback" && strings.TrimSpace(runtime.RollbackCommand) != "" {
		return runtime.RollbackCommand, "rollback"
	}
	return runtime.DeployCommand, "deploy"
}
