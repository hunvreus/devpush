package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const readyFile = "maintenance-ready"

func writeAtomic(path string, body []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".maintenance-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(body)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if info, e := os.Stat(path); e == nil {
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			if err := os.Chown(f.Name(), int(stat.Uid), int(stat.Gid)); err != nil {
				return err
			}
		}
	}
	return os.Rename(f.Name(), path)
}

func service(ctx context.Context, action string) error {
	// Do not echo configuration or subprocess output that may include secrets.
	if err := exec.CommandContext(ctx, "systemctl", action, "devpush-agent").Run(); err != nil {
		return fmt.Errorf("agent service %s failed", action)
	}
	return nil
}

func waitReady(ctx context.Context, cfg Config) error {
	for {
		data, _ := os.ReadFile(filepath.Join(cfg.StateDir, readyFile))
		if strings.TrimSpace(string(data)) == cfg.BaseURL {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("agent did not confirm destination heartbeat")
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func Update(ctx context.Context, cfg Config, candidate string) error {
	if candidate == "" {
		return errors.New("--binary is required (provide a checksum-verified binary)")
	}
	path, err := os.Executable()
	if err != nil {
		return err
	}
	return applyUpdate(ctx, cfg, path, candidate, service, waitReady)
}

func applyUpdate(ctx context.Context, cfg Config, path, candidate string,
	service func(context.Context, string) error, waitReady func(context.Context, Config) error,
) error {
	original, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	replacement, err := os.ReadFile(candidate)
	if err != nil {
		return err
	}
	if bytes.Equal(original, replacement) {
		maintenanceProgress(ctx, "Agent binary is already current; no restart needed.")
		return nil
	}
	if len(replacement) == 0 {
		return errors.New("replacement binary is empty")
	}
	if err := Drain(ctx, cfg); err != nil {
		return err
	}
	defer Resume(cfg)
	maintenanceProgress(ctx, "Stopping the drained agent; deployed containers remain running.")
	if err := service(ctx, "stop"); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(cfg.StateDir, readyFile))
	if err := writeAtomic(path, replacement, 0755); err != nil {
		_ = service(context.Background(), "start")
		return err
	}
	maintenanceProgress(ctx, "Binary replaced. Starting agent and waiting for a connected heartbeat...")
	err = service(ctx, "start")
	if err == nil {
		readyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err = waitReady(readyCtx, cfg)
		cancel()
	}
	if err != nil {
		maintenanceProgress(ctx, "Update failed. Restoring the previous binary...")
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = service(rollbackCtx, "stop")
		if restoreErr := writeAtomic(path, original, 0755); restoreErr != nil {
			return fmt.Errorf("update failed and binary rollback failed: %w", restoreErr)
		}
		if restartErr := service(rollbackCtx, "start"); restartErr != nil {
			return fmt.Errorf("binary restored but restart failed: %w", restartErr)
		}
		return fmt.Errorf("update failed; restored previous binary: %w", err)
	}
	maintenanceProgress(ctx, "Agent reconnected. Job claiming resumed; update complete.")
	return nil
}

func switchConfig(original []byte, cfg Config) []byte {
	replacements := map[string]string{"DEVPUSH_BASE_URL": cfg.BaseURL, "DEVPUSH_AGENT_TOKEN": cfg.Token, "DEVPUSH_STATE_DIR": cfg.StateDir}
	lines := strings.Split(string(original), "\n")
	kept := []string{}
	for _, line := range lines {
		key, _, _ := strings.Cut(line, "=")
		if _, found := replacements[strings.TrimSpace(key)]; !found {
			kept = append(kept, line)
		}
	}
	for _, key := range []string{"DEVPUSH_BASE_URL", "DEVPUSH_AGENT_TOKEN", "DEVPUSH_STATE_DIR"} {
		kept = append(kept, key+"=\""+replacements[key]+"\"")
	}
	return []byte(strings.Join(kept, "\n") + "\n")
}

func SwitchControlPlane(ctx context.Context, cfg Config, configPath, destination, tokenPath string) (result error) {
	return applySwitch(ctx, cfg, configPath, destination, tokenPath, func(config Config) *Runner {
		runner := NewRunner(config, nil)
		return &runner
	}, service, waitReady)
}

func applySwitch(ctx context.Context, cfg Config, configPath, destination, tokenPath string,
	runnerFactory func(Config) *Runner, service func(context.Context, string) error, waitReady func(context.Context, Config) error,
) (result error) {
	parsed, err := url.Parse(destination)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("--url must be an HTTPS origin")
	}
	destination = strings.TrimRight(destination, "/")
	if destination == strings.TrimRight(cfg.BaseURL, "/") {
		return errors.New("destination is already selected")
	}
	tokenBytes, err := os.ReadFile(tokenPath)
	if err != nil {
		return err
	}
	token := strings.TrimSpace(string(tokenBytes))
	if !strings.HasPrefix(token, "dps_") || strings.ContainsAny(token, "\"\r\n ") {
		return errors.New("provide a destination enrollment token in --token-file")
	}
	if err := Drain(ctx, cfg); err != nil {
		return err
	}
	defer Resume(cfg)
	source := runnerFactory(cfg)
	if err := source.loadCredential(); err != nil {
		return err
	}
	id, err := source.register(ctx)
	if err != nil {
		return err
	}
	source.cfg.AgentID = id
	// Historical deployment files or containers cannot be adopted implicitly.
	entries, err := os.ReadDir(filepath.Join(cfg.StateDir, "deployments"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(entries) > 0 {
		return errors.New("server has deployment state; switching active servers is unsupported")
	}
	runtimes, err := source.listComposeRuntimeStates(ctx)
	if err != nil {
		return err
	}
	if len(runtimes) > 0 {
		return errors.New("server has Compose containers; switching active servers is unsupported")
	}
	original, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(cfg.StateDir)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(destination))
	next := cfg
	next.BaseURL = destination
	next.Token = token
	next.AgentID = ""
	next.StateDir = cfg.StateDir + "-" + hex.EncodeToString(digest[:8])
	if err := os.Mkdir(next.StateDir, 0750); err != nil {
		return fmt.Errorf("destination state directory must be new: %w", err)
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		if err := os.Chown(next.StateDir, int(stat.Uid), int(stat.Gid)); err != nil {
			return err
		}
	}
	target := runnerFactory(next)
	targetID, err := target.register(ctx)
	if err != nil {
		return err
	}
	next.AgentID = targetID
	next.Token = target.currentCredential()
	var heartbeat agentResponse
	if err := target.post(ctx, "/api/agents/heartbeat", agentRequest{ServerID: targetID, Token: next.Token, AgentVersion: Version, ProtocolVersion: ProtocolVersion, Capabilities: Capabilities}, &heartbeat); err != nil {
		return err
	}
	if heartbeat.Status != "connected" {
		return errors.New("destination did not confirm connection")
	}
	var paused struct {
		Ticket string `json:"ticket"`
	}
	if err := source.post(ctx, "/api/agents/switch", map[string]string{"serverId": id, "token": source.currentCredential(), "action": "prepare"}, &paused); err != nil {
		return err
	}
	// Preserve all rollback inputs before changing the selected configuration.
	recovery := configPath + ".switch-backup"
	if err := writeAtomic(recovery, original, 0600); err != nil {
		_ = source.post(ctx, "/api/agents/switch", map[string]string{"serverId": id, "token": source.currentCredential(), "action": "rollback", "ticket": paused.Ticket}, &heartbeat)
		return err
	}
	recoveryState, err := json.Marshal(map[string]string{"serverId": id, "ticket": paused.Ticket, "sourceStateDir": cfg.StateDir, "destinationStateDir": next.StateDir})
	if err == nil {
		err = writeAtomic(recovery+".json", recoveryState, 0600)
	}
	if err != nil {
		_ = source.post(ctx, "/api/agents/switch", map[string]string{"serverId": id, "token": source.currentCredential(), "action": "rollback", "ticket": paused.Ticket}, &heartbeat)
		return err
	}
	selected := false
	defer func() {
		if result == nil {
			return
		}
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if selected {
			_ = service(rollbackCtx, "stop")
		}
		restoreErr := source.post(rollbackCtx, "/api/agents/switch", map[string]string{"serverId": id, "token": source.currentCredential(), "action": "rollback", "ticket": paused.Ticket}, &heartbeat)
		if selected {
			if err := writeAtomic(configPath, original, 0640); err != nil {
				result = fmt.Errorf("switch failed; config rollback failed: %w", err)
				return
			}
			_ = Resume(cfg)
			if err := service(rollbackCtx, "start"); err != nil {
				result = fmt.Errorf("switch failed; source restart failed: %w", err)
				return
			}
		}
		if restoreErr != nil {
			result = fmt.Errorf("switch failed; source rollback failed: %w", restoreErr)
		}
	}()
	if err := service(ctx, "stop"); err != nil {
		return err
	}
	selected = true
	if err := writeAtomic(configPath, switchConfig(original, next), 0640); err != nil {
		return err
	}
	if err := service(ctx, "start"); err != nil {
		return err
	}
	readyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := waitReady(readyCtx, next); err != nil {
		return err
	}
	return nil
}
