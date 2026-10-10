package agent

import (
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestDatabaseDumpCanBeReadAsGzipAndRestored(t *testing.T) {
	dir := t.TempDir()
	capture := filepath.Join(dir, "restored.sql")
	script := "#!/bin/sh\nif [ \"$2\" = version ]; then exit 0; fi\ncase \"$*\" in\n *dump-test*) printf 'CREATE TABLE example(id INTEGER); INSERT INTO example VALUES(42);' ;;\n *restore-test*) cat > \"$RESTORE_CAPTURE\" ;;\nesac\n"
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	t.Setenv("RESTORE_CAPTURE", capture)
	runner := NewRunner(Config{}, nil)
	path := filepath.Join(dir, "database.sql.gz")
	if err := runner.writeDatabaseDump(t.Context(), "runtime", "db", "dump-test", path); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	original, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.restoreDatabaseArtifact(t.Context(), "runtime", path, "db", "restore-test"); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	if string(original) != string(restored) || len(restored) == 0 {
		t.Fatalf("restored %q; wanted %q", restored, original)
	}
}
