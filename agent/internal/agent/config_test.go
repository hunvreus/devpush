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
