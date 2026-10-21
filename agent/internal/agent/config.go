package agent

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	RoutingAddress       string
	AgentID              string
	BaseURL              string
	Token                string
	StateDir             string
	DockerHost           string
	TraefikEmail         string
	TraefikHTTPPort      int
	TraefikHTTPSPort     int
	GitCloneBase         string
	RuntimeLogQueueBytes int64
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
	queueBytes := int64(128 << 20)
	if value := firstNonEmpty(os.Getenv("DEVPUSH_RUNTIME_LOG_QUEUE_BYTES"), values["DEVPUSH_RUNTIME_LOG_QUEUE_BYTES"]); value != "" {
		queueBytes, err = strconv.ParseInt(value, 10, 64)
		if err != nil || queueBytes < 1 {
			return Config{}, errors.New("DEVPUSH_RUNTIME_LOG_QUEUE_BYTES must be a positive integer")
		}
	}

	cfg := Config{
		RoutingAddress:       firstNonEmpty(os.Getenv("DEVPUSH_ROUTING_ADDRESS"), values["DEVPUSH_ROUTING_ADDRESS"]),
		AgentID:              firstNonEmpty(os.Getenv("DEVPUSH_AGENT_ID"), values["DEVPUSH_AGENT_ID"]),
		BaseURL:              firstNonEmpty(os.Getenv("DEVPUSH_BASE_URL"), values["DEVPUSH_BASE_URL"]),
		Token:                firstNonEmpty(os.Getenv("DEVPUSH_AGENT_TOKEN"), values["DEVPUSH_AGENT_TOKEN"]),
		StateDir:             firstNonEmpty(os.Getenv("DEVPUSH_STATE_DIR"), values["DEVPUSH_STATE_DIR"], "/var/lib/devpush-agent"),
		DockerHost:           firstNonEmpty(os.Getenv("DOCKER_HOST"), values["DOCKER_HOST"]),
		TraefikEmail:         firstNonEmpty(os.Getenv("DEVPUSH_TRAEFIK_EMAIL"), values["DEVPUSH_TRAEFIK_EMAIL"]),
		TraefikHTTPPort:      httpPort,
		TraefikHTTPSPort:     httpsPort,
		GitCloneBase:         firstNonEmpty(os.Getenv("DEVPUSH_GIT_CLONE_BASE_URL"), values["DEVPUSH_GIT_CLONE_BASE_URL"], "https://github.com"),
		RuntimeLogQueueBytes: queueBytes,
	}

	if cfg.RoutingAddress != "" {
		ip := net.ParseIP(cfg.RoutingAddress)
		if ip == nil || !ip.IsGlobalUnicast() {
			return Config{}, errors.New("DEVPUSH_ROUTING_ADDRESS must be a unicast IPv4 or IPv6 address")
		}
		cfg.RoutingAddress = ip.String()
	}

	if cfg.BaseURL == "" {
		return Config{}, errors.New("DEVPUSH_BASE_URL is required")
	}
	if cfg.Token == "" {
		return Config{}, errors.New("DEVPUSH_AGENT_TOKEN is required")
	}
	if err := validateControlPlaneURL(cfg.BaseURL); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func validateControlPlaneURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		(parsed.Path != "" && parsed.Path != "/") ||
		strings.ContainsAny(value, "?#") {
		return errors.New("DEVPUSH_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	local := host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "host.lima.internal"
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		local = true
	}
	if parsed.Scheme == "http" && !local {
		return errors.New("DEVPUSH_BASE_URL must use HTTPS except for local development hosts")
	}
	return nil
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
