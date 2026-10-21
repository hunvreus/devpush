package agent

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedGitDiagnosticsDoNotExposeCredentials(t *testing.T) {
	dir := t.TempDir()
	token := "test-private-github-credential"
	encoded := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	script := "#!/bin/sh\nif [ -n \"${GIT_TRACE-}${GIT_TRACE_CURL-}${GIT_CURL_VERBOSE-}\" ]; then echo tracing-enabled; fi\nprintf '%s\\n' \"$GIT_CONFIG_VALUE_0\" '" + token + "'\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "git"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("GIT_TRACE", "1")
	t.Setenv("GIT_TRACE_CURL", filepath.Join(dir, "trace"))
	t.Setenv("GIT_CURL_VERBOSE", "1")
	runner := NewRunner(Config{}, nil)
	logs := []string{}
	err := runner.runCommandWithEnv(context.Background(), dir, &logs, runner.gitAuthEnv(repo{Token: token}), "git", "fetch")
	if err == nil {
		t.Fatal("expected fake Git failure")
	}
	output := strings.Join(logs, "\n") + err.Error()
	for _, private := range []string{token, encoded, "tracing-enabled"} {
		if strings.Contains(output, private) {
			t.Fatal("Git diagnostics exposed a credential or enabled tracing")
		}
	}
	if !strings.Contains(output, "AUTHORIZATION: basic ***") {
		t.Fatal("expected redacted authorization diagnostic")
	}
}

func TestRedactToken(t *testing.T) {
	for _, test := range []struct {
		name, input, want string
	}{
		{"plain", "ordinary output", "ordinary output"},
		{"single", "https://x-access-token:secret@github.com/a", "https://x-access-token:***@github.com/a"},
		{"multiple", "https://x-access-token:first@github.com/a https://x-access-token:second@github.com/b", "https://x-access-token:***@github.com/a https://x-access-token:***@github.com/b"},
		{"truncated", "https://x-access-token:secret", "https://x-access-token:***"},
		{"truncated second", "x-access-token:first@github.com/a x-access-token:second", "x-access-token:***@github.com/a x-access-token:***"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := redactToken(test.input); got != test.want {
				t.Fatalf("redaction mismatch: got %q, want %q", got, test.want)
			}
		})
	}
}
