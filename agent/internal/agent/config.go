package agent

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AgentID          string
	ServerURL        string
	Token            string
	StateDir         string
	DockerHost       string
	TraefikEmail     string
	TraefikHTTPPort  int
	TraefikHTTPSPort int
	GitCloneBase     string
}

func LoadConfig(path string) (Config, error) {
	values := map[string]string{}

	file, err := os.Open(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, err
	}

	if file != nil {
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			key, value, ok := strings.Cut(line, "=")
			if !ok {
				return Config{}, fmt.Errorf("invalid config line %q", line)
			}

			values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"`)
		}

		if err := scanner.Err(); err != nil {
			return Config{}, err
		}
	}

	httpPort, err := parsePort(firstNonEmpty(os.Getenv("DEVPUSH_TRAEFIK_HTTP_PORT"), values["DEVPUSH_TRAEFIK_HTTP_PORT"]), 80)
	if err != nil {
		return Config{}, err
	}
	httpsPort, err := parsePort(firstNonEmpty(os.Getenv("DEVPUSH_TRAEFIK_HTTPS_PORT"), values["DEVPUSH_TRAEFIK_HTTPS_PORT"]), 443)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		AgentID:          firstNonEmpty(os.Getenv("DEVPUSH_AGENT_ID"), values["DEVPUSH_AGENT_ID"]),
		ServerURL:        firstNonEmpty(os.Getenv("DEVPUSH_SERVER_URL"), values["DEVPUSH_SERVER_URL"]),
		Token:            firstNonEmpty(os.Getenv("DEVPUSH_AGENT_TOKEN"), values["DEVPUSH_AGENT_TOKEN"]),
		StateDir:         firstNonEmpty(os.Getenv("DEVPUSH_STATE_DIR"), values["DEVPUSH_STATE_DIR"], "/var/lib/devpush-agent"),
		DockerHost:       firstNonEmpty(os.Getenv("DOCKER_HOST"), values["DOCKER_HOST"]),
		TraefikEmail:     firstNonEmpty(os.Getenv("DEVPUSH_TRAEFIK_EMAIL"), values["DEVPUSH_TRAEFIK_EMAIL"]),
		TraefikHTTPPort:  httpPort,
		TraefikHTTPSPort: httpsPort,
		GitCloneBase:     firstNonEmpty(os.Getenv("DEVPUSH_GIT_CLONE_BASE_URL"), values["DEVPUSH_GIT_CLONE_BASE_URL"], "https://github.com"),
	}

	if cfg.ServerURL == "" {
		return Config{}, errors.New("DEVPUSH_SERVER_URL is required")
	}
	if cfg.Token == "" {
		return Config{}, errors.New("DEVPUSH_AGENT_TOKEN is required")
	}

	return cfg, nil
}

func parsePort(value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}

	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("invalid Traefik port %q", value)
	}

	return port, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}
