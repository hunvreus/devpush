package agent

import (
	"context"
	"fmt"
	"strings"
)

const (
	dockerSocketProxyImage = "ghcr.io/tecnativa/docker-socket-proxy:v0.5.0"
	traefikImage           = "traefik:v3.7.12"
)

func (runner *Runner) ensureTraefik(ctx context.Context, logs *[]string) error {
	if err := runner.runCommand(ctx, "", logs, "docker", "network", "inspect", "devpush-proxy"); err != nil {
		if err := runner.runCommand(ctx, "", logs, "docker", "network", "create", "devpush-proxy"); err != nil {
			return fmt.Errorf("create Docker network devpush-proxy: %w", err)
		}
	}
	if err := runner.runCommand(ctx, "", logs, "docker", "network", "inspect", "devpush-docker-api"); err != nil {
		if err := runner.runCommand(ctx, "", logs, "docker", "network", "create", "--internal", "devpush-docker-api"); err != nil {
			return fmt.Errorf("create isolated Docker API network: %w", err)
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
		"devpush-docker-api",
		"-p",
		fmt.Sprintf("%d:80", runner.traefikHTTPPort()),
		"-p",
		fmt.Sprintf("%d:443", runner.traefikHTTPSPort()),
		"-v",
		"devpush-traefik-acme:/letsencrypt",
		"--security-opt",
		"no-new-privileges:true",
		traefikImage,
		"--providers.docker=true",
		"--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375",
		"--providers.docker.exposedbydefault=false",
		"--providers.docker.network=devpush-proxy",
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
	if err := runner.runCommand(ctx, "", logs, "docker", "network", "connect", "devpush-proxy", "devpush-traefik"); err != nil {
		return fmt.Errorf("connect devpush-traefik to ingress network: %w", err)
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
	if !strings.Contains(command, "--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375") ||
		!strings.Contains(command, "--providers.docker.network=devpush-proxy") {
		return false, nil
	}

	mounts, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .Mounts}}", "devpush-traefik")
	if err != nil {
		return false, fmt.Errorf("inspect devpush-traefik container mounts: %w", err)
	}
	if strings.Contains(mounts, "/var/run/docker.sock") {
		return false, nil
	}

	networks, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", "devpush-traefik")
	if err != nil {
		return false, fmt.Errorf("inspect devpush-traefik networks: %w", err)
	}
	if !strings.Contains(networks, "devpush-docker-api") || !strings.Contains(networks, "devpush-proxy") {
		return false, nil
	}

	return true, nil
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
		"devpush-docker-api",
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
		"--security-opt",
		"no-new-privileges:true",
		dockerSocketProxyImage,
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

	networks, err := runner.commandOutput(ctx, "", "docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", "devpush-docker-socket-proxy")
	if err != nil {
		return false, fmt.Errorf("inspect devpush Docker socket proxy networks: %w", err)
	}

	return strings.Contains(env, "EVENTS=1") &&
		strings.Contains(networks, "devpush-docker-api") &&
		!strings.Contains(networks, "devpush-proxy"), nil
}
