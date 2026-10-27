package agent

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRestoreVolumeNamesRequireRuntimeOwnership(t *testing.T) {
	tempDir := workspaceTempDir(t, "agent-restore-volume-")
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "docker"), `#!/bin/sh
case "$*" in
 "volume ls -q --filter label=com.docker.compose.project=dp_project --filter label=com.docker.compose.volume=data") echo dp_project_data ;;
 "volume ls -q --filter label=com.docker.compose.project=dp_project") echo dp_project_data ;;
esac
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	runner := NewRunner(Config{}, nil)
	for _, target := range []string{"dp_project_data", "data"} {
		volume, err := runner.resolveRestoreVolume(t.Context(), "dp_project", target)
		if err != nil || volume != "dp_project_data" {
			t.Fatalf("target %s: volume=%s error=%v", target, volume, err)
		}
	}
	for _, target := range []string{"dp_other_data", "dp_project_unknown"} {
		if _, err := runner.resolveRestoreVolume(t.Context(), "dp_project", target); err == nil {
			t.Fatalf("accepted unowned volume %s", target)
		}
	}
}

func TestRestoreCancellationRecoversBeforeRestart(t *testing.T) {
	runner, dir, recovery, paths := restoreRecoveryFixture(t, "cancel")
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() {
		done <- runner.restoreVolumes(ctx, "test-job", "dp_project", []restoreArtifact{{ID: "archive", TargetVolume: "data"}}, paths, recovery)
	}()
	waitRestoreMarker(t, filepath.Join(dir, "replacing"))
	cancel()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "previous contents were restored") {
			t.Fatalf("unexpected result: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("cancelled restore did not recover")
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	stopped := strings.Index(string(log), "rm -f devpush-restore-test-job-0")
	rollback := strings.Index(string(log), "start --attach devpush-restore-test-job-0-recovery")
	restart := strings.Index(string(log), "start app-container")
	if stopped < 0 || rollback <= stopped || restart <= rollback {
		t.Fatalf("unsafe recovery order:\n%s", log)
	}
	if _, err := os.Stat(recovery); !os.IsNotExist(err) {
		t.Fatalf("successful recovery not cleaned: %v", err)
	}
}

func TestRestorePartialStopRestartsContainers(t *testing.T) {
	runner, dir, recovery, paths := restoreRecoveryFixture(t, "partial-stop")
	err := runner.restoreVolumes(t.Context(), "test-job", "dp_project", []restoreArtifact{{ID: "archive", TargetVolume: "data"}}, paths, recovery)
	if err == nil {
		t.Fatal("expected stop failure")
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	if !strings.Contains(string(log), "start app-container") || strings.Contains(string(log), "create --name") {
		t.Fatalf("partial stop did not restart safely:\n%s", log)
	}
}

func TestRestoreFailedRollbackKeepsCopiesAndApplicationStopped(t *testing.T) {
	runner, dir, recovery, paths := restoreRecoveryFixture(t, "rollback-fails")
	err := runner.restoreVolumes(t.Context(), "test-job", "dp_project", []restoreArtifact{{ID: "archive", TargetVolume: "data"}}, paths, recovery)
	if err == nil || !strings.Contains(err.Error(), recovery) {
		t.Fatalf("missing recovery location: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(recovery, "volume-0.tar.gz")); err != nil || string(data) != "original-volume" {
		t.Fatalf("lost recovery copy: %q %v", data, err)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	if strings.Contains(string(log), "start app-container") {
		t.Fatalf("restarted partially recovered application:\n%s", log)
	}
}

func TestRestoreUnstoppableWriterDoesNotRaceRollback(t *testing.T) {
	runner, dir, recovery, paths := restoreRecoveryFixture(t, "cleanup-fails")
	err := runner.restoreVolumes(t.Context(), "test-job", "dp_project", []restoreArtifact{{ID: "archive", TargetVolume: "data"}}, paths, recovery)
	if err == nil || !strings.Contains(err.Error(), "helper cleanup failed") {
		t.Fatalf("unexpected result: %v", err)
	}
	if _, err := os.Stat(filepath.Join(recovery, "volume-0.tar.gz")); err != nil {
		t.Fatal(err)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	if strings.Contains(string(log), "-0-recovery") || strings.Contains(string(log), "start app-container") {
		t.Fatalf("unsafe recovery with a live writer:\n%s", log)
	}
}

func TestRestoreAmbiguousCreateCleansHelper(t *testing.T) {
	runner, dir, _, paths := restoreRecoveryFixture(t, "create-fails")
	err := runner.replaceVolumeContents(t.Context(), "dp_project_data", paths["archive"], "devpush-restore-test-job-0")
	if err == nil {
		t.Fatal("expected create failure")
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	if !strings.Contains(string(log), "rm -f devpush-restore-test-job-0") || strings.Contains(string(log), "start --attach") {
		t.Fatalf("ambiguous helper not cleaned safely:\n%s", log)
	}
}

func TestRestorePreservesExistingJobDirectory(t *testing.T) {
	runner, dir, _, _ := restoreRecoveryFixture(t, "success")
	jobDir := filepath.Join(runner.cfg.StateDir, "restores", "test-job")
	if err := os.MkdirAll(jobDir, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(jobDir, "old-recovery")
	if err := os.WriteFile(marker, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	job := agentJob{ID: "test-job", Type: "restore"}
	job.Restore.RuntimeID = "dp_project"
	job.Restore.Artifacts = []restoreArtifact{{ID: "archive", Type: "volume"}}
	result := runner.runRestoreJob(t.Context(), job)
	if result.Status != "failed" || !strings.Contains(result.Message, "reserve restore directory") {
		t.Fatalf("unexpected completion: %+v", result)
	}
	if body, err := os.ReadFile(marker); err != nil || string(body) != "keep" {
		t.Fatalf("overwrote previous recovery: %q %v", body, err)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "commands"))
	if strings.Contains(string(log), "stop app-container") {
		t.Fatal("stopped application before reserving recovery directory")
	}
}

func restoreRecoveryFixture(t *testing.T, mode string) (*Runner, string, string, map[string]string) {
	t.Helper()
	dir := workspaceTempDir(t, "agent-restore-recovery-")
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	// All state is local fixture data. The fake Docker process models a daemon-side
	// writer surviving a cancelled attach, so removal must precede rollback.
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$RESTORE_TEST_DIR/commands"
case "$1" in
 version) exit 0 ;;
 inspect) echo '{"Name":"unless-stopped","MaximumRetryCount":0}'; exit 0 ;;
 update) exit 0 ;;
 ps) echo app-container; exit 0 ;;
 volume) echo dp_project_data; exit 0 ;;
 stop)
   if [ "$RESTORE_TEST_MODE" = partial-stop ] && [ ! -f "$RESTORE_TEST_DIR/stopped-once" ]; then touch "$RESTORE_TEST_DIR/stopped-once"; exit 1; fi
   exit 0 ;;
 run)
   for arg in "$@"; do
     case "$arg" in *:/backup) p="${arg%:/backup}"; printf original-volume > "$p/volume-0.tar.gz" ;; esac
   done
   exit 0 ;;
 create) [ "$RESTORE_TEST_MODE" != create-fails ]; exit $? ;;
 rm)
   if [ "$RESTORE_TEST_MODE" = cleanup-fails ]; then echo 'daemon unavailable' >&2; exit 1; fi
   exit 0 ;;
 start)
   if [ "$2" != --attach ]; then exit 0; fi
   case "$3" in
    *-recovery) [ "$RESTORE_TEST_MODE" != rollback-fails ]; exit $? ;;
   esac
   case "$RESTORE_TEST_MODE" in
    cancel) touch "$RESTORE_TEST_DIR/replacing"; while :; do sleep 0.05; done ;;
    rollback-fails|cleanup-fails) exit 1 ;;
   esac
   exit 0 ;;
esac
exit 1
`
	writeExecutable(t, filepath.Join(bin, "docker"), script)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("RESTORE_TEST_DIR", dir)
	t.Setenv("RESTORE_TEST_MODE", mode)
	artifact := filepath.Join(dir, "archive.tar.gz")
	if err := os.WriteFile(artifact, []byte("restored-volume"), 0600); err != nil {
		t.Fatal(err)
	}
	runner := NewRunner(Config{StateDir: filepath.Join(dir, "state")}, nil)
	return &runner, dir, filepath.Join(dir, "recovery"), map[string]string{"archive": artifact}
}

func waitRestoreMarker(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("restore never entered replacement")
}

func TestRestoreHelperDocker(t *testing.T) {
	if os.Getenv("DEVPUSH_RUN_DOCKER_TESTS") != "1" {
		t.Skip("set DEVPUSH_RUN_DOCKER_TESTS=1 for disposable Docker volume coverage")
	}
	runner := NewRunner(Config{}, nil)
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := runner.ensureDockerAvailable(ctx); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("devpush-restore-test-%d", time.Now().UnixNano())
	if _, err := runner.commandOutput(ctx, "", "docker", "volume", "create", "--label", "com.docker.compose.project="+name, "--label", "com.docker.compose.volume=data", name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, suffix := range []string{"-ok", "-cancel", "-invalid"} {
			_ = runner.removeRestoreHelper(cleanup, name+suffix)
		}
		if _, err := runner.commandOutput(cleanup, "", "docker", "volume", "rm", "-f", name); err != nil {
			t.Error(err)
		}
	})
	path := filepath.Join(workspaceTempDir(t, "agent-restore-docker-"), "archive.tar.gz")
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tarFile := tar.NewWriter(gz)
	body := []byte("restored-data")
	if err := tarFile.WriteHeader(&tar.Header{Name: "value", Mode: 0600, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarFile.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tarFile.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, archive.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runner.replaceVolumeContents(ctx, name, path, name+"-ok"); err != nil {
		t.Fatal(err)
	}
	read := func() string {
		output, err := runner.commandOutput(ctx, "", "docker", "run", "--rm", "-v", name+":/data:ro", volumeUtilityImage, "cat", "/data/value")
		if err != nil {
			t.Fatal(err)
		}
		return output
	}
	if got := read(); got != string(body) {
		t.Fatalf("unexpected volume data: %q", got)
	}
	cancelled, stop := context.WithCancel(ctx)
	stop()
	if err := runner.replaceVolumeContents(cancelled, name, path, name+"-cancel"); err == nil {
		t.Fatal("accepted cancelled replacement")
	}
	if got := read(); got != string(body) {
		t.Fatalf("cancelled helper changed volume data: %q", got)
	}
	if err := os.WriteFile(path, []byte("invalid gzip"), 0600); err != nil {
		t.Fatal(err)
	}
	recovery := filepath.Join(filepath.Dir(path), "recovery")
	err := runner.restoreVolumes(ctx, name, name, []restoreArtifact{{ID: "invalid", TargetVolume: name}}, map[string]string{"invalid": path}, recovery)
	if err == nil || !strings.Contains(err.Error(), "previous contents were restored") {
		t.Fatalf("failed restore did not roll back: %v", err)
	}
	if got := read(); got != string(body) {
		t.Fatalf("rollback did not recover original volume: %q", got)
	}
	if _, err := os.Stat(recovery); !os.IsNotExist(err) {
		t.Fatalf("successful rollback left recovery staging: %v", err)
	}
	if err := runner.replaceVolumeContents(ctx, name, path, name+"-invalid"); err == nil {
		t.Fatal("Docker helper exit failure was lost")
	}
	for _, suffix := range []string{"-ok", "-cancel", "-invalid"} {
		if _, err := runner.commandOutput(ctx, "", "docker", "container", "inspect", name+suffix); err == nil {
			t.Fatalf("helper leaked: %s", suffix)
		}
	}
}
