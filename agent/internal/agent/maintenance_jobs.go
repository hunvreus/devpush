package agent

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const restoreRecoveryTimeout = 10 * time.Minute

const volumeUtilityImage = "alpine@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6"

func (runner *Runner) runBackupJob(ctx context.Context, job agentJob) (result backupJobCompletion) {
	ctx, finishLog := runner.beginJobLog(ctx, job)
	defer func() { finishLog(result.Status, result.Message) }()
	status := "succeeded"
	message := ""
	localBasePath := ""
	manifest := map[string]any{
		"schemaVersion": 1,
		"backupRunId":   job.Backup.BackupRunID,
		"runtimeId":     job.Backup.RuntimeID,
		"createdAt":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	artifacts := []backupArtifact{}

	fail := func(err error) backupJobCompletion {
		if localBasePath != "" {
			_ = os.RemoveAll(localBasePath)
		}
		status = "failed"
		message = err.Error()
		return backupJobCompletion{
			ServerID:    runner.cfg.AgentID,
			Token:       runner.currentCredential(),
			Type:        "backup",
			JobID:       job.ID,
			BackupRunID: job.Backup.BackupRunID,
			Status:      status,
			Message:     message,
			Manifest:    manifest,
			Artifacts:   artifacts,
		}
	}

	if strings.TrimSpace(job.Backup.BackupRunID) == "" {
		return fail(errors.New("backup run id is required"))
	}
	if strings.TrimSpace(job.Backup.RuntimeID) == "" {
		return fail(errors.New("backup runtime id is required"))
	}
	if strings.TrimSpace(job.Backup.LocalBasePath) == "" {
		return fail(errors.New("backup local base path is required"))
	}

	if err := runner.ensureDockerAvailable(ctx); err != nil {
		return fail(err)
	}
	preparedPath, err := prepareBackupDirectory(job.Backup.LocalBasePath)
	if err != nil {
		return fail(fmt.Errorf("create backup directory: %w", err))
	}
	localBasePath = preparedPath
	job.Backup.LocalBasePath = localBasePath

	manifestPath := filepath.Join(job.Backup.LocalBasePath, "manifest.json")
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fail(err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0o640); err != nil {
		return fail(fmt.Errorf("write backup manifest: %w", err))
	}
	artifact, err := fileArtifact(manifestPath, "manifest", "local", manifestPath)
	if err != nil {
		return fail(err)
	}
	artifacts = append(artifacts, artifact)

	for index, dump := range job.Backup.DatabaseDumps {
		writeJobProgress(ctx, fmt.Sprintf("Backing up database service %s.", dump.Service))
		service := sanitizeArtifactName(dump.Service)
		if service == "" || strings.TrimSpace(dump.Command) == "" {
			return fail(fmt.Errorf("database dump %d must include service and command", index+1))
		}
		extension := "sql"
		if dump.Format == "archive" {
			extension = "archive"
		}
		path := filepath.Join(job.Backup.LocalBasePath, "databases", fmt.Sprintf("%02d-%s.%s.gz", index+1, service, extension))
		if err := runner.writeDatabaseDump(ctx, job.Backup.RuntimeID, dump.Service, dump.Command, path); err != nil {
			return fail(err)
		}
		artifact, err := fileArtifact(path, "database", "local", path)
		if err != nil {
			return fail(err)
		}
		artifacts = append(artifacts, artifact)
	}

	volumeNames, err := runner.backupVolumeNames(ctx, job.Backup.RuntimeID, job.Backup.Volumes)
	if err != nil {
		return fail(err)
	}
	for _, volumeName := range volumeNames {
		writeJobProgress(ctx, fmt.Sprintf("Archiving volume %s.", volumeName))
		path := filepath.Join(job.Backup.LocalBasePath, "volumes", sanitizeArtifactName(volumeName)+".tar.gz")
		if err := runner.writeVolumeBackup(ctx, volumeName, path); err != nil {
			return fail(err)
		}
		artifact, err := fileArtifact(path, "volume", "local", path)
		if err != nil {
			return fail(err)
		}
		artifacts = append(artifacts, artifact)
	}

	writeJobProgress(ctx, "Local backup files are complete.")
	return runner.uploadCompletedBackup(ctx, job, manifest, artifacts)
}

func (runner *Runner) uploadCompletedBackup(ctx context.Context, job agentJob, manifest map[string]any, artifacts []backupArtifact) backupJobCompletion {
	if job.Backup.Retention.Remote.Enabled {
		writeJobProgress(ctx, "Uploading backup files to remote storage.")
		remoteArtifacts, err := runner.uploadBackupArtifacts(ctx, job.Backup, artifacts)
		if err != nil {
			// Upload failure must not destroy the complete local backup.
			manifest["localRecoveryAvailable"] = true
			return backupJobCompletion{
				ServerID: runner.cfg.AgentID, Token: runner.currentCredential(),
				Type: "backup", JobID: job.ID, BackupRunID: job.Backup.BackupRunID,
				Status: "failed", Message: "Remote upload failed. " + err.Error(),
				Manifest: manifest, Artifacts: artifacts,
			}
		}
		artifacts = append(artifacts, remoteArtifacts...)
	}

	return backupJobCompletion{
		ServerID:    runner.cfg.AgentID,
		Token:       runner.currentCredential(),
		Type:        "backup",
		JobID:       job.ID,
		BackupRunID: job.Backup.BackupRunID,
		Status:      "succeeded",
		Message:     "",
		Manifest:    manifest,
		Artifacts:   artifacts,
	}
}

func (runner *Runner) runBackupCleanupJob(ctx context.Context, job agentJob) backupCleanupJobCompletion {
	status := "succeeded"
	message := ""

	fail := func(err error) backupCleanupJobCompletion {
		status = "failed"
		message = err.Error()
		return backupCleanupJobCompletion{
			ServerID:     runner.cfg.AgentID,
			Token:        runner.currentCredential(),
			Type:         "backup_cleanup",
			JobID:        job.ID,
			BackupRunIDs: job.Cleanup.BackupRunIDs,
			Status:       status,
			Message:      message,
		}
	}

	for _, key := range job.Cleanup.LocalObjectKeys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		path, err := existingBackupArtifactPath(key)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fail(fmt.Errorf("resolve local backup artifact %s: %w", key, err))
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fail(fmt.Errorf("remove local backup artifact %s: %w", path, err))
		}
		pruneEmptyBackupDirectories(filepath.Dir(path))
	}

	if len(job.Cleanup.RemoteObjectKeys) > 0 {
		if err := runner.ensureRcloneAvailable(ctx); err != nil {
			return fail(err)
		}
		for _, key := range job.Cleanup.RemoteObjectKeys {
			if err := runner.deleteRemoteBackupArtifact(ctx, job.Cleanup.Destination, key); err != nil {
				return fail(err)
			}
		}
	}

	return backupCleanupJobCompletion{
		ServerID:     runner.cfg.AgentID,
		Token:        runner.currentCredential(),
		Type:         "backup_cleanup",
		JobID:        job.ID,
		BackupRunIDs: job.Cleanup.BackupRunIDs,
		Status:       status,
		Message:      message,
	}
}

func (runner *Runner) runRestoreJob(ctx context.Context, job agentJob) (result restoreJobCompletion) {
	ctx, finishLog := runner.beginJobLog(ctx, job)
	defer func() { finishLog(result.Status, result.Message) }()
	status := "succeeded"
	message := ""

	fail := func(err error) restoreJobCompletion {
		status = "failed"
		message = err.Error()
		return restoreJobCompletion{
			ServerID: runner.cfg.AgentID,
			Token:    runner.currentCredential(),
			Type:     "restore",
			JobID:    job.ID,
			Status:   status,
			Message:  message,
		}
	}

	if strings.TrimSpace(job.Restore.RuntimeID) == "" {
		return fail(errors.New("restore runtime id is required"))
	}
	if len(job.Restore.Artifacts) == 0 {
		return fail(errors.New("restore artifacts are required"))
	}
	if err := runner.ensureDockerAvailable(ctx); err != nil {
		return fail(err)
	}

	if !jobLogID.MatchString(job.ID) || runner.cfg.StateDir == "" {
		return fail(errors.New("restore requires a valid job id and agent state directory"))
	}
	restoreRoot := filepath.Join(runner.cfg.StateDir, "restores")
	if err := os.MkdirAll(restoreRoot, 0700); err != nil {
		return fail(err)
	}
	jobDir := filepath.Join(restoreRoot, job.ID)
	// Never overwrite recovery data retained by an earlier interrupted attempt.
	if err := os.Mkdir(jobDir, 0700); err != nil {
		return fail(fmt.Errorf("reserve restore directory %s: %w", jobDir, err))
	}
	defer func() { _ = os.Remove(jobDir) }() // Only remove an empty job directory.
	workdir := filepath.Join(jobDir, "artifacts")
	if err := os.Mkdir(workdir, 0700); err != nil {
		return fail(err)
	}
	defer os.RemoveAll(workdir)

	localPaths := map[string]string{}
	for _, artifact := range job.Restore.Artifacts {
		writeJobProgress(ctx, fmt.Sprintf("Reading %s backup from %s storage.", artifact.Type, artifact.Storage))
		path, err := runner.restoreArtifactPath(ctx, job.Restore.Destination, artifact, workdir)
		if err != nil {
			return fail(err)
		}
		writeJobProgress(ctx, "Verifying backup checksum.")
		if err := verifyFileSHA256(path, artifact.ChecksumSHA256); err != nil {
			return fail(fmt.Errorf("verify restore artifact %s: %w", artifact.ID, err))
		}
		localPaths[artifact.ID] = path
	}

	volumeArtifacts := []restoreArtifact{}
	databaseArtifacts := []restoreArtifact{}
	for _, artifact := range job.Restore.Artifacts {
		switch artifact.Type {
		case "volume":
			volumeArtifacts = append(volumeArtifacts, artifact)
		case "database":
			databaseArtifacts = append(databaseArtifacts, artifact)
		default:
			return fail(fmt.Errorf("unsupported restore artifact type %q", artifact.Type))
		}
	}

	if len(volumeArtifacts) > 0 {
		if err := runner.restoreVolumes(ctx, job.ID, job.Restore.RuntimeID, volumeArtifacts, localPaths, filepath.Join(jobDir, "recovery")); err != nil {
			return fail(err)
		}
	}

	for _, artifact := range databaseArtifacts {
		if err := runner.restoreDatabaseArtifact(ctx, job.Restore.RuntimeID, localPaths[artifact.ID], artifact.TargetService, artifact.RestoreCommand); err != nil {
			return fail(err)
		}
	}

	return restoreJobCompletion{
		ServerID: runner.cfg.AgentID,
		Token:    runner.currentCredential(),
		Type:     "restore",
		JobID:    job.ID,
		Status:   status,
		Message:  message,
	}
}

func (runner *Runner) restoreArtifactPath(ctx context.Context, destination backupDestination, artifact restoreArtifact, workdir string) (string, error) {
	if artifact.Storage == "local" {
		path, err := existingBackupArtifactPath(artifact.ObjectKey)
		if err != nil {
			return "", fmt.Errorf("resolve local restore artifact: %w", err)
		}
		return path, nil
	}

	if artifact.Storage != "remote" {
		return "", fmt.Errorf("unsupported restore artifact storage %q", artifact.Storage)
	}

	if err := runner.ensureRcloneAvailable(ctx); err != nil {
		return "", err
	}

	path := filepath.Join(workdir, sanitizeArtifactName(artifact.ID)+"-"+filepath.Base(artifact.ObjectKey))
	if err := runner.downloadRemoteBackupArtifact(ctx, destination, artifact.ObjectKey, path); err != nil {
		return "", err
	}

	return path, nil
}

func (runner *Runner) startContainers(ctx context.Context, containerIDs []string) error {
	writeJobProgress(ctx, "Starting application containers.")
	if len(containerIDs) == 0 {
		return nil
	}
	if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"start"}, containerIDs...)...); err != nil {
		return err
	}
	return nil
}

// Journal before stopping containers and before any destructive writes. Recovery is
// repeatable across process restarts; unresolved journals block subsequent claims.
func (runner *Runner) restoreVolumes(ctx context.Context, jobID, runtimeID string, artifacts []restoreArtifact, localPaths map[string]string, recoveryDir string) (result error) {
	if err := os.Mkdir(recoveryDir, 0700); err != nil {
		return err
	}
	journalSaved := false
	defer func() {
		if !journalSaved {
			_ = os.RemoveAll(recoveryDir)
		}
	}()
	journal := restoreJournal{JobID: jobID, RuntimeID: runtimeID, Phase: "stopping"}
	containerIDs, err := runner.dockerIDsByLabel(ctx, "ps", "-q", "--filter", "label=com.docker.compose.project="+runtimeID)
	if err != nil {
		_ = os.RemoveAll(recoveryDir)
		return err
	}
	journal.Containers = containerIDs
	journal.RestartPolicies = map[string]restoreRestartPolicy{}
	for _, id := range containerIDs {
		body, err := runner.commandOutput(ctx, "", "docker", "inspect", "--format", "{{json .HostConfig.RestartPolicy}}", id)
		if err != nil {
			return err
		}
		var policy restoreRestartPolicy
		if err := json.Unmarshal([]byte(body), &policy); err != nil {
			return err
		}
		switch policy.Name {
		case "", "no":
			policy.Name = "no"
		case "always", "unless-stopped", "on-failure":
		default:
			return errors.New("unsupported container restart policy")
		}
		journal.RestartPolicies[id] = policy
	}
	if err := saveRestoreJournal(recoveryDir, journal); err != nil {
		return err
	}
	journalSaved = true
	defer func() {
		recoveryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restoreRecoveryTimeout)
		defer cancel()
		if err := runner.recoverVolumeRestore(recoveryCtx, recoveryDir); err != nil {
			result = fmt.Errorf("restore/recovery failed: %w; recovery data retained at %s; application must remain stopped", errors.Join(result, err), recoveryDir)
		} else if result != nil && journal.Phase == "replacing" {
			result = fmt.Errorf("%w; previous contents were restored", result)
		}
	}()
	// Disable daemon auto-restarts before destructive work. The original policies
	// are durable already, so a reboot cannot start partially restored volumes.
	for _, id := range containerIDs {
		if _, err := runner.commandOutput(ctx, "", "docker", "update", "--restart=no", id); err != nil {
			return err
		}
	}
	writeJobProgress(ctx, "Stopping application containers for volume restoration.")
	if len(containerIDs) > 0 {
		if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"stop"}, containerIDs...)...); err != nil {
			return err
		}
	}
	prepared := make([]preparedVolumeRestore, 0, len(artifacts))
	seen := map[string]bool{}
	for index, artifact := range artifacts {
		restore, err := runner.prepareVolumeRestore(ctx, runtimeID, localPaths[artifact.ID], artifact.TargetVolume, recoveryDir, index)
		if err != nil {
			return err
		}
		if seen[restore.volumeName] {
			return fmt.Errorf("duplicate restore target volume %s", restore.volumeName)
		}
		seen[restore.volumeName] = true
		if err := syncRestoreFile(restore.recoveryPath); err != nil {
			return err
		}
		prepared = append(prepared, restore)
		journal.Volumes = append(journal.Volumes, restoreJournalVolume{Name: restore.volumeName, Backup: filepath.Base(restore.recoveryPath)})
	}
	journal.Phase = "replacing"
	if err := saveRestoreJournal(recoveryDir, journal); err != nil {
		return err
	}
	for index, restore := range prepared {
		if err := runner.replaceVolumeContents(ctx, restore.volumeName, restore.artifactPath, fmt.Sprintf("devpush-restore-%s-%d", jobID, index)); err != nil {
			return err
		}
	}
	journal.Phase = "committed"
	if err := saveRestoreJournal(recoveryDir, journal); err != nil {
		return err
	}
	return nil
}

type preparedVolumeRestore struct {
	artifactPath string
	recoveryPath string
	targetVolume string
	volumeName   string
}

func (runner *Runner) prepareVolumeRestore(ctx context.Context, runtimeID string, artifactPath string, targetVolume string, recoveryDir string, index int) (preparedVolumeRestore, error) {
	if strings.TrimSpace(targetVolume) == "" {
		return preparedVolumeRestore{}, errors.New("target volume is required")
	}
	volumeName, err := runner.resolveRestoreVolume(ctx, runtimeID, targetVolume)
	if err != nil {
		return preparedVolumeRestore{}, err
	}
	if _, err := os.Stat(artifactPath); err != nil {
		return preparedVolumeRestore{}, err
	}
	recoveryPath := filepath.Join(recoveryDir, fmt.Sprintf("volume-%d.tar.gz", index))
	if err := runner.writeVolumeBackup(ctx, volumeName, recoveryPath); err != nil {
		return preparedVolumeRestore{}, fmt.Errorf("create recovery backup for volume %s: %w", targetVolume, err)
	}

	return preparedVolumeRestore{
		artifactPath: artifactPath,
		recoveryPath: recoveryPath,
		targetVolume: targetVolume,
		volumeName:   volumeName,
	}, nil
}

// Docker CLI cancellation does not stop daemon-side work. Create before starting
// so cancellation never leaves an unknown, destructive helper racing rollback.
func (runner *Runner) replaceVolumeContents(ctx context.Context, volumeName string, artifactPath string, helperName string) (result error) {
	setupCtx, cancelSetup := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancelSetup()
	args := []string{
		"create", "--name", helperName,
		"-v", volumeName + ":/volume_data",
		"-v", filepath.Dir(artifactPath) + ":/restore:ro",
		volumeUtilityImage, "sh", "-lc",
		"find /volume_data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /restore/" + shellQuote(filepath.Base(artifactPath)) + " -C /volume_data && sync",
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
		defer cancel()
		if err := runner.removeRestoreHelper(cleanupCtx, helperName); err != nil {
			result = errors.Join(result, err)
		}
	}()
	if _, err := runner.commandOutput(setupCtx, "", "docker", args...); err != nil {
		return fmt.Errorf("create restore helper %s: %w", helperName, err)
	}
	if _, err := runner.commandOutput(ctx, "", "docker", "start", "--attach", helperName); err != nil {
		return fmt.Errorf("replace volume contents: %w", err)
	}
	return nil
}

func (runner *Runner) removeRestoreHelper(ctx context.Context, name string) error {
	_, err := runner.commandOutput(ctx, "", "docker", "rm", "-f", name)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "no such container") {
		return fmt.Errorf("stop restore helper %s: %w", name, err)
	}
	return nil
}

func (runner *Runner) restoreDatabaseArtifact(ctx context.Context, runtimeID string, artifactPath string, targetService string, restoreCommand string) error {
	writeJobProgress(ctx, fmt.Sprintf("Restoring database service %s.", targetService))
	if strings.TrimSpace(targetService) == "" || strings.TrimSpace(restoreCommand) == "" {
		return errors.New("database restore target service and command are required")
	}

	file, err := os.Open(artifactPath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("open gzip database artifact: %w", err)
	}
	defer gzipReader.Close()

	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return err
	}
	args := append(
		append([]string{}, composePrefix...),
		"-p",
		runtimeID,
		"exec",
		"-T",
		targetService,
		"sh",
		"-lc",
		restoreCommand,
	)
	cmd := agentCommand(ctx, composeName, args...)
	cmd.Stdin = gzipReader
	cmd.Stdout = jobDiagnostics(ctx, io.Discard)
	var stderr bytes.Buffer
	cmd.Stderr = jobDiagnostics(ctx, &stderr)
	cmd.Env = runner.commandEnv()
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("database restore for service %s failed: %w: %s", targetService, err, strings.TrimSpace(stderr.String()))
	}

	return nil
}

func (runner *Runner) runDeprovisionJob(ctx context.Context, job agentJob) cleanupJobCompletion {
	status := "succeeded"
	message := ""

	fail := func(err error) cleanupJobCompletion {
		status = "failed"
		message = err.Error()
		return cleanupJobCompletion{
			ServerID: runner.cfg.AgentID,
			Token:    runner.currentCredential(),
			Type:     job.Type,
			JobID:    job.ID,
			Attempt:  job.Attempt,
			Status:   status,
			Message:  message,
		}
	}

	for _, runtimeID := range job.Cleanup.RuntimeIDs {
		if strings.TrimSpace(runtimeID) == "" {
			continue
		}

		if err := runner.removeComposeRuntime(ctx, runtimeID, job.Cleanup.RemoveVolumes); err != nil {
			return fail(fmt.Errorf("unable to deprovision runtime %s: %w", runtimeID, err))
		}
	}

	return cleanupJobCompletion{
		ServerID: runner.cfg.AgentID,
		Token:    runner.currentCredential(),
		Type:     job.Type,
		JobID:    job.ID,
		Attempt:  job.Attempt,
		Status:   status,
		Message:  message,
	}
}

func (runner *Runner) writeDatabaseDump(ctx context.Context, runtimeID string, service string, command string, outputPath string) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o750); err != nil {
		return err
	}

	composeName, composePrefix, err := runner.composeCommand(ctx)
	if err != nil {
		return err
	}

	file, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer file.Close()

	args := append(
		append([]string{}, composePrefix...),
		"-p",
		runtimeID,
		"exec",
		"-T",
		service,
		"sh",
		"-lc",
		command,
	)
	cmd := agentCommand(ctx, composeName, args...)
	gzipWriter := gzip.NewWriter(file)
	cmd.Stdout = gzipWriter
	var stderr bytes.Buffer
	cmd.Stderr = jobDiagnostics(ctx, &stderr)
	cmd.Env = runner.commandEnv()
	if err := cmd.Run(); err != nil {
		_ = gzipWriter.Close()
		return fmt.Errorf("database dump for service %s failed: %w: %s", service, err, strings.TrimSpace(stderr.String()))
	}
	if err := gzipWriter.Close(); err != nil {
		return fmt.Errorf("compress database dump for service %s: %w", service, err)
	}
	return file.Close()
}

func (runner *Runner) backupVolumeNames(ctx context.Context, runtimeID string, selection backupVolumeSelection) ([]string, error) {
	switch selection.Mode {
	case "none":
		return []string{}, nil
	case "selected":
		volumeNames := make([]string, 0, len(selection.Names))
		for _, logicalName := range uniqueNonEmpty(selection.Names) {
			volumeName, err := runner.resolveRuntimeVolume(ctx, runtimeID, logicalName)
			if err != nil {
				return nil, err
			}
			volumeNames = append(volumeNames, volumeName)
		}
		return uniqueNonEmpty(volumeNames), nil
	case "", "allNamed":
		output, err := runner.commandOutput(
			ctx,
			"",
			"docker",
			"volume",
			"ls",
			"-q",
			"--filter",
			"label=com.docker.compose.project="+runtimeID,
		)
		if err != nil {
			return nil, err
		}
		return uniqueNonEmpty(strings.Split(output, "\n")), nil
	default:
		return nil, fmt.Errorf("unsupported backup volume mode %q", selection.Mode)
	}
}

func (runner *Runner) resolveRuntimeVolume(ctx context.Context, runtimeID string, logicalName string) (string, error) {
	output, err := runner.commandOutput(
		ctx,
		"",
		"docker",
		"volume",
		"ls",
		"-q",
		"--filter",
		"label=com.docker.compose.project="+runtimeID,
		"--filter",
		"label=com.docker.compose.volume="+logicalName,
	)
	if err != nil {
		return "", fmt.Errorf("resolve backup volume %s: %w", logicalName, err)
	}
	volumeNames := uniqueNonEmpty(strings.Split(output, "\n"))
	if len(volumeNames) != 1 {
		return "", fmt.Errorf("backup volume %s does not belong to runtime %s", logicalName, runtimeID)
	}
	return volumeNames[0], nil
}

func (runner *Runner) resolveRestoreVolume(ctx context.Context, runtimeID string, target string) (string, error) {
	// Archive names contain physical Docker volume names. Only accept an exact
	// match among this runtime's labeled volumes before resolving logical names.
	volumes, err := runner.backupVolumeNames(ctx, runtimeID, backupVolumeSelection{Mode: "allNamed"})
	if err != nil {
		return "", err
	}
	for _, volume := range volumes {
		if volume == target {
			return volume, nil
		}
	}
	return runner.resolveRuntimeVolume(ctx, runtimeID, target)
}

func (runner *Runner) writeVolumeBackup(ctx context.Context, volumeName string, outputPath string) error {
	if strings.TrimSpace(volumeName) == "" {
		return errors.New("volume name is required")
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o750); err != nil {
		return err
	}

	backupDir := filepath.Dir(outputPath)
	fileName := filepath.Base(outputPath)
	args := []string{
		"run",
		"--rm",
		"-v",
		volumeName + ":/volume_data:ro",
		"-v",
		backupDir + ":/backup",
		volumeUtilityImage,
		"sh",
		"-lc",
		"cd /volume_data && tar czf /backup/" + shellQuote(fileName) + " .",
	}
	output, err := runner.commandOutput(ctx, "", "docker", args...)
	if err != nil {
		return fmt.Errorf("backup volume %s: %w: %s", volumeName, err, strings.TrimSpace(output))
	}

	return nil
}

func (runner *Runner) uploadBackupArtifacts(ctx context.Context, backup backupConfig, artifacts []backupArtifact) ([]backupArtifact, error) {
	if err := runner.ensureRcloneAvailable(ctx); err != nil {
		return nil, err
	}

	remoteArtifacts := []backupArtifact{}
	for _, artifact := range artifacts {
		if artifact.Storage != "local" {
			continue
		}
		relative, err := filepath.Rel(backup.LocalBasePath, artifact.ObjectKey)
		if err != nil {
			return nil, err
		}
		remoteKey := pathJoinS3(backup.ArtifactPrefix, filepath.ToSlash(relative))
		if err := runner.uploadRemoteBackupArtifact(ctx, backup.Destination, artifact.ObjectKey, remoteKey); err != nil {
			for _, uploaded := range remoteArtifacts {
				_ = runner.deleteRemoteBackupArtifact(ctx, backup.Destination, uploaded.ObjectKey)
			}
			return nil, err
		}
		remoteArtifacts = append(remoteArtifacts, backupArtifact{
			Type:           artifact.Type,
			Storage:        "remote",
			ObjectKey:      remoteKey,
			ChecksumSHA256: artifact.ChecksumSHA256,
			SizeBytes:      artifact.SizeBytes,
		})
	}

	return remoteArtifacts, nil
}

func (runner *Runner) uploadRemoteBackupArtifact(ctx context.Context, destination backupDestination, localPath string, remoteKey string) error {
	configPath, err := writeRcloneS3Config(destination)
	if err != nil {
		return err
	}
	defer os.Remove(configPath)

	args := []string{"--config", configPath, "copyto", localPath, "devpush-backups:" + destination.Bucket + "/" + remoteKey}
	if output, err := runner.commandOutput(ctx, "", "rclone", args...); err != nil {
		return fmt.Errorf("upload remote backup artifact %s: %w: %s", remoteKey, err, strings.TrimSpace(output))
	}

	return nil
}

func (runner *Runner) deleteRemoteBackupArtifact(ctx context.Context, destination backupDestination, remoteKey string) error {
	configPath, err := writeRcloneS3Config(destination)
	if err != nil {
		return err
	}
	defer os.Remove(configPath)

	args := []string{"--config", configPath, "deletefile", "devpush-backups:" + destination.Bucket + "/" + strings.TrimLeft(remoteKey, "/")}
	if output, err := runner.commandOutput(ctx, "", "rclone", args...); err != nil {
		return fmt.Errorf("delete remote backup artifact %s: %w: %s", remoteKey, err, strings.TrimSpace(output))
	}

	return nil
}

func (runner *Runner) downloadRemoteBackupArtifact(ctx context.Context, destination backupDestination, remoteKey string, localPath string) error {
	configPath, err := writeRcloneS3Config(destination)
	if err != nil {
		return err
	}
	defer os.Remove(configPath)

	if err := os.MkdirAll(filepath.Dir(localPath), 0o750); err != nil {
		return err
	}
	args := []string{"--config", configPath, "copyto", "devpush-backups:" + destination.Bucket + "/" + strings.TrimLeft(remoteKey, "/"), localPath}
	if output, err := runner.commandOutput(ctx, "", "rclone", args...); err != nil {
		return fmt.Errorf("download remote backup artifact %s: %w: %s", remoteKey, err, strings.TrimSpace(output))
	}

	return nil
}

func (runner *Runner) ensureRcloneAvailable(ctx context.Context) error {
	if runner.commandSucceeds(ctx, "", "rclone", "version") {
		return nil
	}

	return fmt.Errorf("rclone is required for remote backups. Install rclone on the server or disable remote backups")
}

func writeRcloneS3Config(destination backupDestination) (string, error) {
	if strings.TrimSpace(destination.Bucket) == "" {
		return "", errors.New("remote backup bucket is required")
	}
	if strings.TrimSpace(destination.AccessKeyID) == "" || strings.TrimSpace(destination.SecretAccessKey) == "" {
		return "", errors.New("remote backup S3 credentials are required")
	}
	for name, value := range map[string]string{
		"access key ID":     destination.AccessKeyID,
		"secret access key": destination.SecretAccessKey,
		"region":            destination.Region,
		"endpoint":          destination.Endpoint,
	} {
		if err := validateRcloneConfigValue(name, value); err != nil {
			return "", err
		}
	}

	file, err := os.CreateTemp("", "devpush-rclone-*.conf")
	if err != nil {
		return "", err
	}
	path := file.Name()
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		os.Remove(path)
		return "", err
	}

	lines := []string{
		"[devpush-backups]",
		"type = s3",
		"provider = Other",
		"access_key_id = " + destination.AccessKeyID,
		"secret_access_key = " + destination.SecretAccessKey,
		"no_check_bucket = true",
		"force_path_style = true",
	}
	if destination.Region != "" {
		lines = append(lines, "region = "+destination.Region)
	}
	if destination.Endpoint != "" {
		lines = append(lines, "endpoint = "+destination.Endpoint)
	}
	if _, err := file.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		file.Close()
		os.Remove(path)
		return "", err
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", err
	}

	return path, nil
}

func fileArtifact(path string, artifactType string, storage string, objectKey string) (backupArtifact, error) {
	file, err := os.Open(path)
	if err != nil {
		return backupArtifact{}, err
	}
	defer file.Close()

	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return backupArtifact{}, err
	}

	return backupArtifact{
		Type:           artifactType,
		Storage:        storage,
		ObjectKey:      objectKey,
		ChecksumSHA256: hex.EncodeToString(hash.Sum(nil)),
		SizeBytes:      size,
	}, nil
}

func verifyFileSHA256(path string, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, strings.TrimSpace(expected)) {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expected, actual)
	}

	return nil
}
