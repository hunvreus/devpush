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
