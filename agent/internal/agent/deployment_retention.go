package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Inspect every container, including stopped and unmanaged containers: any of
// them may still depend on a checkout through a bind mount. Fail closed if the
// Docker inventory cannot be read. Rollbacks fetch a fresh checkout.
func (runner *Runner) pruneDeploymentDirectories(ctx context.Context, keep string) error {
	root, err := filepath.Abs(filepath.Join(runner.cfg.StateDir, "deployments"))
	if err != nil {
		return err
	}
	if keep != "" {
		keep, err = filepath.Abs(keep)
		if err != nil {
			return err
		}
	}
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	// Remove installation tokens left by older agents even from retained checkouts.
	for _, entry := range entries {
		if entry.IsDir() {
			if err := scrubCheckoutCredential(filepath.Join(root, entry.Name(), "repo")); err != nil {
				return err
			}
		}
	}
	ids, err := runner.dockerIDsByLabel(ctx, "ps", "-aq")
	if err != nil {
		return err
	}
	references := []string{keep}
	if len(ids) > 0 {
		output, err := runner.commandOutput(ctx, "", "docker", append([]string{"inspect"}, ids...)...)
		if err != nil {
			return err
		}
		var inventory []json.RawMessage
		if err := json.Unmarshal([]byte(output), &inventory); err != nil {
			return err
		}
		if len(inventory) != len(ids) {
			return fmt.Errorf("incomplete Docker container inspection; retaining deployment directories")
		}
		paths, err := deploymentContainerPaths(output)
		if err != nil {
			return err
		}
		references = append(references, paths...)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(root, entry.Name())
		retained := false
		for _, reference := range references {
			if pathsOverlap(path, reference) {
				retained = true
				break
			}
		}
		if !retained {
			if err := os.RemoveAll(path); err != nil {
				return err
			}
		}
	}
	return nil
}

func deploymentContainerPaths(value string) ([]string, error) {
	var containers []struct {
		Mounts []struct{ Source string }
		Config struct{ Labels map[string]string }
	}
	if err := json.Unmarshal([]byte(value), &containers); err != nil {
		return nil, fmt.Errorf("inspect deployment references: %w", err)
	}
	if containers == nil {
		return nil, fmt.Errorf("inspect deployment references: missing container inventory")
	}
	paths := []string{}
	for _, container := range containers {
		for _, mount := range container.Mounts {
			paths = append(paths, mount.Source)
		}
		paths = append(paths, container.Config.Labels["com.docker.compose.project.working_dir"])
		paths = append(paths, strings.Split(container.Config.Labels["com.docker.compose.project.config_files"], ",")...)
	}
	return paths, nil
}

func pathsOverlap(left, right string) bool {
	if left == "" || right == "" || !filepath.IsAbs(right) {
		return false
	}
	left = canonicalDeploymentPath(left)
	right = canonicalDeploymentPath(right)
	within := func(base, path string) bool {
		relative, err := filepath.Rel(base, path)
		return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
	}
	return within(left, right) || within(right, left)
}

func canonicalDeploymentPath(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	parent := absolute
	suffix := ""
	for {
		if resolved, err := filepath.EvalSymlinks(parent); err == nil {
			return filepath.Join(resolved, suffix)
		}
		next := filepath.Dir(parent)
		if next == parent {
			return absolute
		}
		suffix = filepath.Join(filepath.Base(parent), suffix)
		parent = next
	}
}

var checkoutTokenURL = regexp.MustCompile(`https://x-access-token:[^@\s]+@github\.com/`)

func scrubCheckoutCredential(repoDir string) error {
	gitDir := filepath.Join(repoDir, ".git")
	info, err := os.Lstat(gitDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return nil
	}
	config := filepath.Join(gitDir, "config")
	info, err = os.Lstat(config)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	content, err := os.ReadFile(config)
	if err != nil {
		return err
	}
	cleaned := checkoutTokenURL.ReplaceAll(content, []byte("https://github.com/"))
	if string(cleaned) == string(content) {
		return nil
	}
	return os.WriteFile(config, cleaned, 0600)
}
