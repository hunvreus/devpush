package agent

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInactiveRedirects(t *testing.T) {
	runner := NewRunner(Config{StateDir: t.TempDir(), BaseURL: "https://dashboard.example"}, nil)
	job := deploymentJob{ID: "deployment-1", FallbackHost: "old.example.test", Routes: []route{{Host: "old.example.test", HTTPS: true}, {Host: "custom.example.test"}}}
	if err := runner.rememberInactiveRedirect(job); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(runner.certificateDirectory(), "dynamic", "inactive-redirects.yaml")
	body := readFile(t, path)
	if !strings.Contains(body, "old.example.test") || strings.Contains(body, "custom.example.test") {
		t.Fatalf("unexpected redirect hosts: %s", body)
	}
	var config struct {
		HTTP struct {
			Routers map[string]struct {
				Priority int
				Service  string
			}
			Middlewares map[string]struct {
				RedirectRegex struct {
					Regex, Replacement string
					Permanent          bool
				}
			}
		}
	}
	if err := json.Unmarshal([]byte(body), &config); err != nil {
		t.Fatal(err)
	}
	for _, router := range config.HTTP.Routers {
		if router.Priority != 1 || router.Service != "noop@internal" {
			t.Fatalf("unsafe router: %#v", router)
		}
	}
	for name, middleware := range config.HTTP.Middlewares {
		if strings.HasSuffix(name, "-privacy") {
			continue
		}
		if middleware.RedirectRegex.Replacement != "https://dashboard.example/deployments/deployment-1/unavailable" || middleware.RedirectRegex.Permanent {
			t.Fatalf("unsafe redirect: %#v", middleware)
		}
	}
	runner.cfg.DisableInactiveRedirects = true
	if err := runner.syncInactiveRedirects(); err != nil {
		t.Fatal(err)
	}
	if body := readFile(t, path); strings.Contains(body, "dashboard.example") {
		t.Fatalf("disabled redirects remain: %s", body)
	}
	runner.cfg.DisableInactiveRedirects = false
	if err := runner.syncInactiveRedirects(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []deploymentJob{{ID: "../escape", FallbackHost: job.FallbackHost, Routes: job.Routes}, {ID: "other", FallbackHost: "injected`) || Host(`evil", Routes: job.Routes}, {ID: "other", FallbackHost: "unknown.test", Routes: job.Routes}} {
		if err := runner.rememberInactiveRedirect(invalid); err == nil {
			t.Fatal("accepted invalid or unrecorded hostname")
		}
	}
}

func TestLoadConfigInactiveRedirects(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "https://dashboard.example")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "test")
	for _, value := range []string{"", "true", "false", "invalid"} {
		t.Setenv("DEVPUSH_DISABLE_INACTIVE_REDIRECTS", value)
		cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing"))
		if value == "invalid" {
			if err == nil {
				t.Fatal("accepted invalid boolean")
			}
			continue
		}
		if err != nil || cfg.DisableInactiveRedirects != (value == "true") {
			t.Fatalf("value %q: %#v %v", value, cfg, err)
		}
	}
}

func TestInactiveRedirectsWithRealTraefik(t *testing.T) {
	if os.Getenv("DEVPUSH_RUN_DOCKER_SMOKE") != "1" {
		t.Skip("set DEVPUSH_RUN_DOCKER_SMOKE=1")
	}
	runner := NewRunner(Config{StateDir: workspaceTempDir(t, "inactive-redirect-"), BaseURL: "https://dashboard.example"}, nil)
	if err := runner.rememberInactiveRedirect(deploymentJob{ID: "deployment-1", FallbackHost: "old.example.test", Routes: []route{{Host: "old.example.test"}}}); err != nil {
		t.Fatal(err)
	}
	if err := runner.rememberInactiveRedirect(deploymentJob{ID: "deployment-2", FallbackHost: "live.example.test", Routes: []route{{Host: "live.example.test"}}}); err != nil {
		t.Fatal(err)
	}
	// Simulate the higher-priority router of a live deployment without another app.
	live := `{"http":{"routers":{"live":{"rule":"Host(` + "`live.example.test`" + `)","entryPoints":["web"],"middlewares":["live"],"service":"noop@internal"}},"middlewares":{"live":{"redirectRegex":{"regex":"^http://.*","replacement":"https://live.example/"}}}}}`
	if err := writeAtomic(filepath.Join(runner.certificateDirectory(), "dynamic", "live.yaml"), []byte(live), 0600); err != nil {
		t.Fatal(err)
	}
	port := freeTCPPort(t)
	name := "devpush-fallback-test-" + randomSuffix(t)
	t.Cleanup(func() { runDockerCommand("docker", "rm", "-f", name) })
	runTestCommand(t, "", "docker", "run", "-d", "--name", name, "-p", fmt.Sprintf("127.0.0.1:%d:80", port), "-v", runner.certificateDirectory()+":/config", traefikImage, "--providers.file.directory=/config/dynamic", "--providers.file.watch=true", "--entrypoints.web.address=:80", "--entrypoints.websecure.address=:443")
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	check := func(host string, wantStatus int, wantLocation string) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for {
			req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/private/path?token=secret", port), nil)
			req.Host = host
			res, err := client.Do(req)
			if err == nil {
				io.Copy(io.Discard, res.Body)
				res.Body.Close()
				if res.StatusCode == wantStatus && res.Header.Get("Location") == wantLocation {
					if strings.Contains(wantLocation, "dashboard.example") && (res.Header.Get("Referrer-Policy") != "no-referrer" || res.Header.Get("Cache-Control") != "no-store") {
						t.Fatal("missing redirect privacy headers")
					}
					return
				}
			}
			if time.Now().After(deadline) {
				logs, _ := exec.Command("docker", "logs", name).CombinedOutput()
				body, _ := exec.Command("docker", "exec", name, "cat", "/config/dynamic/inactive-redirects.yaml").CombinedOutput()
				t.Fatalf("host %s: response=%v error=%v config=%s logs=%s", host, res, err, body, logs)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	check("old.example.test", 302, "https://dashboard.example/deployments/deployment-1/unavailable")
	check("unknown.example.test", 404, "")
	check("live.example.test", 302, "https://live.example/")
	runner.cfg.DisableInactiveRedirects = true
	if err := runner.syncInactiveRedirects(); err != nil {
		t.Fatal(err)
	}
	// Docker Desktop/Lima bind mounts do not consistently forward macOS fsnotify
	// events. Trigger the change inside Linux, as the production agent does.
	runTestCommand(t, "", "docker", "exec", name, "sh", "-c", `printf '%s' '{"http":{"middlewares":{},"routers":{}}}' > /config/dynamic/inactive-redirects.yaml`)
	check("old.example.test", 404, "")
}
