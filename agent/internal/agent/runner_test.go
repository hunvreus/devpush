package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAgentCredentialIsPersistedAndReloaded(t *testing.T) {
	stateDir := t.TempDir()
	runner := NewRunner(Config{StateDir: stateDir, Token: "enrollment"}, nil)

	if err := runner.acceptCredential("dpa_replacement"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(stateDir, "credential"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential mode = %o, want 600", info.Mode().Perm())
	}

	restarted := NewRunner(Config{StateDir: stateDir, Token: "enrollment"}, nil)
	if err := restarted.loadCredential(); err != nil {
		t.Fatal(err)
	}
	if got := restarted.currentCredential(); got != "dpa_replacement" {
		t.Fatalf("credential = %q, want replacement", got)
	}
}

func TestRotateCredentialUsesCurrentCredentialAndPersistsReplacement(t *testing.T) {
	stateDir := t.TempDir()
	requests := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/register", func(response http.ResponseWriter, request *http.Request) {
		requests++
		var payload agentRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Token != "dpa_current" {
			t.Fatalf("registration token = %q, want current credential", payload.Token)
		}
		writeJSON(t, response, agentResponse{ServerID: "server-1", Status: "connected"})
	})
	mux.HandleFunc("/api/agents/credentials/rotate", func(response http.ResponseWriter, request *http.Request) {
		requests++
		var payload agentRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.ServerID != "server-1" || payload.Token != "dpa_current" {
			t.Fatalf("rotation payload = %#v", payload)
		}
		writeJSON(t, response, agentResponse{
			ServerID:   "server-1",
			Status:     "connected",
			Credential: "dpa_replacement",
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	runner := NewRunner(Config{
		ServerURL: server.URL,
		Token:     "dpa_current",
		StateDir:  stateDir,
	}, nil)
	if err := runner.RotateCredential(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
	if got := strings.TrimSpace(readFile(t, filepath.Join(stateDir, "credential"))); got != "dpa_replacement" {
		t.Fatalf("stored credential = %q, want replacement", got)
	}
}

func TestWriteRouteOverrideCreatesHTTPRoute(t *testing.T) {
	path := t.TempDir() + "/devpush.compose.yml"

	err := writeRouteOverride(path, "devpush_example_production", []route{
		{
			Host:    "example.com",
			Service: "web",
			Port:    3000,
			Path:    "/",
			HTTPS:   false,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	content := readFile(t, path)
	assertContains(t, content, "traefik.enable=true")
	assertContains(t, content, "traefik.docker.network=devpush-proxy")
	assertContains(t, content, "traefik.http.routers.devpush-example-production-web-1.rule=Host(`example.com`)")
	assertContains(t, content, "traefik.http.routers.devpush-example-production-web-1.entrypoints=web")
	assertContains(t, content, "traefik.http.services.devpush-example-production-web-1.loadbalancer.server.port=3000")
	assertContains(t, content, "devpush-proxy:")
	assertContains(t, content, "external: true")
}

func TestRegisterWithRetryKeepsProcessAliveUntilControlPlaneReturns(t *testing.T) {
	oldInitial := registerRetryInitial
	oldMax := registerRetryMax
	registerRetryInitial = time.Millisecond
	registerRetryMax = time.Millisecond
	t.Cleanup(func() {
		registerRetryInitial = oldInitial
		registerRetryMax = oldMax
	})

	attempts := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/register", func(response http.ResponseWriter, request *http.Request) {
		attempts++
		if attempts == 1 {
			http.Error(response, "not ready", http.StatusServiceUnavailable)
			return
		}

		writeJSON(t, response, agentResponse{ServerID: "server-1", Status: "connected"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	runner := NewRunner(Config{
		ServerURL: server.URL,
		Token:     "agent-token",
		StateDir:  t.TempDir(),
	}, nil)

	serverID, err := runner.registerWithRetry(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if serverID != "server-1" {
		t.Fatalf("expected server-1, got %q", serverID)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 registration attempts, got %d", attempts)
	}
}

func TestWriteRouteOverrideCreatesHTTPSAndRedirectRoutes(t *testing.T) {
	path := t.TempDir() + "/devpush.compose.yml"

	err := writeRouteOverride(path, "my.app", []route{
		{
			Host:    "admin.example.com",
			Service: "admin",
			Port:    8080,
			Path:    "/admin",
			HTTPS:   true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	content := readFile(t, path)
	assertContains(t, content, "traefik.http.middlewares.my-app-admin-1-https.redirectscheme.scheme=https")
	assertContains(t, content, "traefik.http.routers.my-app-admin-1-web.entrypoints=web")
	assertContains(t, content, "traefik.http.routers.my-app-admin-1-web.middlewares=my-app-admin-1-https")
	assertContains(t, content, "traefik.http.routers.my-app-admin-1-secure.entrypoints=websecure")
	assertContains(t, content, "traefik.http.routers.my-app-admin-1-secure.tls=true")
	assertContains(t, content, "traefik.http.routers.my-app-admin-1-secure.tls.certresolver=devpush")
	assertContains(t, content, "Host(`admin.example.com`) && PathPrefix(`/admin`)")
}

func TestWriteRouteOverrideCreatesStripPrefixMiddleware(t *testing.T) {
	path := t.TempDir() + "/devpush.compose.yml"

	err := writeRouteOverride(path, "my.app", []route{
		{
			Host:        "example.com",
			Service:     "api",
			Port:        8080,
			Path:        "/api",
			HTTPS:       false,
			StripPrefix: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	content := readFile(t, path)
	assertContains(t, content, "traefik.http.middlewares.my-app-api-1-strip.stripprefix.prefixes=/api")
	assertContains(t, content, "traefik.http.routers.my-app-api-1.middlewares=my-app-api-1-strip")
}

func TestWriteRouteOverrideNormalizesTrailingRouteSlash(t *testing.T) {
	path := t.TempDir() + "/devpush.compose.yml"

	err := writeRouteOverride(path, "my.app", []route{
		{
			Host:    "admin.example.com",
			Service: "admin",
			Port:    8080,
			Path:    "/admin/",
			HTTPS:   true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	content := readFile(t, path)
	assertContains(t, content, "Host(`admin.example.com`) && PathPrefix(`/admin`)")
	assertNotContains(t, content, "PathPrefix(`/admin/`)")
}

func TestWriteRouteOverrideRejectsBackticks(t *testing.T) {
	path := t.TempDir() + "/devpush.compose.yml"

	err := writeRouteOverride(path, "app", []route{
		{
			Host:    "bad`host",
			Service: "web",
			Port:    3000,
			Path:    "/",
			HTTPS:   true,
		},
	})
	if err == nil {
		t.Fatal("expected route with backtick to fail")
	}
}

func TestWriteRouteOverrideRejectsInvalidRoutes(t *testing.T) {
	tests := []struct {
		name  string
		route route
	}{
		{
			name: "blank host",
			route: route{
				Host:    "",
				Service: "web",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "host with slash",
			route: route{
				Host:    "example.com/app",
				Service: "web",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "host with port",
			route: route{
				Host:    "example.com:3000",
				Service: "web",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "wildcard host",
			route: route{
				Host:    "*.example.com",
				Service: "web",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "blank service",
			route: route{
				Host:    "example.com",
				Service: "",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "service with space",
			route: route{
				Host:    "example.com",
				Service: "web app",
				Port:    3000,
				Path:    "/",
			},
		},
		{
			name: "zero port",
			route: route{
				Host:    "example.com",
				Service: "web",
				Port:    0,
				Path:    "/",
			},
		},
		{
			name: "path without slash",
			route: route{
				Host:    "example.com",
				Service: "web",
				Port:    3000,
				Path:    "health",
			},
		},
		{
			name: "path with space",
			route: route{
				Host:    "example.com",
				Service: "web",
				Port:    3000,
				Path:    "/health check",
			},
		},
		{
			name: "path with query",
			route: route{
				Host:    "example.com",
				Service: "web",
				Port:    3000,
				Path:    "/health?ready=1",
			},
		},
		{
			name: "path with fragment",
			route: route{
				Host:    "example.com",
				Service: "web",
				Port:    3000,
				Path:    "/health#ready",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := t.TempDir() + "/devpush.compose.yml"

			err := writeRouteOverride(path, "app", []route{test.route})

			if err == nil {
				t.Fatal("expected invalid route to fail")
			}
		})
	}
}

func TestWriteEnvFileQuotesValues(t *testing.T) {
	path := t.TempDir() + "/env"

	err := writeEnvFile(path, []envVar{
		{Key: "PLAIN", Value: "value"},
		{Key: "SPACED", Value: "hello world"},
		{Key: "QUOTE", Value: "can't"},
	})
	if err != nil {
		t.Fatal(err)
	}

	content := readFile(t, path)
	assertContains(t, content, "PLAIN='value'")
	assertContains(t, content, "SPACED='hello world'")
	assertContains(t, content, "QUOTE='can'\\''t'")
}

func TestRouteReadinessPathUsesRoutePrefix(t *testing.T) {
	tests := []struct {
		name          string
		routePath     string
		readinessPath string
		expected      string
	}{
		{
			name:          "root route",
			routePath:     "/",
			readinessPath: "/health",
			expected:      "/health",
		},
		{
			name:          "prefixed route",
			routePath:     "/admin",
			readinessPath: "/health",
			expected:      "/admin/health",
		},
		{
			name:          "already prefixed",
			routePath:     "/admin",
			readinessPath: "/admin/health",
			expected:      "/admin/health",
		},
		{
			name:          "missing slash",
			routePath:     "admin/",
			readinessPath: "health",
			expected:      "/admin/health",
		},
		{
			name:          "empty readiness defaults to route root",
			routePath:     "/admin",
			readinessPath: "",
			expected:      "/admin/",
		},
		{
			name:          "trailing route slash",
			routePath:     "/admin/",
			readinessPath: "/health",
			expected:      "/admin/health",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual := routeReadinessPath(test.routePath, test.readinessPath)
			if actual != test.expected {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}

func TestReadinessStatusAllowsSuccessAndRedirects(t *testing.T) {
	allowed := []int{http.StatusOK, http.StatusNoContent, http.StatusMovedPermanently, http.StatusFound}
	for _, status := range allowed {
		if !isReadinessStatus(status) {
			t.Fatalf("expected %d to be a readiness success", status)
		}
	}

	rejected := []int{http.StatusContinue, http.StatusBadRequest, http.StatusInternalServerError}
	for _, status := range rejected {
		if isReadinessStatus(status) {
			t.Fatalf("expected %d to fail readiness", status)
		}
	}
}

func TestReadinessTargetUsesTraefikEntrypoint(t *testing.T) {
	runner := NewRunner(Config{}, nil)
	httpTarget := runner.readinessTarget(route{Host: "app.example.com", HTTPS: false}, "/health")
	if httpTarget.URL != "http://127.0.0.1:80/health" {
		t.Fatalf("expected HTTP readiness URL, got %q", httpTarget.URL)
	}

	httpsTarget := runner.readinessTarget(route{Host: "app.example.com", HTTPS: true}, "/health")
	if httpsTarget.URL != "https://127.0.0.1:443/health" {
		t.Fatalf("expected HTTPS readiness URL, got %q", httpsTarget.URL)
	}

	customRunner := NewRunner(Config{TraefikHTTPPort: 18080, TraefikHTTPSPort: 18443}, nil)
	customTarget := customRunner.readinessTarget(route{Host: "app.example.com", HTTPS: false}, "/health")
	if customTarget.URL != "http://127.0.0.1:18080/health" {
		t.Fatalf("expected custom HTTP readiness URL, got %q", customTarget.URL)
	}
}

func TestReadinessHTTPClientDoesNotFollowRedirects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, "/ready", http.StatusFound)
	}))
	defer server.Close()

	client := readinessHTTPClient(route{Host: "app.example.com", HTTPS: false})
	response, err := client.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusFound {
		t.Fatalf("expected redirect response to be returned, got %s", response.Status)
	}
}

func TestCommandEnvIncludesDockerHost(t *testing.T) {
	runner := NewRunner(Config{DockerHost: "unix:///run/user/1000/docker.sock"}, nil)

	env := strings.Join(runner.commandEnv(), "\n")

	assertContains(t, env, "DOCKER_HOST=unix:///run/user/1000/docker.sock")
}

func TestComposeCommandFallsBackToDockerCompose(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 1
fi
exit 0
`)
	writeExecutable(t, filepath.Join(binDir, "docker-compose"), `#!/bin/sh
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{}, nil)
	name, prefix, err := runner.composeCommand(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if name != "docker-compose" {
		t.Fatalf("expected docker-compose fallback, got %s %v", name, prefix)
	}
	if len(prefix) != 0 {
		t.Fatalf("expected no docker-compose prefix, got %v", prefix)
	}
}

func TestEnsureDockerAvailableExplainsMissingDocker(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-docker-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	runner := NewRunner(Config{}, nil)
	err := runner.ensureDockerAvailable(t.Context())

	if err == nil {
		t.Fatal("expected missing Docker to fail")
	}
	assertContains(t, err.Error(), "Docker is not available")
}

func TestEnsureTraefikReplacesLegacyRawSocketContainer(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-traefik-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	dockerLog := filepath.Join(tempDir, "docker.log")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "network" ] || [ "$1" = "volume" ]; then
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "devpush-docker-socket-proxy" ]; then
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "-f" ] && [ "$3" = "{{json .Config.Env}}" ] && [ "$4" = "devpush-docker-socket-proxy" ]; then
  echo '["CONTAINERS=1","EVENTS=1"]'
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "-f" ] && [ "$3" = "{{.State.Running}}" ] && [ "$4" = "devpush-docker-socket-proxy" ]; then
  echo true
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "devpush-traefik" ]; then
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "-f" ] && [ "$3" = "{{json .Config.Cmd}}" ] && [ "$4" = "devpush-traefik" ]; then
  echo '["--providers.docker=true"]'
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "-f" ] && [ "$3" = "{{json .Mounts}}" ] && [ "$4" = "devpush-traefik" ]; then
  echo '[{"Source":"/var/run/docker.sock"}]'
  exit 0
fi
if [ "$1" = "rm" ] && [ "$2" = "-f" ] && [ "$3" = "devpush-traefik" ]; then
  exit 0
fi
if [ "$1" = "run" ] && [ "$4" = "devpush-traefik" ]; then
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir)
	t.Setenv("FAKE_DOCKER_LOG", dockerLog)

	runner := NewRunner(Config{}, nil)
	logs := []string{}
	if err := runner.ensureTraefik(t.Context(), &logs); err != nil {
		t.Fatal(err)
	}

	content := readFile(t, dockerLog)
	assertContains(t, content, "rm -f devpush-traefik")
	assertContains(t, content, "--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375")
	assertContains(t, strings.Join(logs, "\n"), "Replacing devpush-traefik")
}

func TestRunCommandErrorIncludesLastRedactedOutputLine(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-command-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "failing-command"), `#!/bin/sh
echo "cloning https://x-access-token:secret-token@github.com/acme/app.git"
echo "fatal: repository not found"
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{}, nil)
	logs := []string{}
	err := runner.runCommand(t.Context(), "", &logs, "failing-command")

	if err == nil {
		t.Fatal("expected command to fail")
	}
	assertContains(t, err.Error(), "fatal: repository not found")
	if strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("expected error to redact token, got %q", err.Error())
	}
	if strings.Contains(strings.Join(logs, "\n"), "secret-token") {
		t.Fatalf("expected logs to redact token, got %q", logs)
	}
}

func TestRemoveComposeRuntimeKeepsVolumesWhenDeprovisioning(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-cleanup-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	dockerLog := filepath.Join(tempDir, "docker.log")
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
echo "$@" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "ps" ]; then
  echo container-one
  echo container-two
  exit 0
fi
if [ "$1" = "network" ] && [ "$2" = "ls" ]; then
  echo network-one
  exit 0
fi
if [ "$1" = "volume" ] && [ "$2" = "ls" ]; then
  echo volume-one
  exit 0
fi
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_DOCKER_LOG", dockerLog)

	runner := NewRunner(Config{}, nil)
	if err := runner.removeComposeRuntime(t.Context(), "dp_project_production", false); err != nil {
		t.Fatal(err)
	}

	content := readFile(t, dockerLog)
	assertContains(t, content, "ps -aq --filter label=com.docker.compose.project=dp_project_production")
	assertContains(t, content, "rm -f container-one container-two")
	assertContains(t, content, "network rm network-one")
	assertNotContains(t, content, "volume rm")
}

func TestListComposeRuntimeIDsDedupesDockerLabels(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-runtime-list-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
if [ "$1" = "ps" ]; then
  echo dp_project_production
  echo dp_project_production
  echo dp_project_preview
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{}, nil)
	runtimeIDs, err := runner.listComposeRuntimeIDs(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if strings.Join(runtimeIDs, ",") != "dp_project_production,dp_project_preview" {
		t.Fatalf("unexpected runtime IDs: %#v", runtimeIDs)
	}
}

func TestListComposeRuntimeStatesReportsServiceHealth(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-runtime-state-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
if [ "$1" = "ps" ]; then
  echo container-one
  exit 0
fi
if [ "$1" = "inspect" ]; then
  printf 'dp_project_production\tweb\tdp-web-1\trunning\thealthy\t2\t2026-06-01T00:00:00Z\t0\n'
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{}, nil)
	runtimes, err := runner.listComposeRuntimeStates(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(runtimes) != 1 || len(runtimes[0].Services) != 1 {
		t.Fatalf("unexpected runtime state: %#v", runtimes)
	}
	service := runtimes[0].Services[0]
	if runtimes[0].RuntimeID != "dp_project_production" || service.Name != "web" || service.Health == nil || *service.Health != "healthy" || service.RestartCount != 2 {
		t.Fatalf("unexpected service state: %#v", service)
	}
}

func TestIsMonitoredNetworkInterfaceExcludesContainerBridges(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"lo", "docker0", "br-abcd", "veth123", "virbr0"} {
		if isMonitoredNetworkInterface(name) {
			t.Fatalf("expected %q to be excluded", name)
		}
	}
	for _, name := range []string{"eth0", "ens5", "enp0s1", "wlan0"} {
		if !isMonitoredNetworkInterface(name) {
			t.Fatalf("expected %q to be monitored", name)
		}
	}
}

func TestIsMonitoredBlockDeviceExcludesVirtualDevices(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"", "loop0", "ram0", "sr0", "dm-0", "md0"} {
		if isMonitoredBlockDevice(name) {
			t.Fatalf("expected %q to be excluded", name)
		}
	}
}

func TestRunAgentLoopsKeepsHeartbeatsRunningDuringAJob(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var heartbeats atomic.Int32
	jobStarted := make(chan struct{})
	releaseJob := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		runAgentLoops(
			ctx,
			10*time.Millisecond,
			time.Hour,
			func(context.Context) { heartbeats.Add(1) },
			func(context.Context) {
				close(jobStarted)
				<-releaseJob
			},
		)
	}()

	<-jobStarted
	time.Sleep(55 * time.Millisecond)
	close(releaseJob)
	cancel()
	<-done

	if count := heartbeats.Load(); count < 4 {
		t.Fatalf("expected heartbeats during blocked job, got %d", count)
	}
}

func TestHeartbeatOmitsRuntimeIDsWhenDiscoveryFails(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-runtime-heartbeat-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	var heartbeatPayload agentRequest
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/agents/heartbeat" {
			t.Fatalf("unexpected request path %s", request.URL.Path)
		}
		decodeJSON(t, request, &heartbeatPayload)
		writeJSON(t, response, agentResponse{ServerID: "server-1", Status: "connected"})
	}))
	defer server.Close()

	runner := NewRunner(Config{
		ServerURL: server.URL,
		AgentID:   "server-1",
		Token:     "agent-token",
	}, nil)

	runner.sendHeartbeat(t.Context())

	if heartbeatPayload.RuntimeIDs != nil {
		t.Fatalf("expected runtime IDs to be omitted, got %#v", heartbeatPayload.RuntimeIDs)
	}
}

func TestHeartbeatReportsRuntimeLogsForTargets(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-runtime-logs-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
if [ "$1" = "ps" ]; then
  echo "dp_project_production"
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "-p" ] && [ "$3" = "dp_project_production" ] && [ "$4" = "logs" ]; then
  echo "web  | 2026-06-01T00:00:00.000000000Z Listening on 3000"
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	var heartbeatPayload agentRequest
	var logsPayload runtimeLogsRequest
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/heartbeat", func(response http.ResponseWriter, request *http.Request) {
		decodeJSON(t, request, &heartbeatPayload)
		writeJSON(t, response, agentResponse{
			ServerID: "server-1",
			Status:   "connected",
			RuntimeLogTargets: []runtimeLogTarget{
				{RuntimeID: "dp_project_production"},
			},
		})
	})
	mux.HandleFunc("/api/agents/runtime-logs", func(response http.ResponseWriter, request *http.Request) {
		decodeJSON(t, request, &logsPayload)
		writeJSON(t, response, runtimeLogsResponse{OK: true, Inserted: 1})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	runner := NewRunner(Config{
		ServerURL: server.URL,
		AgentID:   "server-1",
		Token:     "agent-token",
	}, nil)

	runner.sendHeartbeat(t.Context())

	if strings.Join(heartbeatPayload.RuntimeIDs, ",") != "dp_project_production" {
		t.Fatalf("unexpected heartbeat runtime IDs: %#v", heartbeatPayload.RuntimeIDs)
	}
	if logsPayload.ServerID != "server-1" || logsPayload.Token != "agent-token" {
		t.Fatalf("unexpected runtime log payload auth: %#v", logsPayload)
	}
	if len(logsPayload.Logs) != 1 {
		t.Fatalf("expected one runtime log, got %#v", logsPayload.Logs)
	}
	if logsPayload.Logs[0] != (runtimeLogLine{
		RuntimeID:  "dp_project_production",
		Service:    "web",
		ObservedAt: "2026-06-01T00:00:00Z",
		Content:    "Listening on 3000",
	}) {
		t.Fatalf("unexpected runtime log: %#v", logsPayload.Logs[0])
	}
}

func TestParseComposeLogLine(t *testing.T) {
	line, ok := parseComposeLogLine(
		"dp_project_production",
		"api  | 2026-06-01T00:00:00.123456789Z ready",
	)
	if !ok {
		t.Fatal("expected log line to parse")
	}

	if line.RuntimeID != "dp_project_production" ||
		line.Service != "api" ||
		line.ObservedAt != "2026-06-01T00:00:00.123456789Z" ||
		line.Content != "ready" {
		t.Fatalf("unexpected parsed line: %#v", line)
	}
}

func TestRunDeprovisionJobPreservesCleanupJobType(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-purge-job-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{
		AgentID: "server-1",
		Token:   "agent-token",
	}, nil)
	completion := runner.runDeprovisionJob(t.Context(), agentJob{
		Type: "purge",
		ID:   "job-1",
		Cleanup: cleanupConfig{
			RuntimeIDs:    []string{"dp_project_production"},
			RemoveVolumes: true,
			Reason:        "Retention window elapsed.",
		},
	})

	if completion.Type != "purge" {
		t.Fatalf("expected purge completion, got %#v", completion)
	}
	if completion.JobID != "job-1" || completion.Status != "succeeded" {
		t.Fatalf("unexpected completion: %#v", completion)
	}
}

func TestComposeCommandExplainsMissingCompose(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 1
fi
exit 0
`)
	t.Setenv("PATH", binDir)

	runner := NewRunner(Config{}, nil)
	_, _, err := runner.composeCommand(t.Context())

	if err == nil {
		t.Fatal("expected missing Docker Compose to fail")
	}
	assertContains(t, err.Error(), "Docker Compose is not available")
}

func TestCloneURLDefaultsToGitHubTokenURL(t *testing.T) {
	runner := NewRunner(Config{}, nil)

	url := runner.cloneURL(repo{
		FullName: "acme/app",
		Token:    "github-token",
	})

	if url != "https://x-access-token:github-token@github.com/acme/app.git" {
		t.Fatalf("unexpected clone URL: %s", url)
	}
}

func TestComposeRiskWarnings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "compose.yml")
	writeFile(t, path, `services:
  web:
    image: app
    container_name: app
    privileged: true
    network_mode: host
    ports:
      - "3000:3000"
volumes:
  data:
    name: shared-data
    external: true
`)

	warnings := strings.Join(composeRiskWarnings(path), "\n")
	assertContains(t, warnings, "container_name disables Compose project scoping")
	assertContains(t, warnings, "privileged containers increase host-level risk")
	assertContains(t, warnings, "network_mode: host bypasses Compose network isolation")
	assertContains(t, warnings, "published host ports can collide")
	assertContains(t, warnings, "fixed host port mapping detected")
	assertContains(t, warnings, "explicit volume names are global")
	assertContains(t, warnings, "external volumes or networks are shared by design")
}

func TestCloneURLUsesConfiguredBaseWithoutToken(t *testing.T) {
	runner := NewRunner(Config{GitCloneBase: "file:///tmp/devpush-git"}, nil)

	url := runner.cloneURL(repo{
		FullName: "acme/app",
		Token:    "github-token",
	})

	if url != "file:///tmp/devpush-git/acme/app.git" {
		t.Fatalf("unexpected clone URL: %s", url)
	}
}

func TestRunDeploymentJobBuildsBeforeReleaseAndUp(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	dockerLog := filepath.Join(tempDir, "docker.log")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "git"), `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  mkdir -p "$last"
  cat > "$last/compose.yml" <<'YAML'
services:
  web:
    build: .
YAML
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  echo abc1234
  exit 0
fi
exit 1
`)
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  *" ps -q")
    echo fake-container
    exit 0
    ;;
esac
if [ "$1" = "inspect" ] && [ "$2" = "-f" ]; then
  echo "/devpush-web-1	running	healthy"
  exit 0
fi
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_DOCKER_LOG", dockerLog)

	runner := NewRunner(Config{
		AgentID:  "server-1",
		StateDir: filepath.Join(tempDir, "state"),
		Token:    "agent-token",
	}, nil)

	completion := runner.runDeploymentJob(t.Context(), deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "acme/app",
			Branch:   "main",
			Token:    "github-token",
		},
		Compose: composeConfig{
			Path:           "compose.yml",
			ProjectName:    "devpush_app_production",
			ReleaseCommand: "echo migrate",
			ReleaseService: "web",
		},
	})

	if completion.Status != "succeeded" {
		t.Fatalf("expected deployment to succeed, got %s: %v", completion.Status, completion.Logs)
	}
	if completion.GitSha == nil || *completion.GitSha != "abc1234" {
		t.Fatalf("expected git sha abc1234, got %#v", completion.GitSha)
	}

	content := readFile(t, dockerLog)
	pullIndex := strings.Index(content, " pull --ignore-pull-failures\n")
	buildIndex := strings.Index(content, " build\n")
	releaseIndex := strings.Index(content, "run --rm web sh -lc echo migrate")
	upIndex := strings.Index(content, "up -d --no-build")
	if pullIndex < 0 {
		t.Fatalf("expected docker pull command in %q", content)
	}
	if buildIndex < 0 {
		t.Fatalf("expected docker build command in %q", content)
	}
	if releaseIndex < 0 {
		t.Fatalf("expected release command in %q", content)
	}
	if upIndex < 0 {
		t.Fatalf("expected up command in %q", content)
	}
	if !(pullIndex < buildIndex && buildIndex < releaseIndex && releaseIndex < upIndex) {
		t.Fatalf("expected pull before build before release before up, got log:\n%s", content)
	}
}

func TestRunDeploymentJobStopsWhenDeploymentIsCanceled(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/jobs/progress", func(response http.ResponseWriter, request *http.Request) {
		writeJSON(t, response, progressJobResponse{OK: true})
	})
	mux.HandleFunc("/api/agents/jobs/status", func(response http.ResponseWriter, request *http.Request) {
		var payload statusJobRequest
		decodeJSON(t, request, &payload)
		if payload.DeploymentID != "deployment-1" {
			t.Fatalf("unexpected status payload: %#v", payload)
		}

		writeJSON(t, response, statusJobResponse{DeploymentID: "deployment-1", Status: "canceled"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	runner := NewRunner(Config{
		AgentID:   "server-1",
		ServerURL: server.URL,
		StateDir:  filepath.Join(tempDir, "state"),
		Token:     "agent-token",
	}, nil)

	completion := runner.runDeploymentJob(t.Context(), deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "acme/app",
			Branch:   "main",
			Token:    "github-token",
		},
		Compose: composeConfig{
			Path:        "compose.yml",
			ProjectName: "devpush_app_production",
		},
	})

	if completion.Status != "canceled" {
		t.Fatalf("expected deployment to be canceled, got %s: %v", completion.Status, completion.Logs)
	}
}

func TestRunDeploymentJobExplainsMissingComposeFile(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "git"), `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  mkdir -p "$last"
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  echo abc1234
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{
		AgentID:  "server-1",
		StateDir: filepath.Join(tempDir, "state"),
		Token:    "agent-token",
	}, nil)

	completion := runner.runDeploymentJob(t.Context(), deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "acme/app",
			Branch:   "main",
			Token:    "github-token",
		},
		Compose: composeConfig{
			Path:        "deploy/compose.yml",
			ProjectName: "devpush_app_production",
		},
	})

	if completion.Status != "failed" {
		t.Fatalf("expected deployment to fail, got %s", completion.Status)
	}
	content := strings.Join(completion.Logs, "\n")
	assertContains(t, content, "Compose file deploy/compose.yml was not found")
	assertContains(t, content, "Update the project Compose path")
}

func TestRunDeploymentJobExplainsReleaseCommandFailure(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "git"), `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  mkdir -p "$last"
  cat > "$last/compose.yml" <<'YAML'
services:
  web:
    image: nginx:alpine
YAML
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  echo abc1234
  exit 0
fi
exit 1
`)
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
set -eu
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi
case "$*" in
  *" run --rm web sh -lc bad-migrate"*)
    echo "migration failed"
    exit 1
    ;;
esac
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	runner := NewRunner(Config{
		AgentID:  "server-1",
		StateDir: filepath.Join(tempDir, "state"),
		Token:    "agent-token",
	}, nil)

	completion := runner.runDeploymentJob(t.Context(), deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "acme/app",
			Branch:   "main",
			Token:    "github-token",
		},
		Compose: composeConfig{
			Path:           "compose.yml",
			ProjectName:    "devpush_app_production",
			ReleaseCommand: "bad-migrate",
			ReleaseService: "web",
		},
	})

	if completion.Status != "failed" {
		t.Fatalf("expected deployment to fail, got %s", completion.Status)
	}
	content := strings.Join(completion.Logs, "\n")
	assertContains(t, content, "release command failed on service web")
	assertContains(t, content, "make it safe to rerun")
	assertContains(t, content, "migration failed")
}

func TestRunnerRegistersClaimsAndCompletesJob(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-http-smoke-")
	binDir := filepath.Join(tempDir, "bin")
	dockerLog := filepath.Join(tempDir, "docker.log")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(binDir, "git"), `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  mkdir -p "$last"
  cat > "$last/compose.yml" <<'YAML'
services:
  web:
    image: nginx:alpine
YAML
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  echo def5678
  exit 0
fi
exit 1
`)
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  *" ps -q")
    echo fake-container
    exit 0
    ;;
esac
if [ "$1" = "inspect" ] && [ "$2" = "-f" ]; then
  echo "/devpush-web-1	running	healthy"
  exit 0
fi
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_DOCKER_LOG", dockerLog)

	controlPlane := newMockControlPlane(t)
	defer controlPlane.server.Close()

	runner := NewRunner(Config{
		ServerURL: controlPlane.server.URL,
		StateDir:  filepath.Join(tempDir, "state"),
		Token:     "agent-token",
	}, nil)
	ctx, cancel := context.WithCancel(t.Context())
	controlPlane.cancel = cancel

	if err := runner.Run(ctx); err != nil && !strings.Contains(err.Error(), "context canceled") {
		t.Fatal(err)
	}

	controlPlane.assertCompleted(t)
	assertContains(t, readFile(t, dockerLog), "up -d --no-build")
}

func TestRunDeploymentJobRunsRealDockerCompose(t *testing.T) {
	if os.Getenv("DEVPUSH_RUN_DOCKER_SMOKE") != "1" {
		t.Skip("set DEVPUSH_RUN_DOCKER_SMOKE=1 to run the Docker Compose smoke test")
	}
	requireDockerCompose(t)

	tempDir := workspaceTempDir(t, "agent-compose-smoke-")
	repoDir := filepath.Join(tempDir, "repo")
	gitRoot := filepath.Join(tempDir, "git")
	bareRepo := filepath.Join(gitRoot, "smoke", "app.git")
	dataDir := filepath.Join(tempDir, "data")
	stateDir := filepath.Join(tempDir, "state")
	projectName := "devpush_smoke_compose_" + randomSuffix(t)
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(bareRepo), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeFile(t, filepath.Join(repoDir, "compose.yml"), `services:
  web:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: smoke
    volumes:
      - `+yamlString(dataDir+`:/data`)+`
`)
	runTestCommand(t, repoDir, "git", "init", "-b", "main")
	runTestCommand(t, repoDir, "git", "config", "user.email", "smoke@devpush.local")
	runTestCommand(t, repoDir, "git", "config", "user.name", "devpush Smoke")
	runTestCommand(t, repoDir, "git", "add", "compose.yml")
	runTestCommand(t, repoDir, "git", "commit", "-m", "initial")
	runTestCommand(t, tempDir, "git", "clone", "--bare", repoDir, bareRepo)

	runner := NewRunner(Config{
		AgentID:      "server-1",
		StateDir:     stateDir,
		Token:        "agent-token",
		GitCloneBase: "file://" + gitRoot,
	}, nil)
	job := deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "smoke/app",
			Branch:   "main",
			Token:    "unused",
		},
		Compose: composeConfig{
			Path:           "compose.yml",
			ProjectName:    projectName,
			ReleaseCommand: "echo release > /data/release.txt",
			ReleaseService: "web",
		},
	}
	defer runComposeDown(t, projectName, filepath.Join(stateDir, "deployments", job.ID, "repo", "compose.yml"))

	completion := runner.runDeploymentJob(t.Context(), job)
	if completion.Status != "succeeded" {
		t.Fatalf("expected deployment to succeed, got %s:\n%s", completion.Status, strings.Join(completion.Logs, "\n"))
	}

	releaseContent := readFile(t, filepath.Join(dataDir, "release.txt"))
	if strings.TrimSpace(releaseContent) != "release" {
		t.Fatalf("expected release command output, got %q", releaseContent)
	}
}

func TestRunDeploymentJobRoutesThroughRealTraefik(t *testing.T) {
	if os.Getenv("DEVPUSH_RUN_DOCKER_SMOKE") != "1" {
		t.Skip("set DEVPUSH_RUN_DOCKER_SMOKE=1 to run the Docker route smoke test")
	}
	requireDockerCompose(t)
	if dockerCommandSucceeds("docker", "inspect", "devpush-traefik") {
		t.Skip("devpush-traefik already exists; skipping route smoke to avoid touching a local container")
	}
	httpPort := freeTCPPort(t)
	httpsPort := freeTCPPort(t)

	tempDir := workspaceTempDir(t, "agent-route-smoke-")
	repoDir := filepath.Join(tempDir, "repo")
	gitRoot := filepath.Join(tempDir, "git")
	bareRepo := filepath.Join(gitRoot, "smoke", "routed-app.git")
	stateDir := filepath.Join(tempDir, "state")
	projectName := "devpush_smoke_route_" + randomSuffix(t)
	host := "devpush-smoke-" + randomSuffix(t) + ".example.test"
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(bareRepo), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(repoDir, "compose.yml"), `services:
  web:
    image: nginx:alpine
`)
	runTestCommand(t, repoDir, "git", "init", "-b", "main")
	runTestCommand(t, repoDir, "git", "config", "user.email", "smoke@devpush.local")
	runTestCommand(t, repoDir, "git", "config", "user.name", "devpush Smoke")
	runTestCommand(t, repoDir, "git", "add", "compose.yml")
	runTestCommand(t, repoDir, "git", "commit", "-m", "initial")
	runTestCommand(t, tempDir, "git", "clone", "--bare", repoDir, bareRepo)
	t.Cleanup(func() {
		if os.Getenv("DEVPUSH_KEEP_DOCKER_SMOKE") == "1" {
			return
		}
		runComposeDown(t, projectName, filepath.Join(stateDir, "deployments", "deployment-1", "repo", "compose.yml"))
		runDockerCommand("docker", "rm", "-f", "devpush-traefik")
		runDockerCommand("docker", "volume", "rm", "devpush-traefik-acme")
		runDockerCommand("docker", "network", "rm", "devpush-proxy")
	})

	runner := NewRunner(Config{
		AgentID:          "server-1",
		StateDir:         stateDir,
		Token:            "agent-token",
		GitCloneBase:     "file://" + gitRoot,
		TraefikHTTPPort:  httpPort,
		TraefikHTTPSPort: httpsPort,
	}, nil)
	completion := runner.runDeploymentJob(t.Context(), deploymentJob{
		ID: "deployment-1",
		Repo: repo{
			FullName: "smoke/routed-app",
			Branch:   "main",
			Token:    "unused",
		},
		Compose: composeConfig{
			Path:          "compose.yml",
			ProjectName:   projectName,
			ReadinessPath: "/",
			Routes: []route{
				{
					Host:    host,
					Service: "web",
					Port:    80,
					Path:    "/",
					HTTPS:   false,
				},
			},
		},
	})

	if completion.Status != "succeeded" {
		t.Fatalf("expected routed deployment to succeed, got %s:\n%s", completion.Status, strings.Join(completion.Logs, "\n"))
	}

	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", httpPort), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = host
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "Welcome to nginx") {
		t.Fatalf("expected routed response, got %s: %s", response.Status, string(body))
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	return string(content)
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeExecutable(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func runTestCommand(t *testing.T, dir string, name string, args ...string) {
	t.Helper()

	command := exec.Command(name, args...)
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %s failed: %v\n%s", name, strings.Join(args, " "), err, string(output))
	}
}

func requireDockerCompose(t *testing.T) {
	t.Helper()

	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker is not installed")
	}
	if _, err := exec.LookPath("docker-compose"); err != nil {
		if command := exec.Command("docker", "compose", "version"); command.Run() != nil {
			t.Skip("Docker Compose is not installed")
		}
	}
}

func dockerCommandSucceeds(name string, args ...string) bool {
	return exec.Command(name, args...).Run() == nil
}

func runDockerCommand(name string, args ...string) {
	_ = exec.Command(name, args...).Run()
}

func runComposeDown(t *testing.T, projectName string, composePath string) {
	t.Helper()

	if _, err := os.Stat(composePath); err != nil {
		return
	}
	name, args := "docker-compose", []string{}
	if _, err := exec.LookPath("docker-compose"); err != nil {
		name, args = "docker", []string{"compose"}
	}
	args = append(args, "-p", projectName, "-f", composePath, "down", "-v", "--remove-orphans")
	command := exec.Command(name, args...)
	_ = command.Run()
}

type mockControlPlane struct {
	server     *httptest.Server
	cancel     context.CancelFunc
	mu         sync.Mutex
	registered bool
	heartbeat  bool
	claimed    bool
	progresses []jobProgress
	completed  *jobCompletion
}

func newMockControlPlane(t *testing.T) *mockControlPlane {
	t.Helper()

	controlPlane := &mockControlPlane{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agents/register", func(response http.ResponseWriter, request *http.Request) {
		var payload agentRequest
		decodeJSON(t, request, &payload)
		if payload.Token != "agent-token" || payload.AgentVersion != Version {
			t.Fatalf("unexpected register payload: %#v", payload)
		}

		controlPlane.mu.Lock()
		controlPlane.registered = true
		controlPlane.mu.Unlock()

		writeJSON(t, response, agentResponse{ServerID: "server-1", Status: "connected"})
	})
	mux.HandleFunc("/api/agents/heartbeat", func(response http.ResponseWriter, request *http.Request) {
		var payload agentRequest
		decodeJSON(t, request, &payload)
		if payload.ServerID != "server-1" || payload.Token != "agent-token" {
			t.Fatalf("unexpected heartbeat payload: %#v", payload)
		}

		controlPlane.mu.Lock()
		controlPlane.heartbeat = true
		controlPlane.mu.Unlock()

		writeJSON(t, response, agentResponse{ServerID: "server-1", Status: "connected"})
	})
	mux.HandleFunc("/api/agents/jobs/next", func(response http.ResponseWriter, request *http.Request) {
		var payload agentRequest
		decodeJSON(t, request, &payload)
		if payload.ServerID != "server-1" || payload.Token != "agent-token" {
			t.Fatalf("unexpected next job payload: %#v", payload)
		}

		controlPlane.mu.Lock()
		alreadyClaimed := controlPlane.claimed
		if !alreadyClaimed {
			controlPlane.claimed = true
		}
		controlPlane.mu.Unlock()

		if alreadyClaimed {
			writeJSON(t, response, nextJobResponse{})
			return
		}

		writeJSON(t, response, nextJobResponse{Job: &agentJob{
			Type: "deploy",
			ID:   "deployment-1",
			Repo: repo{
				FullName: "acme/app",
				Branch:   "main",
				Token:    "github-token",
			},
			Compose: composeConfig{
				Path:        "compose.yml",
				ProjectName: "devpush_app_production",
			},
		}})
	})
	mux.HandleFunc("/api/agents/jobs/complete", func(response http.ResponseWriter, request *http.Request) {
		var payload jobCompletion
		decodeJSON(t, request, &payload)

		controlPlane.mu.Lock()
		controlPlane.completed = &payload
		cancel := controlPlane.cancel
		controlPlane.mu.Unlock()

		writeJSON(t, response, completeJobResponse{OK: true})
		if cancel != nil {
			cancel()
		}
	})
	mux.HandleFunc("/api/agents/jobs/progress", func(response http.ResponseWriter, request *http.Request) {
		var payload jobProgress
		decodeJSON(t, request, &payload)
		if payload.ServerID != "server-1" || payload.Token != "agent-token" || payload.DeploymentID != "deployment-1" {
			t.Fatalf("unexpected progress payload: %#v", payload)
		}

		controlPlane.mu.Lock()
		controlPlane.progresses = append(controlPlane.progresses, payload)
		controlPlane.mu.Unlock()

		writeJSON(t, response, progressJobResponse{OK: true})
	})
	mux.HandleFunc("/api/agents/jobs/status", func(response http.ResponseWriter, request *http.Request) {
		var payload statusJobRequest
		decodeJSON(t, request, &payload)
		if payload.ServerID != "server-1" || payload.Token != "agent-token" || payload.DeploymentID != "deployment-1" {
			t.Fatalf("unexpected status payload: %#v", payload)
		}

		writeJSON(t, response, statusJobResponse{DeploymentID: "deployment-1", Status: "running"})
	})
	controlPlane.server = httptest.NewServer(mux)

	return controlPlane
}

func (controlPlane *mockControlPlane) assertCompleted(t *testing.T) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for {
		controlPlane.mu.Lock()
		registered := controlPlane.registered
		heartbeat := controlPlane.heartbeat
		claimed := controlPlane.claimed
		progresses := append([]jobProgress{}, controlPlane.progresses...)
		completed := controlPlane.completed
		controlPlane.mu.Unlock()

		if completed != nil {
			if !registered || !heartbeat || !claimed {
				t.Fatalf("incomplete protocol state: registered=%t heartbeat=%t claimed=%t", registered, heartbeat, claimed)
			}
			if completed.DeploymentID != "deployment-1" {
				t.Fatalf("unexpected completed deployment: %#v", completed)
			}
			if completed.Status != "succeeded" {
				t.Fatalf("expected succeeded completion, got %#v", completed)
			}
			if completed.GitSha == nil || *completed.GitSha != "def5678" {
				t.Fatalf("expected git sha def5678, got %#v", completed.GitSha)
			}
			if len(progresses) == 0 {
				t.Fatal("expected deployment progress before completion")
			}
			if progresses[0].LogStartSeq != 1 {
				t.Fatalf("expected first progress log sequence to start at 1, got %d", progresses[0].LogStartSeq)
			}
			return
		}

		if time.Now().After(deadline) {
			t.Fatal("agent did not complete job")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func decodeJSON(t *testing.T, request *http.Request, target any) {
	t.Helper()

	defer request.Body.Close()
	if err := json.NewDecoder(request.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func writeJSON(t *testing.T, response http.ResponseWriter, payload any) {
	t.Helper()

	response.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		t.Fatal(err)
	}
}

func randomSuffix(t *testing.T) string {
	t.Helper()

	return strings.ReplaceAll(filepath.Base(t.TempDir()), "-", "")
}

func freeTCPPort(t *testing.T) int {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}

func workspaceTempDir(t *testing.T, pattern string) string {
	t.Helper()

	workspaceTmp, err := filepath.Abs(filepath.Join("..", "..", ".tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(workspaceTmp, 0o755); err != nil {
		t.Fatal(err)
	}
	tempDir, err := os.MkdirTemp(workspaceTmp, pattern)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(tempDir)
	})

	return tempDir
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()

	if !strings.Contains(value, expected) {
		t.Fatalf("expected %q to contain %q", value, expected)
	}
}

func assertNotContains(t *testing.T, value string, unexpected string) {
	t.Helper()

	if strings.Contains(value, unexpected) {
		t.Fatalf("expected %q not to contain %q", value, unexpected)
	}
}
