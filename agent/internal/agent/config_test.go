package agent

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigReadsBaseURL(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "https://devpush.example")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "agent-token")

	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing.env"))
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.BaseURL != "https://devpush.example" {
		t.Fatalf("BaseURL = %q, want %q", cfg.BaseURL, "https://devpush.example")
	}
}

func TestLoadConfigRequiresBaseURL(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "agent-token")

	_, err := LoadConfig(filepath.Join(t.TempDir(), "missing.env"))
	if err == nil || err.Error() != "DEVPUSH_BASE_URL is required" {
		t.Fatalf("LoadConfig() error = %v, want DEVPUSH_BASE_URL requirement", err)
	}
}

func TestLoadConfigRuntimeLogQueueLimit(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "https://devpush.example")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "agent-token")
	for _, value := range []string{"", "1048576", "0", "-1", "invalid"} {
		t.Setenv("DEVPUSH_RUNTIME_LOG_QUEUE_BYTES", value)
		cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing.env"))
		if value == "" && (err != nil || cfg.RuntimeLogQueueBytes != 128<<20) {
			t.Fatalf("invalid default: %#v, %v", cfg, err)
		}
		if value == "1048576" && (err != nil || cfg.RuntimeLogQueueBytes != 1048576) {
			t.Fatalf("invalid override: %#v, %v", cfg, err)
		}
		if value != "" && value != "1048576" && err == nil {
			t.Fatalf("accepted invalid limit %q", value)
		}
	}
}

func TestLoadConfigRequiresSecureCanonicalControlPlaneOrigin(t *testing.T) {
	t.Setenv("DEVPUSH_AGENT_TOKEN", "agent-token")
	for _, value := range []string{"http://devpush.example", "http://192.168.1.2:7429", "ftp://devpush.example", "https://user:secret@devpush.example", "https://devpush.example/path", "https://devpush.example?", "https://devpush.example#"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("DEVPUSH_BASE_URL", value)
			if _, err := LoadConfig(filepath.Join(t.TempDir(), "missing.env")); err == nil {
				t.Fatal("accepted unsafe control-plane origin")
			}
		})
	}
	for _, value := range []string{"https://devpush.example", "http://localhost:7429", "http://app.localhost:7429", "http://127.0.0.2:7429", "http://[::1]:7429", "http://host.lima.internal:7429"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("DEVPUSH_BASE_URL", value)
			if _, err := LoadConfig(filepath.Join(t.TempDir(), "missing.env")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRoutingAddressConfig(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "https://devpush.example")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "token")
	for _, address := range []string{"192.168.64.7", "2001:db8::7", "", "auto", "localhost", "0.0.0.0", "127.0.0.1", "224.0.0.1", "1.2.3.4:80"} {
		t.Run(address, func(t *testing.T) {
			t.Setenv("DEVPUSH_ROUTING_ADDRESS", address)
			cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing"))
			valid := address == "" || address == "192.168.64.7" || address == "2001:db8::7"
			if valid && (err != nil || cfg.RoutingAddress != address) {
				t.Fatalf("config=%+v err=%v", cfg, err)
			}
			if !valid && err == nil {
				t.Fatalf("accepted %s", address)
			}
		})
	}
}

func TestJobPollInterval(t *testing.T) {
	t.Setenv("DEVPUSH_BASE_URL", "https://devpush.example")
	t.Setenv("DEVPUSH_AGENT_TOKEN", "token")
	for _, value := range []string{"0s", "-1s", "61s", "bad"} {
		t.Setenv("DEVPUSH_JOB_POLL_INTERVAL", value)
		if _, err := LoadConfig(filepath.Join(t.TempDir(), "missing")); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	t.Setenv("DEVPUSH_JOB_POLL_INTERVAL", "5s")
	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.pollInterval().Seconds() != 5 {
		t.Fatal(cfg.pollInterval())
	}
}
