package agent

import (
	"context"
	"encoding/json"
	"fmt"
)

// Persist a failure before execution. Normal completion atomically replaces it;
// after a crash the existing outbox reports interruption before any new claim.
// Store identities only, never the job payload or its credentials.
func (runner *Runner) interruptedCompletion(job agentJob) ([]byte, error) {
	const message = "Agent stopped before reporting job completion. Inspect the runtime before retrying."
	body := map[string]any{"serverId": runner.cfg.AgentID, "type": job.Type, "jobId": job.ID, "status": "failed", "message": message}
	switch job.Type {
	case "", "deploy":
		seq := job.LogStartSeq
		if seq < 1 {
			seq = 1
		}
		body["type"] = "deploy"
		body["deploymentId"] = job.ID
		body["gitSha"] = nil
		body["logStartSeq"] = seq
		body["logs"] = []string{}
		body["events"] = []jobEvent{{Phase: "completed", Message: message}}
		delete(body, "jobId")
		delete(body, "message")
	case "backup":
		body["backupRunId"] = job.Backup.BackupRunID
	case "backup_cleanup":
		body["backupRunIds"] = job.Cleanup.BackupRunIDs
	case "deprovision", "purge":
		body["attempt"] = job.Attempt
	case "restore":
	default:
		return nil, fmt.Errorf("cannot recover unsupported job type %q", job.Type)
	}
	return json.Marshal(body)
}

func (runner *Runner) prepareInterruptedCompletion(job agentJob) error {
	encoded, err := runner.interruptedCompletion(job)
	if err != nil {
		return err
	}
	_, err = runner.persistCompletion(job.ID, encoded)
	return err
}

// A failed disk write must not leave unstarted work marked running if the hub is reachable.
func (runner *Runner) reportUnstartedJob(ctx context.Context, job agentJob) error {
	body, err := runner.interruptedCompletion(job)
	if err != nil {
		return err
	}
	body, err = runner.completionWithCurrentCredential(body)
	if err != nil {
		return err
	}
	return runner.postCompletion(ctx, body)
}
