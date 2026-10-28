package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitAuthDoesNotPersistTokenOrUseArguments(t *testing.T) {
	runner := NewRunner(Config{}, nil)
	repository := repo{FullName: "acme/app", Token: "secret-token"}
	if strings.Contains(runner.cloneURL(repository), repository.Token) {
		t.Fatal("credential in clone URL")
	}
	env := strings.Join(runner.gitAuthEnv(repository), "\n")
	if !strings.Contains(env, base64.StdEncoding.EncodeToString([]byte("x-access-token:secret-token"))) {
		t.Fatal("missing git authentication")
	}
	if strings.Contains(env, "GIT_CONFIG_KEY_0=http.extraheader") {
		t.Fatal("authentication must be scoped to GitHub")
	}
	dir := t.TempDir()
	if output, err := exec.Command("git", "init", "--quiet", dir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	command := exec.Command("git", "config", "--get-urlmatch", "http.extraheader", "https://github.com/acme/app.git")
	command.Dir = dir
	command.Env = mergeCommandEnv(os.Environ(), runner.gitAuthEnv(repository))
	output, err := command.Output()
	if err != nil || !strings.Contains(string(output), "AUTHORIZATION: basic") {
		t.Fatalf("Git did not accept child authentication: %v", err)
	}
	config, err := os.ReadFile(filepath.Join(dir, ".git", "config"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "AUTHORIZATION") || strings.Contains(string(config), repository.Token) {
		t.Fatal("credential persisted in git config")
	}
	command = exec.Command("git", "config", "--get-urlmatch", "http.extraheader", "https://mirror.example/acme/app.git")
	command.Env = mergeCommandEnv(os.Environ(), runner.gitAuthEnv(repository))
	if output, err := command.Output(); err == nil || len(output) != 0 {
		t.Fatal("Git authentication leaked to another origin")
	}
	runner.cfg.GitCloneBase = "https://mirror.example"
	if len(runner.gitAuthEnv(repository)) != 0 {
		t.Fatal("sent GitHub credential to a mirror")
	}
}

func TestEnvValuesRoundTripThroughCompose(t *testing.T) {
	binary := os.Getenv("DEVPUSH_COMPOSE_TEST_BINARY")
	prefix := []string{}
	if binary == "" {
		var err error
		binary, err = exec.LookPath("docker")
		if err != nil {
			t.Skip("Docker Compose unavailable")
		}
		prefix = []string{"compose"}
		if err := exec.Command(binary, "compose", "version").Run(); err != nil {
			t.Skip("Docker Compose unavailable")
		}
	}
	values := []envVar{
		{Key: "QUOTE", Value: "can't"}, {Key: "SLASH_QUOTE", Value: "a\\'b"},
		{Key: "TRAILING", Value: "ends\\"}, {Key: "MULTILINE", Value: "first\nsecond"},
		{Key: "DOLLAR", Value: "${HOME} $abc $$"}, {Key: "CRLF", Value: "first\r\nsecond"},
		{Key: "DOUBLESLASH", Value: "a\\\\b"}, {Key: "DOUBLEQUOTE", Value: "a\"b"},
		{Key: "ESCAPED_DOLLAR", Value: "\\$abc"}, {Key: "EMPTY", Value: ""},
	}
	dir := t.TempDir()
	envFile := filepath.Join(dir, "env")
	if err := writeEnvFile(envFile, values); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(dir, "compose.yml")
	content := "services:\n  web:\n    image: alpine\n    environment:\n"
	for _, value := range values {
		content += "      " + value.Key + ": ${" + value.Key + "}\n"
	}
	if err := os.WriteFile(composeFile, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	args := append(prefix, "--env-file", envFile, "-p", "env-test", "-f", composeFile, "config", "--format", "json")
	command := exec.Command(binary, args...)
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Compose config: %v: %s", err, output)
	}
	var model struct {
		Services map[string]struct{ Environment map[string]string }
	}
	if err := json.Unmarshal(output, &model); err != nil {
		t.Fatal(err)
	}
	for _, value := range values {
		// Compose config escapes dollar signs for safe reloading of its output.
		actual := strings.ReplaceAll(model.Services["web"].Environment[value.Key], "$$", "$")
		if actual != value.Value {
			t.Errorf("%s: got %q, want %q", value.Key, actual, value.Value)
		}
	}
}

func TestDeploymentRetentionProtectsContainerReferences(t *testing.T) {
	root := t.TempDir()
	deployment := filepath.Join(root, "deployments", "old")
	for _, reference := range []string{deployment, filepath.Join(deployment, "repo", "data"), root} {
		if !pathsOverlap(deployment, reference) {
			t.Errorf("failed to protect %s", reference)
		}
	}
	if pathsOverlap(deployment, deployment+"-other") {
		t.Fatal("matched sibling directory")
	}
	paths, err := deploymentContainerPaths(`[{"Mounts":[{"Source":"/state/deployments/old/repo/data"}],"Config":{"Labels":{"com.docker.compose.project.working_dir":"/state/deployments/current/repo","com.docker.compose.project.config_files":"/state/deployments/current/repo/compose.yml,/state/deployments/current/override.yml"}}}]`)
	if err != nil || len(paths) != 4 {
		t.Fatalf("paths: %v, %v", paths, err)
	}
	if _, err := deploymentContainerPaths("not json"); err == nil {
		t.Fatal("invalid inventory must fail closed")
	}
	// Exercise actual deletion with an empty, successfully inspected inventory.
	cfg := Config{StateDir: root}
	runner := NewRunner(cfg, nil)
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	keep := filepath.Join(root, "deployments", "current")
	for _, path := range []string{deployment, keep} {
		if err := os.MkdirAll(path, 0750); err != nil {
			t.Fatal(err)
		}
	}
	if err := runner.pruneDeploymentDirectories(context.Background(), keep); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(deployment); !os.IsNotExist(err) {
		t.Fatal("unused checkout retained")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("current checkout removed")
	}
}

func TestResolvedComposeRiskWarnings(t *testing.T) {
	model, err := parseComposeModel(`{"services":{"web":{"privileged":true,"volumes":[{"type":"bind","source":"/var/run/docker.sock"}]}}}`)
	if err != nil {
		t.Fatal(err)
	}
	warnings := strings.Join(model.riskWarnings(), "\n")
	for _, expected := range []string{"privileged", "/var/run/docker.sock", "trusted host access"} {
		if !strings.Contains(warnings, expected) {
			t.Errorf("missing warning %s", expected)
		}
	}
}

func TestPruneDeploymentDirectoriesRetainsMountsAndFailsClosed(t *testing.T) {
	root := t.TempDir()
	mounted := filepath.Join(root, "deployments", "mounted")
	unused := filepath.Join(root, "deployments", "unused")
	for _, path := range []string{mounted, unused} {
		if err := os.MkdirAll(path, 0750); err != nil {
			t.Fatal(err)
		}
	}
	inventory := filepath.Join(root, "inventory.json")
	content, err := json.Marshal([]any{map[string]any{"Mounts": []any{map[string]string{"Source": filepath.Join(mounted, "repo", "data")}}, "Config": map[string]any{"Labels": map[string]string{}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inventory, content, 0600); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	script := `#!/bin/sh
if [ "$RETENTION_TEST_FAIL" = "1" ]; then exit 1; fi
case "$1" in
ps) echo container-1 ;;
inspect) cat "$RETENTION_TEST_INVENTORY" ;;
esac
`
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("RETENTION_TEST_INVENTORY", inventory)
	runner := NewRunner(Config{StateDir: root}, nil)
	if err := runner.pruneDeploymentDirectories(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mounted); err != nil {
		t.Fatal("mounted checkout removed")
	}
	if _, err := os.Stat(unused); !os.IsNotExist(err) {
		t.Fatal("unused checkout retained")
	}
	if err := os.MkdirAll(unused, 0750); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RETENTION_TEST_FAIL", "1")
	if err := runner.pruneDeploymentDirectories(context.Background(), ""); err == nil {
		t.Fatal("inventory failure ignored")
	}
	if _, err := os.Stat(unused); err != nil {
		t.Fatal("deleted checkout after Docker failure")
	}
	t.Setenv("RETENTION_TEST_FAIL", "0")
	if err := os.WriteFile(inventory, []byte("[]"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runner.pruneDeploymentDirectories(context.Background(), ""); err == nil {
		t.Fatal("partial inspection ignored")
	}
	if _, err := os.Stat(unused); err != nil {
		t.Fatal("deleted checkout after partial inspection")
	}
}
