package agent

import (
	"fmt"
	"path/filepath"
	"strings"
)

func resolveRepositoryFile(repoDir string, configuredPath string) (string, error) {
	if configuredPath == "" || strings.TrimSpace(configuredPath) != configuredPath {
		return "", fmt.Errorf("repository path is empty or contains surrounding whitespace")
	}
	if filepath.IsAbs(configuredPath) || strings.Contains(configuredPath, "\\") {
		return "", fmt.Errorf("repository path must be relative")
	}

	cleanPath := filepath.Clean(filepath.FromSlash(configuredPath))
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("repository path escapes the checkout")
	}

	resolvedRoot, err := filepath.EvalSymlinks(repoDir)
	if err != nil {
		return "", fmt.Errorf("resolve repository checkout: %w", err)
	}
	resolvedPath, err := filepath.EvalSymlinks(filepath.Join(resolvedRoot, cleanPath))
	if err != nil {
		return "", err
	}
	relativePath, err := filepath.Rel(resolvedRoot, resolvedPath)
	if err != nil {
		return "", fmt.Errorf("compare repository path: %w", err)
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("repository path escapes the checkout")
	}

	return resolvedPath, nil
}
