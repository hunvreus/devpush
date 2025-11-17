# Migrate Logging to Grafana Alloy (Option A)

This document describes the plan to remove the Docker Loki log driver and migrate to Grafana Alloy using file tailing (Option A). It covers code, compose, scripts, and docs changes, plus validation and rollout.

## Goals

- Fully remove the Docker Loki logging driver and any plugin handling.
- Use Grafana Alloy to tail Docker JSON logs and forward to the existing Loki service.
- Preserve log label semantics so the app UI queries continue to work.
- Keep minimal Docker privileges and predictable failure modes.

## Scope

- App code: runner container creation and labels.
- Compose files: add an `alloy` service for both prod and dev stacks.
- Scripts: remove plugin logic from prod/dev install; include Alloy data dirs; allow updating `alloy`.
- Docs: update references to the Docker Loki plugin; document Alloy.

## Summary of Changes

1) Remove Loki Docker log driver usage in runner containers; switch to `json-file` with rotation.
2) Add Alloy service that tails `/var/lib/docker/containers/*/*.log` and explicitly maps container labels to the Loki labels the UI uses.
3) Remove all plugin install/enable paths from scripts and docs.
4) Keep Loki service as-is; only change the ingestion path.

---

## Code Changes

- File: `app/workers/tasks/deploy.py`
  - Remove the `HostConfig.LogConfig` section with `"Type": "loki"`.
  - Ensure the container has namespaced labels for log queries:
    - `devpush.deployment_id`
    - `devpush.project_id`
    - `devpush.environment_id`
    - `devpush.branch`
  - Set explicit JSON-file rotation to bound disk usage:
    - `HostConfig.LogConfig = { "Type": "json-file", "Config": { "max-size": "10m", "max-file": "5" } }`

No changes are needed to `app/services/loki.py` (it queries by labels). Alloy will map container labels to Loki labels.

---

## Compose Changes

- File: `docker-compose.yml` (prod)
  - Add `alloy` service with pinned image `grafana/alloy:v1.11.3`.
    - networks: join `internal` (to reach `loki`) and `default` (collector not exposed).
    - volumes:
      - `/var/lib/docker/containers:/var/lib/docker/containers:ro` (Docker JSON logs)
      - `./Docker/alloy/config.alloy:/etc/alloy/config.alloy:ro` (config from repo)
      - `/srv/devpush/alloy:/var/lib/alloy` (state)
    - command: `run /etc/alloy/config.alloy`
    - restart policy: `unless-stopped`

  - `docker-proxy` service: ensure discovery env flags:
    - `CONTAINERS=1`
    - `SYSTEM=1`
    - `INFO=1`

- File: `docker-compose.override.dev.yml` (dev)
  - Add `alloy` service mirroring prod, but mount from repo:
    - `/var/lib/docker/containers:/var/lib/docker/containers:ro`
    - `./Docker/alloy/config.alloy:/etc/alloy/config.alloy:ro`
    - `./data/alloy:/var/lib/alloy`
  - Follow the same base + override pattern used for other services.

- File: `docker-compose.setup.yml`
  - No change needed (keep minimal stack).

---

## Alloy Configuration

- New file: `Docker/alloy/config.alloy`
- Responsibilities:
  - Discover Docker containers via the socket proxy.
  - Tail JSON log files under `/var/lib/docker/containers`.
  - Map container labels to Loki labels (`project_id`, `deployment_id`, `environment_id`, `branch`, `job=docker`).
  - Write to Loki at `http://loki:3100/loki/api/v1/push`.

- Outline (rendered for Alloy v1.11.3):

```
# Discover containers through the proxy
discovery.docker "docker" {
  host             = "tcp://docker-proxy:2375"
  refresh_interval = "30s"
}

discovery.relabel "docker_logs" {
  targets = discovery.docker.docker.targets

  rule { source_labels = ["__meta_docker_container_log_path"]; target_label = "__path__" }
  rule { source_labels = ["__meta_docker_container_label_devpush_project_id"]; target_label = "project_id" }
  rule { source_labels = ["__meta_docker_container_label_devpush_deployment_id"]; target_label = "deployment_id" }
  rule { source_labels = ["__meta_docker_container_label_devpush_environment_id"]; target_label = "environment_id" }
  rule { source_labels = ["__meta_docker_container_label_devpush_branch"]; target_label = "branch" }
  rule { target_label = "job"; replacement = "docker" }
}

# Tail Docker json-file logs
loki.source.file "docker" {
  targets    = discovery.relabel.docker_logs.output
  forward_to = [loki.process.docker.receiver]

}

# Write to Loki
loki.process "docker" {
  forward_to = [loki.write.default.receiver]
}
loki.write "default" {
  endpoint { url = "http://loki:3100/loki/api/v1/push" }
}
```

Note: We explicitly map `__meta_docker_container_label_devpush_*` to the labels the app queries: `project_id`, `deployment_id`, `environment_id`, `branch`, plus `job=docker`.

---

## Script Changes (Prod)

- File: `scripts/prod/install.sh`
  - Remove the entire Docker plugin block:
    - `docker plugin install grafana/loki-docker-driver ...`
    - `docker plugin enable loki`
    - Waiting for `/run/docker/plugins/*/loki.sock`
  - Ensure data directories include Alloy:
    - `install -d -m 0755 /srv/devpush/alloy`

- Files: `scripts/prod/update.sh`, `scripts/prod/update-apply.sh`
  - Recognize `alloy` as an updatable component (include in the component switch and `--all`).
  - No plugin references should remain.

- Upgrade hook
  - New file under `scripts/prod/upgrades/` (0.1.2):
    - Disable/remove Loki plugin best-effort.
    - Ensure `/srv/devpush/alloy` exists.

---

## Script Changes (Dev)

- File: `scripts/dev/install.sh`
  - Update help to remove plugin references.
  - Remove all `docker plugin` checks/installs.

- File: `scripts/dev/start.sh`
  - Ensure `./data/alloy` is created on start (positions dir).
  - No other changes required; dev compose will include `alloy`.

---

## Docs Changes

- File: `README.md`
  - Replace "Install Colima and the Loki Docker plugin" with "Install Colima".
  - Document that Alloy tails Docker logs and forwards to Loki.
  - Mention labels used by the app UI: `project_id`, `deployment_id`, `environment_id`, `branch`.

- File: `CONTRIBUTING.md`
  - Remove any mention of installing the Loki plugin for development.

---

## Removal Checklist (No Plugin Traces)

- [ ] No `"Type": "loki"` or `LogConfig ... loki` in the codebase.
- [ ] No `docker plugin` commands in any scripts.
- [ ] No references to `loki.sock` or plugin enablement.
- [ ] Docs no longer mention the Docker Loki plugin.
- [ ] No special permissions or files for the plugin remain.

---

## Validation Plan

- Functional
  - Deploy a project and confirm:
    - Runner containers include `devpush.*` labels.
    - Alloy is healthy; logs appear in Loki.
    - App log views show entries filtered by the same labels as before.
  - Restart Alloy; confirm it resumes from positions without big gaps/dupes.
  - Trigger log rotation; Alloy continues tailing rotated files.

- Security/Isolation
  - Alloy runs with read-only mount to `/var/lib/docker/containers`.
  - Discovery goes through `docker-proxy` (not the raw Docker socket).
  - `docker-proxy` exposes minimal capabilities: `CONTAINERS=1`, `SYSTEM=1` (and optionally `INFO=1`).

- Regression
  - `scripts/prod/install.sh` works on a fresh host without any plugin steps.
  - `scripts/dev/install.sh` works on macOS without plugin steps.
  - `scripts/prod/update.sh --all` updates `alloy` alongside other services.

---

## Rollout Steps

1) Remove plugin code and log driver usage; add container labels in `deploy.py`.
2) Add Alloy service and config; mount positions/state (prod: `/srv/devpush/alloy`, dev: `./data/alloy`).
3) Adjust `docker-proxy` env if needed; bring stack up; validate logs end-to-end.
4) Update prod/dev scripts and documentation.
5) Add upgrade hook to best-effort remove any existing Loki plugin.
6) Release notes: Docker Loki plugin removed; Alloy introduced for log collection.
