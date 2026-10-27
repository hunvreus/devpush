package main

import (
	"bytes"
	"encoding/json"
	"io"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/devpush/devpush/agent/internal/agent"
)

func TestVersionOutput(t *testing.T) {
	var output bytes.Buffer
	if err := writeVersion(&output, false); err != nil {
		t.Fatal(err)
	}
	if output.String() != "devpush-agent "+agent.Version+"\n" {
		t.Fatalf("unexpected version: %q", output.String())
	}
	output.Reset()
	if err := writeVersion(&output, true); err != nil {
		t.Fatal(err)
	}
	var info versionInfo
	if err := json.Unmarshal(output.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Version != agent.Version || info.ProtocolVersion != agent.ProtocolVersion || !slices.Equal(info.Capabilities, agent.Capabilities) || info.OS != runtime.GOOS || info.Arch != runtime.GOARCH {
		t.Fatalf("metadata does not describe the running binary: %+v", info)
	}
	if !strings.Contains(output.String(), "ingress.certificates.v1") {
		t.Fatal("shared certificate capability missing")
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func TestVersionWriteFailure(t *testing.T) {
	for _, structured := range []bool{false, true} {
		if err := writeVersion(failingWriter{}, structured); err != io.ErrClosedPipe {
			t.Fatalf("write error not returned: %v", err)
		}
	}
}
