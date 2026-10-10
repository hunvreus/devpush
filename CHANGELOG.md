# Changelog

All notable changes to devpush will be documented in this file.

## Unreleased

### Added

- Engine-specific PostgreSQL, MySQL, MariaDB and MongoDB backup targets with generated
  restore commands and immutable engine metadata. Migration 0006 converts known
  presets and pauses unsupported custom-command policies; migration 0007 marks legacy
  PostgreSQL cluster archives for manual restoration. MongoDB backups require
  updating the host agent for archive filenames.

- Unified backup targets list for Compose volumes and database dumps, with generated
  dump filenames and clearer backup summaries that exclude metadata and duplicate copies.

- Live restore status and timestamps beside backup runs, with queued/running
  progress, terminal results and expandable failure details.

- Durable 24-hour host metric history, ordered acknowledged uploads, and
  retry deduplication recover charts after connection outages. The host-side
  `devpush-agent metrics resync` command replays retained history after hub
  data loss. The new heartbeat metric contract requires updating both agent
  and control plane; no database migration is required.

- Help modal with the installed version and website, documentation, GitHub and
  community links. Installation admins access Admin through their user menu.

- Owners and admins can remove unused backup storage connections. Policies,
  active backups and retained remote artifacts block removal, with database
  guards protecting references during concurrent changes. Buckets and backup
  files are never deleted by removing a connection.

- Workspace notifications through hibernating Cloudflare WebSockets, with
  a Node WebSocket broadcaster, reconnect recovery and HTTP polling fallback
  for blocked connections.
  Idle workspace and project deployment lists discover new webhook deployments.

- Agent maintenance progress messages for draining, restart, reconnection, and
  rollback, with explicit postponed-update feedback when draining times out.

- Root-only agent maintenance commands for job-draining updates and empty-server
  control-plane switches, with isolated credentials and rollback on failed
  connection confirmation. Installers reject implicit origin changes and use
  the safe update path for running agents.

- Hetzner test-server resource tracking and resumable cleanup of the created
  server and Primary IPs, with a preview before deletion.

- A standalone Hetzner test-server helper with live option discovery, a preview
  mode, SSH key selection, and startup execution of a devpush install command.

- Optional remote libSQL/Turso databases for Node and Cloudflare Workers,
  with separate state/log URLs and tokens, setup prompts, atomic write batches,
  migrations, and integration coverage. Local files still use better-sqlite3;
  Workers use D1 when no remote URLs are configured. Cloudflare setup and
  migrations follow the selected storage without requiring D1 resources for libSQL.

- Workspace owners/admins can add and edit reusable S3-compatible backup storage
  in workspace settings. Project policies select a saved destination instead of
  storing duplicate credentials. Backup runs preserve their original storage
  location for restore and retention; credential rotation applies to existing
  backups. Legacy policy connections are migrated to workspace storage.

### Fixed

- Keep backup restore status in a Latest restore column, with its timestamp in a
  tooltip, so completed restores do not add a second row. Match the loading layout.

- Database dumps now contain gzip-compressed output matching their `.sql.gz`
  filenames and the restore reader. PostgreSQL local/R2 recovery was verified.
- Retention counts only runs with artifacts in each storage tier, so a failed
  remote upload cannot expire the last successful remote recovery point.
- Members no longer see backup Run controls that require owner/admin access.

- Supervise the shared macOS development tunnel with a login LaunchAgent that
  restarts the connector after exit; document error 1033 diagnosis and the
  local app/laptop availability requirements.

- Cold-loading backup lists preserve the Policies and Runs layout, with visible
  disabled controls, filters and column labels instead of a loading paragraph.

- Failed remote backup uploads preserve completed local files, expose failure
  alerts per policy and run, and allow restoring retained local artifacts.
  Failed-upload archives participate in local retention without being reported
  as successful remote backups.
- Backup policy status follows the policy ID rather than another policy in the
  same environment.

- Manual backup runs are started from the chosen policy’s Run action, removing
  ambiguous buttons that silently selected the first policy.
- Completed deployment header selectors retain idle polling as recovery when
  WebSocket notifications are unavailable.

- Backup storage settings use the same empty-list presentation and outline Add
  action as other settings lists, with the action beneath populated entries.

- Audited icon sizing across views and UI primitives. Standalone icons and
  compact indicators resist flex shrinking; deployment confirmation uses the
  same commit icon size as lists and details. Input groups, badges and grouped
  controls preserve icon dimensions when space is constrained.

- Standalone server icons use 16px in lists and deployment details, and commit
  metadata icons use 20px to compensate for their short glyph. Both resist flex
  shrinking; matching loading placeholders preserve their dimensions.

- Backup policies hide the automatically managed bucket folder and group the
  storage select with a settings action. Pending views match the controls and
  descriptions; deletion-dialog checkboxes use the shared Field layout.

- Backups use concise policy actions, muted environment labels and a separate
  direct Restore button. Restore dialogs separate Source and Target with a
  downward arrow in a vertical layout, show filenames, creation time and size,
  offer full-path copying beside the filename, show a dialog-wide restore warning, and use
  Compose names for targets. File selection stays inside the dialog.

- Deployment loading keeps metadata row heights stable, uses known icons and
  cached deployment values, and centers the log loading message with a spinner.

- Team settings show known deletion restrictions immediately, or a disabled
  delete button while eligibility is checked. Deployment loading retains its
  known actions; backup-policy loading uses database dump rows rather than an
  empty-state placeholder.
- Deployment completion retains displayed logs while fetching the final
  snapshot. Log reads retry transient failures twice; exhausted failures use a
  destructive Alert and retry action without moving the log viewer or implying
  deployment failure. Status, duration, and alias slots keep stable widths when
  a deployment completes.
- Restored the legacy deployment selector in the project header. Its selected
  status and recent-deployment rows observe the detail query's live updates;
  cold loading keeps the known deployment ID and disabled selector visible.

- Cached workspace navigation waits until hydration completes, keeping the
  initial client header consistent with server-rendered loading markup.

- Broadcast deployment preparation failures and agent job timeouts so idle
  workspace and project views receive terminal status updates.

- Deployments verify every generated route over HTTPS before reporting success;
  generated hostnames and custom-domain verification also support public IPv6.
- Rollback retains full commit SHAs instead of overwriting them with shortened
  agent references. Backup restore resolves physical archive volume names while
  requiring Docker labels that identify the destination runtime.
- Runtime log collection uses bounded, resumable time windows rather than a
  200-line source tail, and reports collection failures in application logs.
- Read-only server members get owner/admin guidance for agent updates.
- Workspace member settings are read-only and omit invitation controls.
  Backup list policy management and restore actions respect member permissions.
- Backup policy loading shows disabled form controls matching known sections;
  member policy views hide management actions and preserve all-named volume
  selection even when repository metadata is stale.

- Workspace and project server-connection warnings use consistent neutral styling
  and link all workspace members to the affected server. Members also get guidance
  to contact an owner/admin; missing assignments still link to project settings.

- Loading views now preserve known server identities, enrollment and metric
  states, and cached project/team/settings content. Workspace project placeholders
  match the card grid; settings lists match their tables. Sign-in, invitations,
  logs and conditional backup views avoid speculative skeleton controls.
  Disabled action controls and copy buttons now remain visible during loading;
  account, workspace and project forms use their loaded field spacing, and known
  project identities and environment rows are retained. Loading animations respect
  reduced-motion preferences. Server metrics retain their chart layout with centered
  loading messages; pending danger actions remain visible and disabled. Lightweight
  workspace responses no longer flash an empty metrics state before charts load.
  The header avatar placeholder keeps the loaded menu button’s size and spacing.

- Replaced the Compose deployment-mode selector with optional pre-deploy,
  deployment, and rollback command overrides. Rollback reuses the deployment
  command with `DEVPUSH_ACTION=rollback` unless a rollback command is set.

- Server lists and detail pages refresh status every five seconds while visible
  and on tab focus, so enrollment and disconnects appear without manual reloads.

- Hetzner test-server availability validation reads the API's flat location IDs
  and reports unavailable capacity instead of crashing before creation.

- Team/project overview refreshes preserve cached deployment results, including
  empty results. Repository filtering is immediate; account changes show loading
  until that account resolves, and refresh failures preserve project-creation inputs.

- Loading collections show content-shaped rows rather than placeholder empty states.
  Team overview displays confirmed empty data immediately, including during navigation.

- Team name/avatar saves update cached headers and team switchers directly,
  preserving existing page data without a route reload. Deployment lists now
  poll only their owning query, pause while hidden, and stop after completion.

- Authenticated pages send their loading layout before fetching private data.
  Navigation uses consistent 150ms pending feedback and a 200ms minimum display.
- Mutations invalidate affected team/project caches before navigation; route
  loaders honor Query freshness and refresh expired shared project/server data.
- Runtime logs continue polling after deployment completion. Deployment logs
  fetch a separate final snapshot so a late running poll cannot hide final output.

- Rapid deployment/log filter changes preserve other selected filters, and failed
  filter navigation shows actionable feedback. Repository loading during project
  creation supports inline retry; its loading dialog can be dismissed.

- Backup policy deletion confirms before writing and keeps request failures in
  the confirmation. Backup run/pause actions share pending locks. Sign-in
  handlers reject repeated submissions while email or code verification is pending.

- Backup detail edits survive context refresh. Shared validation reports retention,
  destination and dump-command limits at their fields; pending saves lock the
  editor and request failures appear as form errors rather than name errors.

- Backup restore dialogs wait for API acknowledgement, preserve failed commands
  for retry, and validate targets/command lengths inline. Policy creation no
  longer resets unfinished edits on refresh; pending edits/dismissal are locked,
  names respect the server limit, and cron checks use the scheduler parser.

- Manual deployments show retryable option-loading errors and lock selection
  and dismissal while queueing. Redeploy, rollback and project deletion keep
  failures inline and block pending dismissal. Successful project deletion
  cannot be repeated when navigation fails.

- Server assignment forms include newly created environments without reloading,
  preserve unsaved selections during context refresh, and keep failures inline
  with pending edits locked. Environment definition saves preserve persisted
  server assignments instead of sending stale assignment values.

- Environment settings mark required fields, validate names/identifiers/branch
  rules inline, and retain failed edits with pending controls locked. Typing
  `production` in a new row no longer locks that row against correction/removal.

- Environment variable forms validate required and duplicate keys inline, lock
  edits while saving, and preserve failed submissions. Invalid environment scopes
  cannot replace saved variables. `.env` imports reject malformed lines without
  partial insertion and preserve quoted whitespace and multiline values.

- Route/domain settings validate individual fields and duplicates before saving,
  keep request failures inline, and lock controls during saves/verification.
  Saving routes preserves unsaved domain edits.

- Repository loading failures can be retried inside the repository picker.
  Invitation acceptance blocks cancellation while pending and prevents repeated
  acceptance after a successful request, including when navigation fails.

- Project creation shares client/server constraints, rejects duplicate environment
  keys, reports general failures at form level, and prevents edits or dismissal
  while creating. Completed creation cannot be repeated if navigation fails.

- Server enrollment failures now wait for explicit retry in both server views.
  Server deletion from the list loads usage diagnostics; inspections can be
  retried and stale responses are ignored. Status/deletion confirmations keep
  failures inline and cannot be dismissed while pending.

- Team role, ownership, removal, invitation revocation, and deletion
  confirmations now keep request errors in the dialog, prevent pending
  dismissal, and close after success. Typed removal/deletion confirmations
  are checked again by submit handlers.

- Account email changes share client/server validation, show request failures
  inline, and lock edits while sending verification. Account disconnect, leave,
  and delete confirmations block pending dismissal and retain failed requests
  for retry. Completed account deletion cannot be submitted again.

- Team creation and invitation forms validate shared constraints inline and
  lock edits and dismissal while pending. Bulk invitations continue past failed
  addresses, report creation separately from email delivery, and retain only
  failed addresses for retry.

- Admin allowlist forms validate rules and imports inline, preserve failed
  submissions, and prevent pending dismissal. Bulk email imports use one atomic
  JSON-backed insert to avoid SQLite parameter limits. Admin confirmations now
  remain open during requests, show failures locally, and close after success.

- Project general and build settings share browser/server validation, show
  field-specific errors, support keyboard submission, and preserve edits after
  failed saves. Pending saves lock both sections; timeout inputs accept any
  whole second within the supported range.

- Avatar selections in account, team, and project settings ignore cancelled or
  superseded file reads, show read progress, and block saving until the image
  is ready. Project image inputs allow retrying the same file.

- Team settings now share browser/server validation for names, slugs, and
  avatars and show field errors inline. Account/team general settings support
  form submission and prevent edits during saves. Server create/edit forms
  validate names consistently; pending server creation cannot be dismissed.

- Account settings now mark required fields, validate before saving, and display
  name, username, and avatar errors beside the relevant control instead of a
  generic toast. Client and server use the same validation schema.

- Audited UI action failures across account, team, project, backup, deployment,
  repository, server, and admin screens. Sign-out and GitHub connection failures
  now surface errors; failed copies and email changes no longer report success.
  Failed confirmation actions stay open, failed log/repository loads remain
  distinguishable from empty results, and polling failures warn about stale data.
  Post-save refresh/navigation failures no longer report the completed write as
  failed. Project and backup actions await navigation before ending busy states.

- Added immediate sending/verifying feedback to email sign-in and kept controls
  disabled after successful verification until navigation leaves the page.
  OTP send failures now return an error instead of false success, and resend
  failures are displayed on the code-entry screen.

- Replaced technical UI errors (including `HTTPError`, database diagnostics,
  and HTTP 5xx messages) with action-specific explanations. Connection failures
  and rate limits now include guidance; validation messages remain visible.

- Encoded raw SQL dates and booleans for D1, fixing email sign-in requests
  failing in the rate limiter before reaching the email provider.

- Deferred Worker database initialization until first use so Cloudflare upload
  validation can complete before resource bindings are available.

- Corrected secrets-file argument quoting in Cloudflare deploy and validation commands.

- Restored the MIT license and original copyright notice from version 0.4.6.

- Enabled checked array and map access in TypeScript, retained missing-row database
  guards, and repaired the full lint gate.
- Removed obsolete PostgreSQL CI configuration; added libSQL integration coverage
  and built Worker smoke checks for D1 and remote libSQL, including scheduled cleanup.
- Updated Cloudflare tooling and vulnerable transitive dependencies; retained
  shadcn styles locally while removing the installed component-generation CLI.

- Wired native installations to separate persistent SQLite state and log files,
  and Workers to two D1 databases. Updated setup, migrations, Docker packaging,
  and online backups of both native stores; removed the PostgreSQL dependency.

- Persisted captured runtime logs on agents until a complete storage
  acknowledgment, retried failed uploads across restarts, and chunked pending
  output per runtime without discarding other apps' captured lines.
- Added configurable seven-day monitoring retention with bounded maintenance
  cleanup and batched heartbeat service-state writes.
- Moved runtime output into separate SQLite log storage, preserved current
  assignment and permission checks, and added bounded expiration cleanup for
  stopped runtimes.
- Separated deployment output from atomic control events, preserved captured
  output across completion retries, and added bounded cleanup after deployments
  are removed.
- Kept all pending captured deployment output through upload chunking and agent
  restarts, including large completions and missing storage acknowledgments.
- Made team role changes and removals atomic with current permission and
  last-owner checks on SQLite and D1.
- Kept team creation, account bootstrap and invitation acceptance atomic on
  SQLite and D1, and checked default-team and last-owner restrictions when a
  member leaves.
- Made deployment failure events and status changes atomic in bounded batches,
  including concurrent timeout handling.
- Kept queue claims atomic on SQLite and D1, and updated successful deployment
  status and aliases together without moving aliases on completion retries.
- Made backup completion, artifact cleanup and stale job failure atomic on
  SQLite and D1, with guarded terminal retries and bounded artifact inserts.
- Batched runtime observation upserts and checked orphan cleanup against current
  assignments and jobs in one atomic reconciliation batch.
- Kept deployment enqueueing, superseded deployment cancellation, events and
  aliases atomic, including duplicate GitHub deliveries and hostname conflicts.
- Made backup and retention cleanup enqueueing atomic, with current eligibility
  checks and no duplicate cleanup under competing requests.
- Kept project domain and route replacements atomic and enforced unique project
  names under concurrent renames.
- Made project creation and environment replacement atomic on SQLite and D1,
  with retries when competing changes invalidate environment IDs or aliases.
- Kept server deletion atomic with current permission checks, job cancellation
  and monitoring cleanup, preserving the option to finish ongoing deployments.
- Made project, team and account deletion atomic on SQLite and D1, including
  cleanup jobs, credentials, hostnames and current permission/default-team checks.
- Bounded deletion cleanup jobs to 200 runtimes each while preserving all targets
  and the seven-day retained-volume purge delay.
- Prevented deleted accounts awaiting cleanup from satisfying last-owner checks
  or receiving ownership transfers.
- Kept encrypted OAuth identity replacement atomic when a write fails.

- Used the server runtime's direct peer address for self-hosted rate limits,
  removed the attacker-controlled user-agent fallback, and added bounded
  preflight and rate-limit handling for GitHub webhook bodies.
- Restricted host deploy and rollback command changes to team owners and admins
  while preserving container-scoped pre-deploy commands for project members.
- Confined selected backup and restore volumes to the target Compose runtime,
  and restricted backup policy and restore changes to team owners and admins.
- Confined backup files and remote prefixes to their assigned locations,
  grouped retention cleanup by server and storage tier, removed purged artifact
  records, and recover all changed volumes when a restore fails partway through.
- Removed devpush control-plane variables from agent child-process environments,
  preventing Compose interpolation from receiving the enrollment credential.
- Rejected production example secrets in Worker requests, scheduled jobs, and
  deployment validation, and updated vulnerable development-only URI parsing
  dependencies.
- Confined Compose paths to repository-relative files in both the control
  plane and agent, including protection against parent traversal and escaping
  symlinks.
- Matched project pending sections by route segment instead of substring, so
  teams and projects named `backups` no longer render the wrong pending layout.
- Trusted client-address headers only in Cloudflare or behind an explicitly
  trusted self-hosted proxy, preventing spoofed headers from bypassing rate
  limits or replacing an enrolled agent's discovered address.
- Unified Worker and self-hosted maintenance so both expire stale deployments,
  rate-limit rows, invites, and queued account-cleanup jobs.
- Limited project mutations to the context sections they actually use and
  deferred cached GitHub repository selection until after the new-project
  dialog renders.
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
- Added explicit Resend configuration to Cloudflare setup and hid email login
  when the deployed installation has no email provider configured.
- Reassessed every skeleton state and aligned project, deployment, log, backup,
  settings, server, repository-picker, and deploy-dialog placeholders with the
  final controls, card spacing, section counts, and responsive geometry.
- Made pending and loaded routes share the same settings layouts, section cards,
  headings, breadcrumbs, and navigation so their geometry cannot drift independently.
- Reused cached team and project shell data in pending routes so known avatars,
  names, tabs, route identifiers, empty states, and list geometry remain stable;
  only unresolved section data is skeletonized. Deployment rows now share the
  final 44-pixel row layout, and terminal placeholders match loaded log rows.
- Kept overview navigation links from also announcing themselves as current on
  nested team and project routes, so pending and loaded pages expose exactly one
  selected section.
- Repaired the frozen production lockfile and made validation accept either the
  Docker Compose plugin or the standalone `docker-compose` command.
- Kept configured OAuth providers visible after client-side login-route reloads
  by resolving login configuration exclusively on the server.
- Namespaced devpush authentication cookies so other applications running on
  different localhost ports cannot replace the devpush session.
- Blocked deployments, redeployments, rollbacks, and webhook deployments when
  the assigned agent requires a protocol update instead of leaving jobs queued
  indefinitely.
- Removed duplicated team, project, deployment, and log loader work; kept
  render-time reads free of bootstrap mutations and GitHub requests; and added
  route-accurate pending states for team, settings, login, invitation,
  deployment, log, and server screens.
- Fixed deployment-detail and project-log refreshes to invalidate their React
  Query entries instead of only rerunning router loaders, so active jobs and log
  streams cannot remain stale behind a working refresh control.
- Rejected unsupported avatar payloads at server-function boundaries, made
  repeated agent job completions idempotent, and added cross-team authorization,
  backup-artifact mapping, secret-tamper, and query-invalidation coverage.
- Made authenticated routes render their route-accurate pending layout before
  client-side data loading, removed nested project-list and deployment-list
  loader waterfalls, disabled automatic query retries for route failures, and
  invalidated section caches after team mutations.
- Closed request-scoped Hyperdrive clients through the Worker execution
  context, collapsed server metric summaries into one latest-sample query,
  bounded deployment log reads, moved the admin release lookup out of the
  initial render path, and moved stale deployment expiry from page reads into
  scheduled maintenance.
- Fixed Cloudflare config validation to parse JSONC, including generated
  trailing commas, instead of treating the file as strict JSON.
- Split stable team and project navigation data from section payloads, added
  leaf-route pending states, and kept project settings, logs, deployments, and
  backups inside the already-loaded application layout while their data loads.
- Encrypted project environment variables at rest, replaced Worker-local OAuth
  handoff state with expiring database state, and added persistent rate limits,
  public-origin secret validation, security headers, and strict avatar content
  validation.
- Isolated the Docker socket proxy on a private agent network, pinned Traefik
  and socket-proxy images, and reconciled existing installations away from the
  older shared-network topology.

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
- Added per-request SSR query hydration, bounded client query freshness and
  Better Auth session-cookie caching, persisted parsed Compose metadata at
  project write time, parallelized independent database and GitHub reads, and
  reduced optional Worker startup imports.
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
