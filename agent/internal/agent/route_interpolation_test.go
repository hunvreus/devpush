package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRouteOverrideKeepsLiteralDollars(t *testing.T) {
	path := filepath.Join(t.TempDir(), "override.yml")
	if err := writeRouteOverride(path, "app", []route{{Host: "example.com", Service: "web", Port: 3000, Path: "/$PREFIX"}}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "/$$PREFIX") {
		t.Fatal("literal route dollar must be escaped for Compose interpolation")
	}
}

func TestCommaRouteCannotBeStripped(t *testing.T) {
	for _, strip := range []bool{false, true} {
		err := writeRouteOverride(filepath.Join(t.TempDir(), "override.yml"), "app", []route{{Host: "example.com", Service: "web", Port: 3000, Path: "/one,two", StripPrefix: strip}})
		if (err != nil) != strip {
			t.Fatalf("unexpected comma validation result (strip=%v): %v", strip, err)
		}
	}
}
