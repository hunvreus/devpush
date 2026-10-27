package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinnedCheckoutDoesNotRequireDeletedBranch(t *testing.T) {
	dir := workspaceTempDir(t, "deleted-branch-")
	source := filepath.Join(dir, "source")
	checkout := filepath.Join(dir, "checkout")
	if err := os.Mkdir(source, 0750); err != nil {
		t.Fatal(err)
	}
	run := func(dir, name string, args ...string) error {
		c := exec.CommandContext(t.Context(), name, args...)
		c.Dir = dir
		out, err := c.CombinedOutput()
		if err != nil {
			t.Logf("%s %v: %s", name, args, out)
		}
		return err
	}
	for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.email", "test@example.com"}, {"config", "user.name", "Test"}} {
		if err := run(source, "git", args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "file"), []byte("pinned contents"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "."}, {"commit", "-m", "initial"}, {"branch", "deleted"}, {"branch", "-D", "deleted"}} {
		if err := run(source, "git", args...); err != nil {
			t.Fatal(err)
		}
	}
	command := exec.Command("git", "-C", source, "rev-parse", "HEAD")
	sha, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	// Advance main after recording the historical SHA. A branch fallback would
	// deploy newer contents and must never silently replace the pinned source.
	if err := os.WriteFile(filepath.Join(source, "file"), []byte("newer contents"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "."}, {"commit", "-m", "newer"}} {
		if err := run(source, "git", args...); err != nil {
			t.Fatal(err)
		}
	}
	runner := NewRunner(Config{GitCloneBase: "file://" + dir}, nil)
	// cloneURL appends .git; use a local bare origin without the deleted branch.
	if err := run(dir, "git", "clone", "--bare", source, filepath.Join(dir, "app.git")); err != nil {
		t.Fatal(err)
	}
	if err := runner.checkoutRepository(dir, checkout, repo{FullName: "app", Branch: "deleted", Sha: strings.TrimSpace(string(sha))}, run); err != nil {
		t.Fatal(err)
	}
	if body := readFile(t, filepath.Join(checkout, "file")); body != "pinned contents" {
		t.Fatalf("wrong checkout: %s", body)
	}
	if err := runner.checkoutRepository(dir, filepath.Join(dir, "missing"), repo{FullName: "app", Branch: "main", Sha: strings.Repeat("0", 40)}, run); err == nil {
		t.Fatal("missing pinned commit silently fell back to main")
	}
}
