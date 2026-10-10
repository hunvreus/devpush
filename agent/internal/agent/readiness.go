package agent

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (runner *Runner) checkDeploymentRoutes(ctx context.Context, routes []route, path string, addEvent func(string, string)) error {
	seen := map[string]bool{}
	for _, route := range routes {
		readinessPath := routeReadinessPath(route.Path, path)
		key := fmt.Sprintf("%t:%s:%s", route.HTTPS, route.Host, readinessPath)
		if seen[key] {
			continue
		}
		seen[key] = true
		addEvent("readiness_check_started", fmt.Sprintf("Checking %s%s through Traefik.", route.Host, readinessPath))
		if err := runner.checkReadiness(ctx, route, readinessPath); err != nil {
			return fmt.Errorf("readiness check failed for %s%s through Traefik. Check that the service listens on port %d, returns a 2xx/3xx response, and has a valid HTTPS certificate: %w", route.Host, readinessPath, route.Port, err)
		}
		addEvent("readiness_check_succeeded", fmt.Sprintf("Verified %s%s.", route.Host, readinessPath))
	}
	return nil
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
