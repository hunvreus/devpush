package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRestartRecoversInterruptedVolumeWritesBeforeRestart(t *testing.T) {
	runner, dir, recovery, _ := restoreRecoveryFixture(t, "success")
	if err := os.MkdirAll(recovery, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recovery, "volume-0.tar.gz"), []byte("original-volume"), 0600); err != nil {
		t.Fatal(err)
	}
	journal := restoreJournal{JobID: "test-job", RuntimeID: "dp_project", Phase: "replacing", Containers: []string{"app-container"}, Volumes: []restoreJournalVolume{{Name: "dp_project_data", Backup: "volume-0.tar.gz"}}}
	if err := saveRestoreJournal(recovery, journal); err != nil {
		t.Fatal(err)
	}
	// Reconstruct the runner, as after a hard restart, with only durable state.
	restarted := NewRunner(runner.cfg, nil)
	if err := restarted.recoverVolumeRestore(t.Context(), recovery); err != nil {
		t.Fatal(err)
	}
	log := readFile(t, filepath.Join(dir, "commands"))
	remove := strings.Index(log, "rm -f devpush-restore-test-job-0-recovery")
	rollback := strings.Index(log, "start --attach devpush-restore-test-job-0-recovery")
	start := strings.LastIndex(log, "start app-container")
	if remove < 0 || rollback <= remove || start <= rollback {
		t.Fatalf("unsafe restart recovery: %s", log)
	}
	if _, err := os.Stat(recovery); !os.IsNotExist(err) {
		t.Fatalf("recovery not cleaned: %v", err)
	}
}

func TestFailedRestartRecoveryRetainsJournalAndCanRetry(t *testing.T) {
	runner, dir, recovery, _ := restoreRecoveryFixture(t, "rollback-fails")
	if err := os.MkdirAll(recovery, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recovery, "volume-0.tar.gz"), []byte("original-volume"), 0600); err != nil {
		t.Fatal(err)
	}
	journal := restoreJournal{JobID: "test-job", RuntimeID: "dp_project", Phase: "replacing", Containers: []string{"app-container"}, Volumes: []restoreJournalVolume{{Name: "dp_project_data", Backup: "volume-0.tar.gz"}}}
	if err := saveRestoreJournal(recovery, journal); err != nil {
		t.Fatal(err)
	}
	if err := runner.recoverVolumeRestore(t.Context(), recovery); err == nil {
		t.Fatal("accepted failed rollback")
	}
	if strings.Contains(readFile(t, filepath.Join(dir, "commands")), "start app-container") {
		t.Fatal("started damaged application")
	}
	if _, err := os.Stat(filepath.Join(recovery, "journal.json")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RESTORE_TEST_MODE", "success")
	if err := runner.recoverVolumeRestore(t.Context(), recovery); err != nil {
		t.Fatal(err)
	}
}

func TestCommittedRestoreDoesNotRollbackAfterRestart(t *testing.T) {
	runner, dir, recovery, _ := restoreRecoveryFixture(t, "success")
	if err := os.MkdirAll(recovery, 0700); err != nil {
		t.Fatal(err)
	}
	journal := restoreJournal{JobID: "test-job", RuntimeID: "dp_project", Phase: "committed", Containers: []string{"app-container"}, Volumes: []restoreJournalVolume{{Name: "dp_project_data", Backup: "volume-0.tar.gz"}}}
	if err := saveRestoreJournal(recovery, journal); err != nil {
		t.Fatal(err)
	}
	if err := runner.recoverVolumeRestore(t.Context(), recovery); err != nil {
		t.Fatal(err)
	}
	log := readFile(t, filepath.Join(dir, "commands"))
	if strings.Contains(log, "create --name") || !strings.Contains(log, "start app-container") {
		t.Fatalf("committed restore rolled back: %s", log)
	}
}

func TestUnrecoverableJournalBlocksJobClaim(t *testing.T) {
	runner, _, _, _ := restoreRecoveryFixture(t, "success")
	recovery := filepath.Join(runner.cfg.StateDir, "restores", "test-job", "recovery")
	if err := os.MkdirAll(recovery, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recovery, "journal.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runner.recoverInterruptedRestores(t.Context()); err == nil {
		t.Fatal("ignored damaged journal")
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; w.WriteHeader(500) }))
	defer server.Close()
	runner.cfg.BaseURL = server.URL
	runner.claimAndRunJob(t.Context())
	if requests != 0 {
		t.Fatal("contacted claim endpoint while recovery was blocked")
	}
}

func TestRestoreDisablesAndRestoresOriginalRestartPolicy(t *testing.T) {
	runner, dir, recovery, paths := restoreRecoveryFixture(t, "success")
	if err := runner.restoreVolumes(t.Context(), "test-job", "dp_project", []restoreArtifact{{ID: "archive", TargetVolume: "data"}}, paths, recovery); err != nil {
		t.Fatal(err)
	}
	log := readFile(t, filepath.Join(dir, "commands"))
	disabled := strings.Index(log, "update --restart=no app-container")
	stop := strings.Index(log, "stop app-container")
	replaced := strings.Index(log, "start --attach devpush-restore-test-job-0")
	restored := strings.Index(log, "update --restart=unless-stopped app-container")
	start := strings.LastIndex(log, "start app-container")
	if disabled < 0 || stop <= disabled || replaced <= stop || restored <= replaced || start <= restored {
		t.Fatalf("unsafe restart policy order: %s", log)
	}
}

func TestRestartRecoveryWithRealDocker(t *testing.T) {
	if os.Getenv("DEVPUSH_RUN_DOCKER_SMOKE") != "1" {
		t.Skip("set DEVPUSH_RUN_DOCKER_SMOKE=1 for isolated Docker recovery proof")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	state := workspaceTempDir(t, "restore-journal-docker-")
	name := "dp_journal_" + randomSuffix(t)
	helper := "devpush-restore-" + name + "-0"
	runner := NewRunner(Config{StateDir: state}, nil)
	command := func(args ...string) string {
		out, err := runner.commandOutput(ctx, "", "docker", args...)
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(out)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		for _, id := range []string{helper, name} {
			_, _ = runner.commandOutput(cleanup, "", "docker", "rm", "-f", id)
		}
		_, _ = runner.commandOutput(cleanup, "", "docker", "volume", "rm", "-f", name)
	})
	command("volume", "create", name)
	command("run", "--rm", "-v", name+":/data", volumeUtilityImage, "sh", "-c", "echo original > /data/value")
	command("run", "-d", "--name", name, "--restart=always", "-v", name+":/data", volumeUtilityImage, "sleep", "600")
	recovery := filepath.Join(state, "restores", name, "recovery")
	if err := os.MkdirAll(recovery, 0700); err != nil {
		t.Fatal(err)
	}
	journal := restoreJournal{JobID: name, RuntimeID: name, Phase: "stopping", Containers: []string{name}, RestartPolicies: map[string]restoreRestartPolicy{name: {Name: "always"}}}
	if err := saveRestoreJournal(recovery, journal); err != nil {
		t.Fatal(err)
	}
	command("update", "--restart=no", name)
	command("stop", name)
	backup := filepath.Join(recovery, "volume-0.tar.gz")
	if err := runner.writeVolumeBackup(ctx, name, backup); err != nil {
		t.Fatal(err)
	}
	if err := syncRestoreFile(backup); err != nil {
		t.Fatal(err)
	}
	journal.Phase = "replacing"
	journal.Volumes = []restoreJournalVolume{{Name: name, Backup: "volume-0.tar.gz"}}
	if err := saveRestoreJournal(recovery, journal); err != nil {
		t.Fatal(err)
	}
	command("run", "--rm", "-v", name+":/data", volumeUtilityImage, "sh", "-c", "echo partial > /data/value")
	command("run", "-d", "--name", helper, "-v", name+":/data", volumeUtilityImage, "sleep", "600")
	restarted := NewRunner(Config{StateDir: state}, nil)
	if err := restarted.recoverInterruptedRestores(ctx); err != nil {
		t.Fatal(err)
	}
	if got := command("exec", name, "cat", "/data/value"); got != "original" {
		t.Fatalf("partial restore survived: %s", got)
	}
	if got := command("inspect", "--format", "{{.State.Running}} {{.HostConfig.RestartPolicy.Name}}", name); got != "true always" {
		t.Fatalf("container state not recovered: %s", got)
	}
	if _, err := runner.commandOutput(ctx, "", "docker", "inspect", helper); err == nil {
		t.Fatal("orphan helper survived")
	}
}
