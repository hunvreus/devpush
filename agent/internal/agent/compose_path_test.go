package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRepositoryFileAcceptsNestedFile(t *testing.T) {
	repoDir := t.TempDir()
	want := filepath.Join(repoDir, "deploy", "compose.yml")
	if err := os.MkdirAll(filepath.Dir(want), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("services: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := resolveRepositoryFile(repoDir, "deploy/compose.yml")
	if err != nil {
		t.Fatal(err)
	}
	resolvedWant, err := filepath.EvalSymlinks(want)
	if err != nil {
		t.Fatal(err)
	}
	if got != resolvedWant {
		t.Fatalf("path = %q, want %q", got, resolvedWant)
	}
}

func TestResolveRepositoryFileRejectsEscapes(t *testing.T) {
	repoDir := t.TempDir()

	for _, configuredPath := range []string{"../compose.yml", "deploy/../../compose.yml", "/etc/passwd"} {
		t.Run(configuredPath, func(t *testing.T) {
			if _, err := resolveRepositoryFile(repoDir, configuredPath); err == nil {
				t.Fatalf("resolveRepositoryFile(%q) succeeded", configuredPath)
			}
		})
	}
}

func TestResolveRepositoryFileRejectsSymlinkEscape(t *testing.T) {
	repoDir := t.TempDir()
	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "compose.yml")
	if err := os.WriteFile(outsideFile, []byte("services: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(repoDir, "compose.yml")); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}

	if _, err := resolveRepositoryFile(repoDir, "compose.yml"); err == nil {
		t.Fatal("resolveRepositoryFile accepted a symlink outside the repository")
	}
}
