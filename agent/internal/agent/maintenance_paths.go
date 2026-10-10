package agent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const backupRootPath = "/var/lib/devpush-agent/backups"

func prepareBackupDirectory(value string) (string, error) {
	path, err := backupPath(value, false)
	if err != nil {
		return "", err
	}
	if path == backupRootPath {
		return "", errors.New("backup path must be below the backup root")
	}
	if err := os.MkdirAll(path, 0o750); err != nil {
		return "", err
	}

	return backupPath(path, true)
}

func existingBackupArtifactPath(value string) (string, error) {
	return backupPath(value, true)
}

func backupPath(value string, mustExist bool) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("backup path is required")
	}
	path, err := filepath.Abs(filepath.Clean(trimmed))
	if err != nil {
		return "", err
	}
	root, err := filepath.Abs(backupRootPath)
	if err != nil {
		return "", err
	}
	if !pathWithinRoot(root, path) {
		return "", fmt.Errorf("backup path %q is outside %s", value, backupRootPath)
	}
	if !mustExist {
		return path, nil
	}

	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve backup root: %w", err)
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	if !pathWithinRoot(resolvedRoot, resolvedPath) {
		return "", fmt.Errorf("backup path %q resolves outside %s", value, backupRootPath)
	}

	return path, nil
}

func pathWithinRoot(root string, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func validateRcloneConfigValue(name string, value string) error {
	if strings.ContainsAny(value, "\r\n\x00") {
		return fmt.Errorf("remote backup %s must be a single line", name)
	}

	return nil
}

func pruneEmptyBackupDirectories(path string) {
	for pathWithinRoot(backupRootPath, path) && path != backupRootPath {
		if err := os.Remove(path); err != nil {
			return
		}
		path = filepath.Dir(path)
	}
}

func sanitizeArtifactName(value string) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, char := range value {
		valid := (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '.' ||
			char == '_' ||
			char == '-'
		if valid {
			builder.WriteRune(char)
		} else {
			builder.WriteRune('-')
		}
	}

	return strings.Trim(builder.String(), ".-_")
}

func pathJoinS3(parts ...string) string {
	cleaned := []string{}
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}

	return strings.Join(cleaned, "/")
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
