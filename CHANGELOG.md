# Changelog

All notable changes to devpush will be documented in this file.

## Unreleased

### Added

- Added host-initiated staged agent credential rotation, checksum-verified manual agent
  upgrades, and optional systemd timer-based automatic updates.
- Added explicit production migrations, database health and authenticated
  maintenance endpoints, guarded migration adoption, and opt-in PostgreSQL
  backups.

- Added the new TanStack Start control plane scaffold in `app/`.
- Added the Go agent scaffold in `agent/`.
- Added root architecture, development, and protocol documentation.
- Moved the previous implementation into `legacy/` as reference material.
- Added a minimal Docker Compose web example for remote MVP validation.

### Changed

- Replaced the combined hostname and project-server cache model with a project
  default server and nullable environment overrides, separate generated aliases
  and custom domains, and deployment-time route snapshots.
- Removed duplicated environment route, variable, host, and project environment
  JSON caches; project contexts now derive current routing from canonical rows.
- Persisted environment position so first-match branch routing follows the
  configured order deterministically.
- Changed generated routes to the single-label `{prefix}-{IPv4}.nip.io` format
  and removed the implicit `devpush.app` fallback.
- Added explicit or automatic release-service selection. GitHub App
  installation identity remains mutable project integration state instead of
  being frozen into deployments.
- Simplified deployment persistence: removed redundant project and unused job
  columns, made repository and commit metadata complete at insertion, kept
  resolved settings in `config` and encrypted `env_vars`, and avoided
  duplicating repository, environment, server, or runtime metadata inside the
  deployment config.
- Linked deployment server summaries to server details, shortened the rollback
  action label, and restored structured environment and commit confirmation for
  rollback and redeploy actions.
- Standardized compact bordered list and summary rows at 40px and constrained
  deployment confirmation content to the dialog width.
- Separated expiring enrollment tokens from persistent agent credentials.
- Hid project backup controls and endpoints behind
  `DEVPUSH_BACKUPS_ENABLED`.
- Kept the team application frame mounted across team and project navigation,
  with index-route content and scoped project loading skeletons.
- Restored first-match environment branch patterns for manual and webhook
  deployments, with environment-specific commit lists and fixed-height loading,
  populated, and empty states.

- Prevented server detail views from rotating active agent credentials, and made
  disconnected-server alerts open the affected server.
- Reworked server monitoring around compact host identity and actual host
  uptime, while keeping heartbeat-derived connection status distinct from host
  or application availability.
- Split editable server settings from reported host details, placed last
  contact beside connection status, and made the server ID a copyable field.
- Decoupled heartbeat collection from blocking agent jobs, bounded heartbeat
  work, and added visible-page polling so server charts update automatically.
- Standardized live server-state refresh to 15 seconds across server and project
  screens, and restored series-color indicators in metric tooltips.
- Replaced index-based metric sparklines with simplified synchronized,
  timestamped shadcn/Recharts area charts, preserving missing-data gaps,
  removing clipped vertical-axis labels, and covering CPU, memory, disk usage,
  and network traffic in one metrics card. Disk I/O remains collected for
  diagnostics without appearing on the default dashboard.
- Added aggregate host network receive/transmit and disk read/write history,
  plus continuous Compose service state including Docker health and restart
  information on project environments.
- Hardened managed Traefik route generation by normalizing route path prefixes
  and rejecting query, fragment, whitespace, and backtick characters in route
  paths.
- Improved deployment failure messages for common agent-side failures, including
  repository fetch, missing Compose files, Traefik setup, Compose pull/build/up,
  release commands, and readiness checks.
- Added a local MVP validation command that runs typecheck, lint, app tests,
  control-plane smoke, agent tests, smoke-mode config validation, and the real
  Docker/Traefik agent smoke.
- Hardened remote MVP config validation for public URLs and numeric GitHub App
  IDs.
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
- Added server heartbeat history, host metrics, connection-state handling, and
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
