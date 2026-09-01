# Changelog

All notable changes to devpush will be documented in this file.

## Unreleased

- Replaced the Compose deployment-mode selector with optional pre-deploy,
  deployment, and rollback command overrides. Rollback reuses the deployment
  command with `DEVPUSH_ACTION=rollback` unless a rollback command is set.

### Fixed

- Enforced installation-admin and team server-management permissions in server
  services, made GitHub push handling idempotent per delivery and environment,
  signed GitHub App install state to the initiating session, required explicit
  invite acceptance, and rejected unsafe allowlist regular expressions.
- Kept remote backup credentials encrypted in queued jobs until authenticated
  agent claim, serialized scheduled backups per environment, corrected cron
  field and day matching, added type-specific stale-job deadlines, and made the
  agent durably retry completion delivery before claiming more work.
- Bounded agent and GitHub webhook request bodies, pinned tokenized agent
  installers to the configured control-plane origin, and kept inherited
  project-server assignments intact during runtime reconciliation, log
  ingestion, log retrieval, and server deletion diagnostics. Deleted servers
  can now finish bounded, retryable cleanup work without leaving their
  credentials usable afterward, while project, team, account, and server
  deletion consistently cancel incompatible backup work.
- Hardened GitHub App installation redirects against encoded and backslash-based
  cross-origin targets, and updated Better Auth to the patched 1.6 release line.
- Made setup writes atomic, preserved the last known-good Cloudflare
  configuration across interrupted reruns, verified reused Cloudflare
  resources, retained generated Worker variables as wizard defaults, and
  protected the local GitHub manifest page with a per-run token.
- Made the tracked Wrangler file a reusable installation-agnostic template,
  moved generated Cloudflare configuration to ignored files, clarified
  workers.dev and custom-domain origin setup, and combined migrations, agent
  publication, and Worker deployment behind `pnpm deploy:cloudflare`.
- Discovered the authenticated Cloudflare account and its workers.dev subdomain
  during setup instead of requiring users to enter account infrastructure data.
- Removed the redundant authentication-URL setup prompt; Better Auth now uses
  the control-plane URL unless an explicit environment override already exists.
- Grouped Cloudflare database setup logically by asking for Hyperdrive details
  immediately after PostgreSQL and before unrelated R2 storage details.
- Fixed GitHub App manifest registration by accepting GitHub's generated webhook
  secret instead of submitting an unsupported manifest field.
- Clarified setup completion with one ordered deployment path, deferred GitHub
  App installation to the in-product project flow, and simplified the local
  GitHub manifest callback page.
- Deferred Hyperdrive binding access until a Cloudflare request scope exists,
  generated readable unique GitHub App names, and clarified that CLI deployment
  is manual until continuous deployment is configured separately.
- Reassessed every skeleton state and aligned project, deployment, log, backup,
  settings, server, repository-picker, and deploy-dialog placeholders with the
  final controls, card spacing, section counts, and responsive geometry.
- Repaired the frozen production lockfile and made validation accept either the
  Docker Compose plugin or the standalone `docker-compose` command.
- Kept configured OAuth providers visible after client-side login-route reloads
  by resolving login configuration exclusively on the server.
- Namespaced devpush authentication cookies so other applications running on
  different localhost ports cannot replace the devpush session.
- Blocked deployments, redeployments, rollbacks, and webhook deployments when
  the assigned agent requires a protocol update instead of leaving jobs queued
  indefinitely.

### Added

- Added serial PostgreSQL integration tests and CI coverage for migrations,
  authorization, webhook idempotency, backup scheduling and secret delivery,
  stale agent jobs, Cloudflare builds, and the Go agent completion outbox.
- Added a unified interactive `pnpm configure` wizard for local development,
  Cloudflare Workers, and Docker Compose, including GitHub App manifest setup,
  generated secrets, and confirmed Cloudflare R2/Hyperdrive provisioning without
  requiring edits to the tracked Wrangler configuration.
- Added a first-class Cloudflare Workers deployment target with Hyperdrive,
  native R2 storage, version metadata, Cron Trigger maintenance, deployment
  validation, and an operations guide while retaining the Node.js/Docker
  self-hosting path.
- Expanded the server installer to provision Docker from its official package
  repository on supported apt-, dnf-, and yum-based systemd distributions,
  verify the initial agent checksum, detect port and host-firewall conflicts,
  suppress successful package-manager noise, restore the legacy `/dev/push`
  banner, print structured installation and completion summaries, and retain
  private timestamped installation logs with a stable `latest.log` link.
- Added an explicit custom Compose lifecycle mode with trusted deploy and
  rollback commands, bounded execution time, deployment environment contracts,
  managed-ingress validation, and final public readiness checks.
- Added terminal-first GitHub App provisioning through GitHub's manifest flow
  and optional S3-compatible object storage for avatars and agent binaries,
  with local persistent storage remaining the zero-configuration default.
- Added host-initiated staged agent credential rotation, checksum-verified manual agent
  upgrades, and optional systemd timer-based automatic updates.
- Added explicit production migrations, database health, authenticated
  maintenance endpoints, and opt-in PostgreSQL backups.
- Added shared agent request validation and focused deployment-filter,
  project-settings, and backup helper tests.

- Added the new TanStack Start control plane scaffold in `app/`.
- Added the Go agent scaffold in `agent/`.
- Added root architecture, development, and protocol documentation.
- Added a minimal Docker Compose web example for remote validation.

### Changed

- Updated the agent toolchain to Go 1.27 and added a stable `version` command
  used by the installer summary.
- Scoped Worker database clients to individual fetch and scheduled invocations
  while retaining the long-lived PostgreSQL pool for self-hosted Node.js.
- Reduced the shared client entry chunk by moving server metrics and Recharts
  behind the server-detail route boundary and replacing simple route-filter
  schemas with a typed string allowlist. Reclassified build-only UI tooling,
  removed the unused JSDOM test environment, and pinned audited transitive
  dependencies to patched versions while aligning ESLint with its shared
  configuration.
- Reduced the production control-plane image by bundling its migration and
  agent-publication runners at build time instead of installing the complete
  development dependency tree in the runtime image.
- Adopted the neutral Nova `b0` interface preset with Inter interface
  typography, JetBrains Mono for code-oriented content, card-backed grouped
  lists, size-scaled rounded resource/account avatars, and medium-weight page
  section navigation. Environment-variable actions now use a shared button
  group, environment color selections use contrast-aware check marks, and
  charts assign series colors consistently from `chart-1` onward using a
  indigo-and-pink palette with light- and dark-mode contrast. Metric readouts
  use tabular monospace numerals.
- Flattened the unreleased database history into one clean 1.0 baseline
  migration and validated it against an empty PostgreSQL database.
- Standardized every settings section navigation on one compact row style that
  matches the header resource selectors.
- Split agent deployment, maintenance, telemetry, and protocol behavior into
  focused Go modules; split project routing, environment settings, repository
  selection, backup policy, restore actions, Compose parsing, and project data
  mapping into focused TypeScript modules.
- Agent endpoints now return distinct payload, authentication, authorization,
  missing-resource, conflict, and internal-error statuses without exposing
  unexpected server exceptions.
- Local startup now applies committed migrations instead of pushing schema
  state directly, and validation commands no longer use pre-release MVP names.
- Removed unused UI primitives, stale mock data, dead exports, and unused direct
  dependencies; pinned previously floating TanStack and Nitro versions.
- Added explicit agent protocol and capability reporting so older agents remain
  connected while the control plane withholds jobs they cannot safely execute;
  agent release versions remain informational and additive payload fields are
  accepted during independent rollouts.
- Agent binaries now inherit the product version from `app/package.json`, and
  server details show an immediate metrics loading state while keeping the
  agent protocol version internal.
- Server metric cards now show the standard compact loading indicator during
  client hydration instead of empty bodies or oversized skeleton slabs.
- Consolidated Compose paths, lifecycle commands, release
  settings, readiness, and timeout into one type-discriminated project runtime
  configuration, and nested the resolved runtime in deployment snapshots and
  agent jobs so future runtime drivers do not require new project columns.
- Compose service configuration now uses plain inputs so branch-specific and
  future service names are not constrained by metadata from another revision;
  names are validated against the exact deployed revision.
- Pre-deploy commands now have an explicit target-service field, and rollback
  command overrides remain independently configurable from deploy overrides.
- Private Compose projects no longer require a release service unless a release
  command is configured.
- Made managed ingress authoritative: agents now preflight the exact Compose
  revision, ignore published ports and host networking with visible warnings,
  validate route service names, validate the final merged Compose model, and
  allow private deployments with no public routes.
- Added project-default routes with environment path overrides, removed the
  implicit `web:3000` fallback, and infer an initial root route only from one
  unambiguous declared TCP target.
- Restored explicit custom-domain DNS verification. Successful deployments no
  longer mark pending domains active, only verified active domains receive
  public routes, and verification records DNS failures against the
  environment's assigned server.
- Moved production migrations and remote agent-binary publication into a
  one-shot Compose service that must complete before the app starts.
- Made deployment Visit actions use each deployment's generated alias instead
  of the environment's moving hostname.
- Persisted stable GitHub installation account IDs, synchronized installation
  lifecycle and account-rename webhooks, and added repository-based recovery
  when a project's cached installation ID becomes stale.
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
  `DEVPUSH_BASE_URL` origin must match the requested proof origin.
- Made `DEVPUSH_BASE_URL` the canonical control-plane and agent origin, with
  `BETTER_AUTH_URL` as an optional auth-only override that defaults to it.
  Existing agent config must rename `DEVPUSH_SERVER_URL` to
  `DEVPUSH_BASE_URL` or be regenerated by the installer.
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
