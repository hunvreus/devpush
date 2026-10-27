package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type restoreJournalVolume struct {
	Name   string
	Backup string
}
type restoreRestartPolicy struct {
	Name              string
	MaximumRetryCount int
}
type restoreJournal struct {
	JobID           string
	RuntimeID       string
	Phase           string
	Containers      []string
	RestartPolicies map[string]restoreRestartPolicy
	Volumes         []restoreJournalVolume
}

func syncRestoreFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func syncRestoreDirectory(path string) error { return syncRestoreFile(path) }
func saveRestoreJournal(dir string, journal restoreJournal) error {
	body, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".journal-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(body); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(name, filepath.Join(dir, "journal.json")); err != nil {
		return err
	}
	// Persist the complete directory chain: recovery, job, restores, state.
	// Syncing only recovery/job can lose the job entry itself after power loss.
	for current, depth := dir, 0; depth < 4; current, depth = filepath.Dir(current), depth+1 {
		if err := syncRestoreDirectory(current); err != nil {
			return err
		}
	}
	return nil
}

func (runner *Runner) recoverVolumeRestore(ctx context.Context, dir string) error {
	body, err := os.ReadFile(filepath.Join(dir, "journal.json"))
	if err != nil {
		return err
	}
	var journal restoreJournal
	if err := json.Unmarshal(body, &journal); err != nil {
		return err
	}
	if !jobLogID.MatchString(journal.JobID) || journal.RuntimeID == "" {
		return errors.New("invalid restore journal")
	}
	if journal.Phase != "stopping" && journal.Phase != "replacing" && journal.Phase != "committed" {
		return errors.New("invalid restore phase")
	}
	// First settle any application stop and kill all possible original/rollback
	// helpers. A daemon-side writer can outlive the agent process or CLI attach.
	if len(journal.Containers) > 0 {
		if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"stop"}, journal.Containers...)...); err != nil {
			return err
		}
	}
	for i := range journal.Volumes {
		for _, suffix := range []string{"", "-recovery"} {
			if err := runner.removeRestoreHelper(ctx, fmt.Sprintf("devpush-restore-%s-%d%s", journal.JobID, i, suffix)); err != nil {
				return fmt.Errorf("helper cleanup failed: %w", err)
			}
		}
	}
	if journal.Phase == "replacing" {
		// Verify every copy before touching any volume. Keep the journal until every
		// rollback and restart succeeds so recovery can be retried after another crash.
		for _, v := range journal.Volumes {
			if v.Name == "" || filepath.Base(v.Backup) != v.Backup {
				return errors.New("invalid recovery volume")
			}
			if _, err := os.Stat(filepath.Join(dir, v.Backup)); err != nil {
				return err
			}
		}
		for i, v := range journal.Volumes {
			if err := runner.replaceVolumeContents(ctx, v.Name, filepath.Join(dir, v.Backup), fmt.Sprintf("devpush-restore-%s-%d-recovery", journal.JobID, i)); err != nil {
				return fmt.Errorf("rollback failed: %w", err)
			}
		}
	}
	if journal.Phase == "replacing" {
		journal.Phase = "committed"
		if err := saveRestoreJournal(dir, journal); err != nil {
			return err
		}
	}
	for _, id := range journal.Containers {
		if policy, ok := journal.RestartPolicies[id]; ok {
			value := policy.Name
			if value == "on-failure" && policy.MaximumRetryCount > 0 {
				value += ":" + strconv.Itoa(policy.MaximumRetryCount)
			}
			if _, err := runner.commandOutput(ctx, "", "docker", "update", "--restart="+value, id); err != nil {
				return err
			}
		}
	}
	if err := runner.startContainers(ctx, journal.Containers); err != nil {
		return fmt.Errorf("restart failed: %w", err)
	}
	// Remove the journal durably before deleting copies. A crash during cleanup
	// must not leave a journal referring to already deleted rollback data.
	if err := os.Remove(filepath.Join(dir, "journal.json")); err != nil {
		return err
	}
	if err := syncRestoreDirectory(dir); err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

func (runner *Runner) recoverInterruptedRestores(ctx context.Context) error {
	if runner.cfg.StateDir == "" {
		return nil
	}
	root := filepath.Join(runner.cfg.StateDir, "restores")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name(), "recovery")
		if _, err := os.Stat(filepath.Join(dir, "journal.json")); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if err := runner.recoverVolumeRestore(ctx, dir); err != nil {
			return fmt.Errorf("recover restore %s: %w", entry.Name(), err)
		}
	}
	return nil
}
