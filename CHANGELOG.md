# Changelog

All notable changes to devpush will be documented in this file.

## Unreleased

### Added

- Added the new TanStack Start control plane scaffold in `app/`.
- Added the Go agent scaffold in `agent/`.
- Added root architecture, development, and protocol documentation.
- Moved the previous implementation into `legacy/` as reference material.
- Added a minimal Docker Compose web example for remote MVP validation.

### Changed

- Hardened managed Traefik route generation by normalizing route path prefixes
  and rejecting query, fragment, whitespace, and backtick characters in route
  paths.
- Improved deployment failure messages for common agent-side failures, including
  repository fetch, missing Compose files, Traefik setup, Compose pull/build/up,
  release commands, and readiness checks.
- Added a local MVP validation command that runs typecheck, lint, app tests,
  control-plane smoke, agent tests, smoke-mode config validation, and the real
  Docker/Traefik agent smoke.
- Hardened remote MVP config validation for public URLs, default app domains,
  and numeric GitHub App IDs.
- Improved remote MVP validation diagnostics for failed VPS runs, including
  agent service status/logs, Docker containers/networks, and port listeners.
- Added a remote MVP validation success summary artifact that records checked
  URLs and proof flags without storing the server install token.
- Added a `validate:remote:proof` command that chains remote config validation,
  production image validation, and full remote route validation.
- Hardened `validate:remote:proof` so the proof env file must exist and its
  `BETTER_AUTH_URL` origin must match `DEVPUSH_SERVER_URL`.
- Changed remote MVP validation to require fresh agent registration or heartbeat
  activity in systemd logs after the validation run starts.
- Changed remote MVP validation to reject non-HTTPS control-plane and deployed
  route URLs by default, with an explicit local/private-network override.
- Added a full remote MVP proof mode that requires a deployed public route and
  managed Traefik validation.
- Added a production image validation command that checks Compose config, builds
  the control-plane image, and verifies the bundled agent binary and runtime
  startup dependencies.
- Added incremental deploy progress reporting from the agent to the control
  plane, with sequence-based deploy log chunks.
- Added automatic UI refresh for active deployment lists and deployment logs.
- Added server heartbeat history, 24-hour uptime summaries, host metrics, and
  server monitoring documentation.
- Added the initial backup behavior spec covering S3-compatible destinations,
  retention, database dump commands, volume archives, restore modes, and agent
  job boundaries.
- Added backup persistence for per-environment configuration, backup run
  history, and backup artifact records.
- Added queued backup agent jobs for enabled environment backup configs while
  keeping unsupported backup jobs hidden from current agents.
- Added backup agent job completion handling so backup runs and artifact records
  are updated from agent-reported results.
- Added project backup settings UI for environment backup configs, S3-compatible
  destinations, retention windows, and database dump commands.
- Added backup retention cleanup queueing that marks expired backup runs and
  creates `backup_cleanup` agent jobs for deleted object keys.
- Added backup cleanup job completion handling so retention cleanup results are
  recorded on backup runs and agent jobs.
- Added pending team invite notifications with in-app invite acceptance.
- Added confirmation and avatars for pending team invite management.
- Added runtime log ingestion for assigned Compose runtimes through agent
  heartbeat log targets.
- Changed account deletion to mark users deleted and immediately clear
  sessions and linked accounts, while queuing team/resource cleanup in a
  retryable background job.
- Hardened deleted-user handling for account settings, team membership lists,
  default-team delete guards, and username allocation.
- Hardened pending team invite management so resend rotates the existing invite
  token and revoke reports missing or inactive invites instead of silently
  succeeding.
- Changed rollback and redeploy to reuse the selected deployment snapshot,
  including Compose settings, routes, server placement, runtime identity, and
  encrypted environment variables.
- Changed agent-reported deployment cancellation to persist as a canceled
  deployment phase instead of a generic completed phase.
- Changed new deployment snapshots to expand routes from saved project routes
  and hostnames instead of the production environment route mirror.
- Changed deployment environment variable snapshots to resolve environment-specific
  overrides by stable environment ID.
- Changed successful deployment completion to update generated environment aliases
  by stable environment ID instead of editable environment slug.
- Changed agent deploy jobs to include devpush runtime environment variables from
  the deployment snapshot while preserving user-defined overrides.
- Moved Better Auth email-change and email-verification message rendering into
  tested email builders.
- Changed project environment saves to create/update runtime rows and generated
  environment aliases for every active environment, not only production.
- Fixed the control-plane deploy lifecycle smoke fixture to use stable
  environment IDs for generated hostnames and public routes.
- Fixed `pnpm smoke:deploy` so the documented control-plane smoke command runs
  without extra environment setup.
