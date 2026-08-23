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
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func (runner *Runner) runBackupJob(ctx context.Context, job agentJob) backupJobCompletion {
	status := "succeeded"
	message := ""
	manifest := map[string]any{
		"schemaVersion": 1,
		"backupRunId":   job.Backup.BackupRunID,
		"runtimeId":     job.Backup.RuntimeID,
		"createdAt":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	artifacts := []backupArtifact{}

	fail := func(err error) backupJobCompletion {
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
	if err := os.MkdirAll(job.Backup.LocalBasePath, 0o750); err != nil {
		return fail(fmt.Errorf("create backup directory: %w", err))
	}

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
		service := sanitizeArtifactName(dump.Service)
		if service == "" || strings.TrimSpace(dump.Command) == "" {
			return fail(fmt.Errorf("database dump %d must include service and command", index+1))
		}
		path := filepath.Join(job.Backup.LocalBasePath, "databases", fmt.Sprintf("%02d-%s.sql.gz", index+1, service))
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

	if job.Backup.Retention.Remote.Enabled {
		remoteArtifacts, err := runner.uploadBackupArtifacts(ctx, job.Backup, artifacts)
		if err != nil {
			return fail(err)
		}
		artifacts = append(artifacts, remoteArtifacts...)
	}

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
		path := strings.TrimSpace(key)
		if path == "" {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fail(fmt.Errorf("remove local backup artifact %s: %w", path, err))
		}
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

func (runner *Runner) runRestoreJob(ctx context.Context, job agentJob) restoreJobCompletion {
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

	workdir, err := os.MkdirTemp("", "devpush-restore-*")
	if err != nil {
		return fail(err)
	}
	defer os.RemoveAll(workdir)

	localPaths := map[string]string{}
	for _, artifact := range job.Restore.Artifacts {
		path, err := runner.restoreArtifactPath(ctx, job.Restore.Destination, artifact, workdir)
		if err != nil {
			return fail(err)
		}
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

	var stoppedContainers []string
	if len(volumeArtifacts) > 0 {
		stoppedContainers, err = runner.stopRuntimeContainers(ctx, job.Restore.RuntimeID)
		if err != nil {
			return fail(err)
		}
		for _, artifact := range volumeArtifacts {
			if err := runner.restoreVolumeArtifact(ctx, localPaths[artifact.ID], artifact.TargetVolume); err != nil {
				_ = runner.startContainers(ctx, stoppedContainers)
				return fail(err)
			}
		}
		if err := runner.startContainers(ctx, stoppedContainers); err != nil {
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
		if strings.TrimSpace(artifact.ObjectKey) == "" {
			return "", errors.New("local restore artifact path is required")
		}
		return artifact.ObjectKey, nil
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

func (runner *Runner) stopRuntimeContainers(ctx context.Context, runtimeID string) ([]string, error) {
	containerIDs, err := runner.dockerIDsByLabel(ctx, "ps", "-q", "--filter", "label=com.docker.compose.project="+runtimeID)
	if err != nil {
		return nil, err
	}
	if len(containerIDs) == 0 {
		return []string{}, nil
	}
	if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"stop"}, containerIDs...)...); err != nil {
		return nil, err
	}
	return containerIDs, nil
}

func (runner *Runner) startContainers(ctx context.Context, containerIDs []string) error {
	if len(containerIDs) == 0 {
		return nil
	}
	if _, err := runner.commandOutput(ctx, "", "docker", append([]string{"start"}, containerIDs...)...); err != nil {
		return err
	}
	return nil
}

func (runner *Runner) restoreVolumeArtifact(ctx context.Context, artifactPath string, targetVolume string) error {
	if strings.TrimSpace(targetVolume) == "" {
		return errors.New("target volume is required")
	}
	if _, err := os.Stat(artifactPath); err != nil {
		return err
	}
	args := []string{
		"run",
		"--rm",
		"-v",
		targetVolume + ":/volume_data",
		"-v",
		filepath.Dir(artifactPath) + ":/restore:ro",
		"alpine",
		"sh",
		"-lc",
		"find /volume_data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /restore/" + shellQuote(filepath.Base(artifactPath)) + " -C /volume_data",
	}
	output, err := runner.commandOutput(ctx, "", "docker", args...)
	if err != nil {
		return fmt.Errorf("restore volume %s: %w: %s", targetVolume, err, strings.TrimSpace(output))
	}
	return nil
}

func (runner *Runner) restoreDatabaseArtifact(ctx context.Context, runtimeID string, artifactPath string, targetService string, restoreCommand string) error {
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
	cmd := exec.CommandContext(ctx, composeName, args...)
	cmd.Stdin = gzipReader
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
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
	cmd := exec.CommandContext(ctx, composeName, args...)
	cmd.Stdout = file
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Env = runner.commandEnv()
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("database dump for service %s failed: %w: %s", service, err, strings.TrimSpace(stderr.String()))
	}

	return nil
}

func (runner *Runner) backupVolumeNames(ctx context.Context, runtimeID string, selection backupVolumeSelection) ([]string, error) {
	switch selection.Mode {
	case "none":
		return []string{}, nil
	case "selected":
		return uniqueNonEmpty(selection.Names), nil
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
		"alpine",
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
