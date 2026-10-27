package agent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Inventory omission means discovery is unavailable. Never truncate a complete
// inventory: the control plane could treat the omitted applications as absent.
func heartbeatRuntimeIDs(ids []string) ([]string, error) {
	managed := []string{}
	for _, id := range ids {
		if strings.HasPrefix(id, "dp_") {
			managed = append(managed, id)
		}
	}
	if len(managed) > 200 {
		return nil, fmt.Errorf("managed runtime inventory exceeds heartbeat limit of 200")
	}
	return managed, nil
}

func heartbeatRuntimeStates(runtimes []composeRuntime) ([]composeRuntime, error) {
	managed := []composeRuntime{}
	for _, runtime := range runtimes {
		if !strings.HasPrefix(runtime.RuntimeID, "dp_") {
			continue
		}
		if len(runtime.Services) > 500 {
			return nil, fmt.Errorf("managed runtime service inventory exceeds heartbeat limit of 500")
		}
		managed = append(managed, runtime)
	}
	if len(managed) > 200 {
		return nil, fmt.Errorf("managed runtime state inventory exceeds heartbeat limit of 200")
	}
	return managed, nil
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
		return runner.pruneDeploymentDirectories(ctx, "")
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

	return runner.pruneDeploymentDirectories(ctx, "")
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
	if err != nil {
		return nil, err
	}
	if len(containerIDs) == 0 {
		return []composeRuntime{}, nil
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
	command := agentCommand(ctx, name, args...)
	command.Dir = dir
	command.Env = runner.commandEnv()
	stdout := cappedTailBuffer{maxBytes: maxCommandOutputBytes}
	stderr := cappedTailBuffer{maxBytes: maxCommandOutputBytes}
	command.Stdout = &stdout
	command.Stderr = jobDiagnostics(ctx, &stderr)
	err := command.Run()
	if stdout.truncated {
		if err != nil {
			return "", fmt.Errorf("%s output exceeded the diagnostic limit: %w", name, err)
		}
		return "", fmt.Errorf("%s output exceeded the diagnostic limit", name)
	}
	if err != nil {
		details := strings.TrimSpace(string(stderr.Bytes()))
		if details != "" {
			return "", fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, details)
		}
		return "", fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}

	return string(stdout.Bytes()), nil
}
