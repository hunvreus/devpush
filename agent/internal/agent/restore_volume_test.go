package agent

import (
	"os"
	"path/filepath"
	"testing"
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
