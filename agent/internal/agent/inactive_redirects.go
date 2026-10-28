package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const inactiveRedirectLimit = 1000

var fallbackID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,80}$`)
var fallbackHost = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$`)

type inactiveRedirect struct {
	ID    string `json:"id"`
	Host  string `json:"host"`
	HTTPS bool   `json:"https"`
}

// Keep only immutable deployment hosts, never project domains or mutable aliases.
// Docker's live routers take precedence over these priority-one fallback routers.
func (runner *Runner) rememberInactiveRedirect(job deploymentJob) error {
	if job.FallbackHost == "" {
		return nil
	}
	if !fallbackID.MatchString(job.ID) || !fallbackHost.MatchString(job.FallbackHost) {
		return fmt.Errorf("invalid deployment redirect identity")
	}
	var known *route
	for _, route := range job.Routes {
		if route.Host == job.FallbackHost {
			copy := route
			known = &copy
			break
		}
	}
	if known == nil {
		return fmt.Errorf("deployment redirect host is not a deployment route")
	}
	directory := filepath.Join(runner.cfg.StateDir, "inactive-redirects")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	body, err := json.Marshal(inactiveRedirect{ID: job.ID, Host: known.Host, HTTPS: known.HTTPS})
	if err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(directory, job.ID+".json"), body, 0600); err != nil {
		return err
	}
	return runner.syncInactiveRedirects()
}

func (runner *Runner) syncInactiveRedirects() error {
	directory := filepath.Join(runner.cfg.StateDir, "inactive-redirects")
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		entries = nil
	} else if err != nil {
		return err
	}
	dynamic := filepath.Join(runner.certificateDirectory(), "dynamic")
	if err := os.MkdirAll(dynamic, 0700); err != nil {
		return err
	}
	// Bound on-disk history and ingress configuration. Oldest URLs return local 404.
	sort.Slice(entries, func(i, j int) bool {
		a, e1 := entries[i].Info()
		b, e2 := entries[j].Info()
		if e1 != nil || e2 != nil {
			return entries[i].Name() < entries[j].Name()
		}
		return a.ModTime().After(b.ModTime())
	})
	routers := map[string]any{}
	middlewares := map[string]any{}
	for index, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") || entry.IsDir() {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		if index >= inactiveRedirectLimit {
			if err := os.Remove(path); err != nil {
				return err
			}
			continue
		}
		if runner.cfg.DisableInactiveRedirects {
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var record inactiveRedirect
		if err := json.Unmarshal(body, &record); err != nil {
			return err
		}
		if !fallbackID.MatchString(record.ID) || !fallbackHost.MatchString(record.Host) {
			return fmt.Errorf("invalid stored deployment redirect")
		}
		if err := validateControlPlaneURL(runner.cfg.BaseURL); err != nil {
			return err
		}
		name := "inactive-" + record.ID
		target := strings.TrimRight(runner.cfg.BaseURL, "/") + "/deployments/" + record.ID + "/unavailable"
		middlewares[name+"-privacy"] = map[string]any{"headers": map[string]any{"customResponseHeaders": map[string]string{"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}}}
		middlewares[name] = map[string]any{"redirectRegex": map[string]any{"regex": "^https?://.*", "replacement": target, "permanent": false}}
		base := map[string]any{"rule": "Host(`" + record.Host + "`)", "priority": 1, "entryPoints": []string{"web"}, "middlewares": []string{name + "-privacy", name}, "service": "noop@internal"}
		routers[name] = base
		if record.HTTPS {
			routers[name+"-secure"] = map[string]any{"rule": base["rule"], "priority": 1, "entryPoints": []string{"websecure"}, "middlewares": []string{name + "-privacy", name}, "service": "noop@internal", "tls": map[string]any{}}
		}
	}
	path := filepath.Join(dynamic, "inactive-redirects.yaml")
	// Traefik rejects empty middleware/router maps and discards the entire file
	// provider configuration, including certificates from adjacent files.
	if len(routers) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	// JSON is valid YAML; encoding it avoids interpolating untrusted hostnames into YAML.
	body, err := json.Marshal(map[string]any{"http": map[string]any{"routers": routers, "middlewares": middlewares}})
	if err != nil {
		return err
	}
	return writeAtomic(path, body, 0600)
}

// The authenticated registration response also restores history after an agent
// upgrade or lost local state. This bounded snapshot is not sent every heartbeat.
func (runner *Runner) seedInactiveRedirects(records []inactiveRedirect) error {
	if len(records) == 0 {
		return nil
	}
	if len(records) > inactiveRedirectLimit {
		return fmt.Errorf("too many inactive redirects")
	}
	directory := filepath.Join(runner.cfg.StateDir, "inactive-redirects")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	// Persist oldest first so the bounded local history retains the newest entries.
	for i := len(records) - 1; i >= 0; i-- {
		record := records[i]
		if !fallbackID.MatchString(record.ID) || !fallbackHost.MatchString(record.Host) {
			return fmt.Errorf("invalid deployment redirect identity")
		}
		body, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if err := writeAtomic(filepath.Join(directory, record.ID+".json"), body, 0600); err != nil {
			return err
		}
	}
	return runner.syncInactiveRedirects()
}
