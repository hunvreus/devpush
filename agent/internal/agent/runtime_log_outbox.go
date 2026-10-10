package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const runtimeLogOutboxDir = "runtime-log-outbox"

type runtimeLogState struct {
	ServerID     string           `json:"serverId"`
	RuntimeID    string           `json:"runtimeId"`
	Since        time.Time        `json:"since"`
	PendingUntil time.Time        `json:"pendingUntil"`
	Logs         []runtimeLogLine `json:"logs"`
}

func (runner *Runner) runtimeLogStatePath(runtimeID string) string {
	digest := sha256.Sum256([]byte(runner.cfg.AgentID + "\x00" + runtimeID))
	return filepath.Join(runner.cfg.StateDir, runtimeLogOutboxDir, hex.EncodeToString(digest[:])+".json")
}

func (runner *Runner) loadRuntimeLogState(runtimeID string) (runtimeLogState, error) {
	state := runtimeLogState{ServerID: runner.cfg.AgentID, RuntimeID: runtimeID}
	body, err := os.ReadFile(runner.runtimeLogStatePath(runtimeID))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(body, &state); err != nil {
		return state, err
	}
	if state.ServerID != runner.cfg.AgentID || state.RuntimeID != runtimeID {
		return state, errors.New("runtime log outbox identity mismatch")
	}
	return state, nil
}

func (runner *Runner) saveRuntimeLogState(state runtimeLogState) error {
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}
	path := runner.runtimeLogStatePath(state.RuntimeID)
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var total, previous int64
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if entry.Name() == filepath.Base(path) {
			previous = info.Size()
		}
	}
	limit := runner.cfg.RuntimeLogQueueBytes
	if limit == 0 {
		limit = 128 << 20
	}
	if int64(len(body)) > previous && total-previous+int64(len(body)) > limit {
		return fmt.Errorf("runtime log queue is full (%d byte limit); collection paused without advancing cursor", limit)
	}
	file, err := os.CreateTemp(dir, ".runtime-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0o600); err != nil {
		return err
	}
	if _, err := file.Write(body); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	return syncDirectory(dir)
}
