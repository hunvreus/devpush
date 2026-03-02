# Kubernetes Rewrite Plan

This plan assumes a clean branch off `development` and a K8s-first runtime strategy.

## Phase 1 — K8s Runtime Parity (Target: 1–2 weeks)

### Goal

Replace Docker runtime execution with Kubernetes while keeping current product behavior and deployment UX stable.

### Scope

- Introduce Kubernetes runtime integration in workers/services.
- Rewrite deployment task flow (`start/finalize/fail/cancel/cleanup`) to use Kubernetes resources instead of direct Docker runtime.
- Keep current deployment state machine and status semantics in core.
- Keep current build/start command semantics for parity (no full image pipeline overhaul in this phase).
- Use local k3d for development and verify compatibility with k3s + one managed K8s distro.

### Out of scope

- Full immutable image build pipeline redesign.
- Enterprise auth/governance features.
- Billing engine implementation.

### Acceptance criteria

- End-to-end deploy, fail, cancel, and cleanup succeed on k3d.
- No Docker runtime calls remain in worker execution paths.
- Existing deployment UI states remain coherent (`prepare`, `deploy`, `finalize`, `fail`, `completed`).

### Implementation checklist (repo-specific)

1) **Runtime backend**

- Add `K8sDeploymentExecutor` under `app/services/deployment_executor/`.
- Keep `DeploymentSpec` as control-plane contract; map it to Kubernetes resources.
- Register `k8s` executor in `deployment_executor` registry.
- Add config knobs in `app/config.py` for:
  - kubeconfig/context/in-cluster mode
  - namespace strategy
  - ingress class
  - storage class (optional in phase 1)

2) **Deployment worker rewrite**

- Replace runtime calls in `app/workers/tasks/deployment.py` to target `K8sDeploymentExecutor`.
- `start_deployment`:
  - create/update workload resources
  - persist returned execution handle (resource identity)
- cancel/fail/delete/cleanup paths:
  - use K8s stop/kill/remove semantics via executor
  - maintain existing status transitions in DB

3) **Monitor rewrite**

- Update `app/workers/monitor.py` to use K8s runtime status signals for deploy readiness/failure.
- Ready path: enqueue `finalize_deployment` only on explicit ready/healthy condition.
- Failure path: map K8s failure states/events to `fail_deployment` reasons.
- Keep dedupe protections for repeated events/polls.

4) **Remove Docker runtime dependency from execution path**

- Eliminate direct worker path dependency on `aiodocker` for deployment lifecycle.
- Keep any unrelated image catalog tasks temporary if needed, but do not use Docker runtime for deploy/monitor/cleanup.

5) **Routing/domain integration**

- Preserve existing hostname/alias behavior in control plane.
- Ensure K8s ingress resources match current alias/domain logic.
- Keep Traefik integration equivalent via ingress class and annotations/labels.

6) **Local development runtime**

- Standardize local test cluster on k3d.
- Provide minimal local bootstrap docs:
  - create cluster
  - configure kube context
  - start control plane
  - run one deployment dry run

7) **Validation gates before merge**

- Deploy success case (ready -> finalize).
- Deploy failure case (image/start/probe failure -> fail).
- Cancel path (immediate kill semantics preserved).
- Cleanup inactive deployments works with K8s resources.
- No regression in deployment event stream behavior for UI updates.

## Phase 2 — Production Hardening (Cloud + Enterprise Readiness)

### Goal

Harden for reliable multi-tenant cloud usage and enterprise requirements.

### Scope

- Isolation model validation (namespace and policy boundaries per tenant/project).
- Quotas and guardrails (CPU/memory/storage/network policy defaults).
- Cost and usage attribution hooks.
- Improved platform observability mapping (K8s events/restarts/readiness history).
- Optional immutable image pipeline adoption.
- Enterprise controls (SAML/SSO, RBAC, audit trail).

### Acceptance criteria

- Predictable isolation and noisy-neighbor protection.
- Enforceable resource limits and usage tracking inputs.
- Operator-grade troubleshooting for failed deployments.

## Local Development Baseline

- Use `k3d` as local Kubernetes runtime.
- Continue using existing control plane (app/db/redis/workers) during migration.
- Validate via repeatable local dry-run scenarios before production rollout.

## Open TODOs

- Keep runner registry as catalog-only; revisit optional K8s image pre-pull/warmup later.
- Assume Traefik controller for redirect domain types (`301/302/307/308`) in phase 1.
- Harden redirect-domain parity tests (`301/302/307/308`) for Traefik middleware-backed routing.
- Add validation to fail clearly when redirect domain types are configured without Traefik support.
- Add follow-up support for non-Traefik controllers (starting with ingress-nginx redirect semantics).
- Add a production ingress exposure profile based on `Service.type=LoadBalancer` (with docs for cloud LB and self-hosted alternatives when LB integration is unavailable).
