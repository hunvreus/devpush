package agent

import (
	"strings"
	"testing"
)

func TestBackupPathRejectsOutsideRoot(t *testing.T) {
	if _, err := backupPath("/etc/passwd", false); err == nil {
		t.Fatal("expected path outside backup root to be rejected")
	}
}

func TestWriteRcloneS3ConfigRejectsMultilineValues(t *testing.T) {
	_, err := writeRcloneS3Config(backupDestination{
		Bucket:          "backups",
		AccessKeyID:     "access\ntype = alias",
		SecretAccessKey: "secret",
	})
	if err == nil || !strings.Contains(err.Error(), "single line") {
		t.Fatalf("expected multiline config value to be rejected, got %v", err)
	}
}
