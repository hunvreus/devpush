package main

import (
	"encoding/json"
	"fmt"
	"io"
	"runtime"

	"github.com/devpush/devpush/agent/internal/agent"
)

type versionInfo struct {
	Version         string   `json:"version"`
	ProtocolVersion int      `json:"protocolVersion"`
	Capabilities    []string `json:"capabilities"`
	OS              string   `json:"os"`
	Arch            string   `json:"arch"`
}

func writeVersion(output io.Writer, structured bool) error {
	if !structured {
		_, err := fmt.Fprintf(output, "devpush-agent %s\n", agent.Version)
		return err
	}
	return json.NewEncoder(output).Encode(versionInfo{
		Version: agent.Version, ProtocolVersion: agent.ProtocolVersion,
		Capabilities: agent.Capabilities, OS: runtime.GOOS, Arch: runtime.GOARCH,
	})
}
