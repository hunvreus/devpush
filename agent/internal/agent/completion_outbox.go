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
	if err := runner.postCompletion(ctx, requestBody); err != nil {
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
		if err := runner.postCompletion(ctx, requestBody); err != nil {
			return err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove delivered completion: %w", err)
		}
	}

	return nil
}

func (runner *Runner) postCompletion(ctx context.Context, body []byte) error {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode completion: %w", err)
	}
	if envelope.Type == "deploy" {
		var completion jobCompletion
		if err := json.Unmarshal(body, &completion); err != nil {
			return fmt.Errorf("decode deployment completion: %w", err)
		}
		if completion.LogStartSeq < 1 {
			return errors.New("deployment completion requires a positive log sequence")
		}
		logs, events := completion.Logs, completion.Events
		logOffset, eventOffset := 0, 0
		for {
			_, chunk := deploymentLogBatch(logs, logOffset)
			eventEnd := deploymentEventBatchEnd(events, eventOffset)
			if logOffset+len(chunk) == len(logs) && eventEnd == len(events) {
				completion.LogStartSeq += logOffset
				completion.Logs = chunk
				completion.Events = append([]jobEvent{}, events[eventOffset:eventEnd]...)
				var err error
				body, err = json.Marshal(completion)
				if err != nil {
					return err
				}
				break
			}
			progress := jobProgress{
				ServerID: completion.ServerID, Token: completion.Token,
				DeploymentID: completion.DeploymentID,
				LogStartSeq:  completion.LogStartSeq + logOffset,
				Logs:         chunk, Events: append([]jobEvent{}, events[eventOffset:eventEnd]...),
			}
			if err := runner.reportProgress(ctx, progress); err != nil {
				return err
			}
			logOffset += len(chunk)
			eventOffset = eventEnd
		}
	}
	var response completeJobResponse
	if err := runner.postWithStatus(ctx, "/api/agents/jobs/complete", json.RawMessage(body), &response, 200); err != nil {
		return err
	}
	if !response.OK {
		return errors.New("control plane did not acknowledge completion")
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
