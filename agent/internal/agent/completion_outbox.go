package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

const completionOutboxDir = "completion-outbox"

func (runner *Runner) deliverCompletion(ctx context.Context, id string, completion any) error {
	body, err := json.Marshal(completion)
	if err != nil {
		return fmt.Errorf("encode completion: %w", err)
	}

	persistedBody, err := completionWithoutCredential(body)
	if err != nil {
		return err
	}

	path, err := runner.persistCompletion(id, persistedBody)
	if err != nil {
		return err
	}

	requestBody, err := runner.completionWithCurrentCredential(persistedBody)
	if err != nil {
		return err
	}
	if err := runner.post(ctx, "/api/agents/jobs/complete", json.RawMessage(requestBody), &completeJobResponse{}); err != nil {
		return err
	}

	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove delivered completion: %w", err)
	}

	return nil
}

func (runner *Runner) flushPendingCompletions(ctx context.Context) error {
	dir := filepath.Join(runner.cfg.StateDir, completionOutboxDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read completion outbox: %w", err)
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		path := filepath.Join(dir, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read pending completion: %w", err)
		}

		requestBody, err := runner.completionWithCurrentCredential(body)
		if err != nil {
			return err
		}
		if err := runner.post(ctx, "/api/agents/jobs/complete", json.RawMessage(requestBody), &completeJobResponse{}); err != nil {
			return err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove delivered completion: %w", err)
		}
	}

	return nil
}

func (runner *Runner) persistCompletion(id string, body []byte) (string, error) {
	dir := filepath.Join(runner.cfg.StateDir, completionOutboxDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create completion outbox: %w", err)
	}

	digest := sha256.Sum256([]byte(id))
	path := filepath.Join(dir, hex.EncodeToString(digest[:])+".json")
	temp, err := os.CreateTemp(dir, ".completion-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create pending completion: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return "", fmt.Errorf("secure pending completion: %w", err)
	}
	if _, err := temp.Write(body); err != nil {
		temp.Close()
		return "", fmt.Errorf("write pending completion: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return "", fmt.Errorf("sync pending completion: %w", err)
	}
	if err := temp.Close(); err != nil {
		return "", fmt.Errorf("close pending completion: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return "", fmt.Errorf("commit pending completion: %w", err)
	}
	if err := syncDirectory(dir); err != nil {
		return "", err
	}

	return path, nil
}

func completionWithoutCredential(body []byte) ([]byte, error) {
	var completion map[string]any
	if err := json.Unmarshal(body, &completion); err != nil {
		return nil, fmt.Errorf("decode completion for persistence: %w", err)
	}
	delete(completion, "token")
	return json.Marshal(completion)
}

func (runner *Runner) completionWithCurrentCredential(body []byte) ([]byte, error) {
	var completion map[string]any
	if err := json.Unmarshal(body, &completion); err != nil {
		return nil, fmt.Errorf("decode pending completion: %w", err)
	}
	completion["token"] = runner.currentCredential()
	return json.Marshal(completion)
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open completion outbox: %w", err)
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("sync completion outbox: %w", err)
	}
	return nil
}
