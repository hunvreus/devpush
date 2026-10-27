package agent

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDrainWaitsForJobAndBlocksNewClaims(t *testing.T) {
	cfg := Config{StateDir: t.TempDir()}
	runner := NewRunner(cfg, nil)
	lock, err := runner.lockJob()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	go func() { done <- Drain(ctx, cfg) }()
	for {
		if _, err := os.Stat(filepath.Join(cfg.StateDir, drainFile)); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("no drain marker")
		case <-time.After(time.Millisecond):
		}
	}
	select {
	case err := <-done:
		t.Fatalf("drain finished while job active: %v", err)
	default:
	}
	unlockJob(lock)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := runner.lockJob(); err == nil {
		t.Fatal("claimed during drain")
	}
	if err := Resume(cfg); err != nil {
		t.Fatal(err)
	}
	lock, err = runner.lockJob()
	if err != nil {
		t.Fatal(err)
	}
	unlockJob(lock)
}

func TestDrainTimeoutResumesClaimsWithoutCancelingJob(t *testing.T) {
	cfg := Config{StateDir: t.TempDir()}
	runner := NewRunner(cfg, nil)
	lock, err := runner.lockJob()
	if err != nil {
		t.Fatal(err)
	}
	defer unlockJob(lock)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()
	if err := Drain(ctx, cfg); !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "active work continues") {
		t.Fatalf("got %v", err)
	}
	if _, err := os.Stat(filepath.Join(cfg.StateDir, drainFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("drain marker remains")
	}
}

func TestSwitchConfigPreservesSettingsAndReplacesIdentity(t *testing.T) {
	for _, key := range []string{"DEVPUSH_BASE_URL", "DEVPUSH_AGENT_TOKEN", "DEVPUSH_STATE_DIR", "DEVPUSH_TRAEFIK_EMAIL"} {
		t.Setenv(key, "")
	}
	body := switchConfig([]byte("DEVPUSH_BASE_URL=\"https://old.test\"\nDEVPUSH_AGENT_TOKEN=\"old\"\nDEVPUSH_STATE_DIR=\"old-state\"\nDEVPUSH_TRAEFIK_EMAIL=\"ops@example.com\"\n"), Config{BaseURL: "https://new.test", Token: "new", StateDir: "new-state"})
	file := filepath.Join(t.TempDir(), "agent.env")
	if err := os.WriteFile(file, body, 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(file)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "https://new.test" || cfg.Token != "new" || cfg.StateDir != "new-state" || cfg.TraefikEmail != "ops@example.com" {
		t.Fatalf("incorrect config: URL=%s", cfg.BaseURL)
	}
}

func TestSwitchRejectsSameOriginWithoutDraining(t *testing.T) {
	cfg := Config{BaseURL: "https://old.test", StateDir: t.TempDir()}
	if err := SwitchControlPlane(t.Context(), cfg, "missing", "https://old.test", "missing"); err == nil {
		t.Fatal("expected rejection")
	}
	if _, err := os.Stat(filepath.Join(cfg.StateDir, drainFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unexpected drain")
	}
}

func TestUpdateNoopAndRollbackKeepPreviousBinary(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StateDir: dir}
	runner := NewRunner(cfg, nil)
	lock, err := runner.lockJob()
	if err != nil {
		t.Fatal(err)
	}
	unlockJob(lock)
	binary := filepath.Join(dir, "agent")
	candidate := filepath.Join(dir, "candidate")
	if err := os.WriteFile(binary, []byte("old"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(candidate, []byte("old"), 0755); err != nil {
		t.Fatal(err)
	}
	calls := []string{}
	service := func(_ context.Context, action string) error { calls = append(calls, action); return nil }
	ready := func(context.Context, Config) error { return errors.New("no heartbeat") }
	messages := []string{}
	ctx := WithMaintenanceProgress(t.Context(), func(message string) { messages = append(messages, message) })
	if err := applyUpdate(ctx, cfg, binary, candidate, service, ready); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || !strings.Contains(messages[0], "no restart needed") {
		t.Fatalf("missing no-op feedback: %v", messages)
	}
	if len(calls) != 0 {
		t.Fatal("same binary restarted service")
	}
	if err := os.WriteFile(candidate, []byte("new"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := applyUpdate(ctx, cfg, binary, candidate, service, ready); err == nil {
		t.Fatal("expected rollback")
	}
	if !strings.Contains(strings.Join(messages, "\n"), "Restoring the previous binary") {
		t.Fatal("missing rollback feedback")
	}
	content, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old" {
		t.Fatal("previous binary not restored")
	}
	if len(calls) != 4 || calls[0] != "stop" || calls[1] != "start" || calls[2] != "stop" || calls[3] != "start" {
		t.Fatalf("unexpected service actions %v", calls)
	}
	if _, err := os.Stat(filepath.Join(dir, drainFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("claims not resumed")
	}
}

func TestSwitchFailedHeartbeatRollsBackOriginAndSource(t *testing.T) {
	dir := t.TempDir()
	state := filepath.Join(dir, "state")
	if err := os.Mkdir(state, 0750); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	rolledBack := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agents/register":
			writeJSON(t, w, agentResponse{ServerID: "server", Status: "connected", Credential: "dpa_destination"})
		case "/api/agents/heartbeat":
			writeJSON(t, w, agentResponse{ServerID: "server", Status: "connected"})
		case "/api/agents/switch":
			var value map[string]string
			decodeJSON(t, r, &value)
			if value["action"] == "rollback" {
				rolledBack = true
			}
			writeJSON(t, w, map[string]string{"ticket": "ticket"})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	cfg := Config{BaseURL: "https://source.test", Token: "dpa_source", StateDir: state}
	runner := NewRunner(cfg, nil)
	lock, err := runner.lockJob()
	if err != nil {
		t.Fatal(err)
	}
	unlockJob(lock)
	configPath := filepath.Join(dir, "agent.env")
	original := switchConfig(nil, cfg)
	if err := os.WriteFile(configPath, original, 0640); err != nil {
		t.Fatal(err)
	}
	tokenPath := filepath.Join(dir, "token")
	if err := os.WriteFile(tokenPath, []byte("dps_enrollment"), 0600); err != nil {
		t.Fatal(err)
	}
	factory := func(c Config) *Runner {
		c.BaseURL = server.URL
		runner := NewRunner(c, nil)
		runner.httpClient = server.Client()
		return &runner
	}
	actions := []string{}
	service := func(_ context.Context, action string) error { actions = append(actions, action); return nil }
	ready := func(context.Context, Config) error { return errors.New("no destination heartbeat") }
	err = applySwitch(t.Context(), cfg, configPath, server.URL, tokenPath, factory, service, ready)
	if err == nil || !strings.Contains(err.Error(), "heartbeat") {
		t.Fatalf("expected failure, got %v", err)
	}
	if !rolledBack {
		t.Fatal("source was not re-enabled")
	}
	current, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(current) != string(original) {
		t.Fatal("source config not restored")
	}
	if len(actions) != 4 {
		t.Fatalf("service was not stopped and restarted for rollback: %v", actions)
	}
	if _, err := os.Stat(filepath.Join(state, drainFile)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("source remains drained")
	}
}

func TestRemoteBackupFailurePreservesLocalRecovery(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0750); err != nil {
		t.Fatal(err)
	}
	docker := "#!/bin/sh\nif [ \"$1\" = compose ] && [ \"$2\" != version ] && [ \"$3\" != version ]; then echo 'recoverable database content'; fi\nexit 0\n"
	rclone := "#!/bin/sh\nif [ \"$1\" = version ]; then exit 0; fi\necho 'bucket unavailable' >&2\nexit 1\n"
	for name, script := range map[string]string{"docker": docker, "rclone": rclone} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	runner := NewRunner(Config{AgentID: "s", StateDir: filepath.Join(dir, "state")}, nil)
	base := filepath.Join(dir, "backup")
	if err := os.Mkdir(base, 0750); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(base, "database.sql.gz")
	if err := os.WriteFile(file, []byte("complete local backup"), 0600); err != nil {
		t.Fatal(err)
	}
	artifact, err := fileArtifact(file, "database", "local", file)
	if err != nil {
		t.Fatal(err)
	}
	completion := runner.uploadCompletedBackup(t.Context(), agentJob{ID: "job", Backup: backupConfig{
		BackupRunID: "run", RuntimeID: "runtime", LocalBasePath: base, ArtifactPrefix: "backups/run",
		Destination: backupDestination{Bucket: "gone-bucket", AccessKeyID: "test", SecretAccessKey: "test"},
		Retention:   backupRetentionPolicy{Remote: backupRemoteRetentionLimit{Enabled: true}},
	}}, map[string]any{}, []backupArtifact{artifact})
	if completion.Status != "failed" || completion.Manifest["localRecoveryAvailable"] != true {
		t.Fatalf("completion: %+v", completion)
	}
	if !strings.Contains(completion.Message, "Remote upload failed") {
		t.Fatal(completion.Message)
	}
	if len(completion.Artifacts) != 1 {
		t.Fatalf("artifacts: %+v", completion.Artifacts)
	}
	for _, artifact := range completion.Artifacts {
		if artifact.Storage != "local" {
			t.Fatal("unexpected remote artifact")
		}
		info, err := os.Stat(artifact.ObjectKey)
		if err != nil || info.Size() == 0 {
			t.Fatalf("local file missing: %s %v", artifact.ObjectKey, err)
		}
	}
}
