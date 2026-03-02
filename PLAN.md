# Registry-Based Build & Deploy Plan (K8s)

This plan focuses on moving `/dev/push` from runtime command execution to a registry-backed image pipeline, while keeping local iteration fast and limiting security risk from user-defined commands.

## Goals

- Keep control plane architecture (`app`, `worker-jobs`, `worker-monitor`) intact.
- Build deployment images in Kubernetes and deploy by image reference.
- Support user-defined `build`, `pre-deploy`, and `start` commands.
- Ensure untrusted build commands cannot damage core Devpush services.

## Non-Goals (initial rollout)

- Multi-node optimization.
- Full enterprise policy framework.
- Advanced supply-chain features (signing/attestation) beyond basic hooks.

## Core Decision

- `worker-jobs` and `worker-monitor` both stay.
  - `worker-jobs`: submits build/deploy/cancel work.
  - `worker-monitor`: reconciles Kubernetes state/events back into DB.

## Execution Model

### 1) Build Phase (immutable artifact)

- For each deployment request:
  - Fetch source at requested commit.
  - Run user `build` command in isolated build job.
  - Produce image and push to registry.
- Output artifact: image reference (`repo:tag`, later `repo@digest`).

### 2) Runtime Phase (workload startup)

- Deploy workload using built image.
- Run user `pre-deploy` command at startup (initContainer or startup entrypoint).
- Run user `start` command as main process.

## Minimal Security Baseline (must-have)

Build jobs execute untrusted code. Minimum controls:

- Ephemeral Kubernetes Job per build.
- Non-root containers; no privileged mode.
- No host mounts; no Docker socket.
- Dedicated ServiceAccount with no broad RBAC.
- Strict resource/time limits (`cpu`, `memory`, `ephemeral-storage`, deadline).
- Network isolation:
  - default deny where possible,
  - allow only Git provider + registry endpoints,
  - deny access to Devpush internal services (`app`, `pgsql`, `redis`).
- Inject only per-deployment credentials (short-lived); never control-plane secrets.
- Hard cleanup of completed/failed/canceled build resources.

## Registry Strategy

### Local (current)

- Keep local image flow (`devpush-app:dev`) for control plane bring-up.
- No mandatory remote registry for local iteration.

### Cloud/Production

- Use registry-backed deployment images.
- Store image ref on deployment record.
- Rollback by previously known image ref.
- Start with tag-based refs; add digest pinning next.

## Migration Phases

## Phase A — Baseline Stabilization (now)

- Keep Helm local stack healthy (`app`, `pgsql`, `valkey`).
- Re-enable `worker-jobs` under K8s and verify queue flow.
- Re-enable `worker-monitor` with K8s status reconciliation (not Docker polling).
- Re-enable migration path safely (job hook or explicit command path).

**Exit criteria**
- Start/stop/status/clean scripts reliable.
- UI login and a basic deployment lifecycle works again.

## Phase B — Registry Build Pipeline

- Add build job submitter in `worker-jobs`.
- Define build workspace + command contract for user `build`.
- Push built image to configured registry and persist image ref.
- Deploy workload from image ref (no direct runtime build).

**Exit criteria**
- End-to-end deployment succeeds from commit -> image -> running workload.
- Failures are correctly surfaced with logs/events.

## Phase C — Async Reconciliation & Cancellation

- `worker-monitor` watches build/deploy resources and updates DB state.
- Implement robust state transitions:
  - `queued -> building -> deploying -> running | failed | canceled`.
- Add cancel semantics for both build and deploy paths.
- Add periodic resync safety pass to recover missed events.

**Exit criteria**
- Success/failure/cancel are consistent and idempotent.
- No stuck deployments under normal failure modes.

## Phase D — Hardening

- Add digest pinning and image immutability guarantees.
- Add retention/cleanup policies for build artifacts.
- Add policy defaults for resource quotas and network policy profiles.
- Add better observability mapping for Jobs/Pods/Deployments.

## Config Surface (proposed)

- Keep scripts minimal for now (`DEVPUSH_*` overrides only where needed).
- Introduce registry config when Phase B starts:
  - `registry_url`
  - `registry_repo_prefix`
  - `registry_credentials_secret`
  - optional `registry_insecure` (dev-only)

## Open Questions

- Build implementation choice in-cluster (kaniko/buildkit/job wrapper).
- Exact placement of `pre-deploy` (initContainer vs startup wrapper).
- Cleanup/retention defaults for registry artifacts.

## TODO

- Add explicit namespace preflight validation in `scripts/start.sh` (fail fast with clear message if namespace bootstrap is missing/invalid), since runtime code no longer performs namespace create/get checks.
