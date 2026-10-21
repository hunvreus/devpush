# Changelog

All notable changes to devpush will be documented in this file.

## Unreleased

### Changed

- Hosted builds can add account email preferences through deployment UI API v9. Account/Admin back buttons are compact; their headings remain in normal page flow.

- Profile onboarding uses a compact Card with horizontal fields. Onboarding and account settings share clickable picture upload, drag-and-drop, and remove/reset controls.

- New accounts confirm their name and picture before entering a workspace, preserving invitation destinations. Deployment UI API v8 supports hosted-only newsletter and plan onboarding; apply core migration 0003 with a matching hosted build. Existing accounts are marked complete.

- Card outlines use the same theme border color as header and footer separators in light and dark mode.

- Hosted billing notices use relative trial countdowns across all team pages. The badge and approaching-expiry notice use translucent amber; expired/restricted notices use destructive colors. Triangle/circle icons distinguish warning/error states. Removed the pretrial welcome banner. Deployment UI API v7 removes the obsolete overview flag; no schema or agent migration is needed.

- Hosted trials include one server, start on first agent connection and use plain Trial labels. The workspace badge uses translucent brand orange while usable and destructive styling for restricted access. Trial explanations appear on the workspace overview and in server setup; notices moved below navigation into page content. Deployment UI API v6 requires matching core/hosted builds; OSS defaults remain empty and unrestricted. No agent or database migration is required.

- Hosted workspace trial status now follows the breadcrumb. Trials last seven days; failed renewal immediately restricts new operations. Hosted migration 0002 shortens existing trial deadlines and removes payment grace; deploy it with the matching hosted build. Running apps and agent connections remain available.

- Billing uses matching loading skeletons in settings, concise plan and usage details, and urgent-only workspace notices. Deployment UI API v5 adds the settings pending export; matching core/hosted builds are required, with no database or agent upgrade.

### Added

- Build-time deployments can add workspace access rules, authenticated endpoints and settings UI. The default self-hosted build remains unrestricted. Hosted-only billing uses these boundaries without adding payment providers to core.

- Shared-agent support for hub-issued wildcard certificates: durable local
  keys/CSRs, bounded polling, certificate validation, atomic Traefik file loading
  and installation acknowledgements. Hosted builds can advertise this through
  the additive `ingress.certificates.v1` capability; OSS configures no issuer and
  keeps existing nip.io/custom-domain behavior. Adding the watched file provider
  replaces an older managed Traefik container on its next routed deployment,
  causing a brief ingress restart. No public database migration is required.

- Versioned build-time server composition for a separate hosted application,
  with OSS defaults and optional hostname, server reconciliation and certificate
  services. The authenticated certificate endpoint supports pending/public-chain
  responses; no issuer or managed DNS is enabled in OSS. OSS nip.io/custom-domain
  behavior is unchanged; this addition requires no migration or agent upgrade.

- Optional public sign-in notice via `DEVPUSH_SIGN_IN_MESSAGE`, displayed in an
  informational alert with safe web links. Unset or blank hides it. The Admin
  editor and its settings-version counter have been removed. Before applying
  `0002_remove_installation_settings`, move any saved message to the environment
  variable; the migration drops its former table. Existing migration history is
  preserved. Restart/redeploy the control plane after configuring the message;
  no agent upgrade is required.

- Installation-operator deletion recovery CLI: inspect blocked resources, retry
  container cleanup, remove intentionally retained runtimes through normal agent
  jobs, and record verified manual job/archive cleanup. Mutations require an
  inspection revision and explicit apply, with atomic audit records; normal
  retention and hostname-release safeguards remain in place. No schema or agent
  protocol migration is required.
- Cleanup claims and completions now carry an attempt number so delayed reports
  cannot finish a reclaimed job. Breaking cleanup capability change to
  `jobs.compose.cleanup.v2`; upgrade the control plane and agents together and
  drain old pending completions first. No schema migration is required.
- Maintenance removes eligible deleted account/project/server/team database
  records after 30 days, preserving unresolved jobs, backup artifacts, retained
  runtimes and surviving resources. Avatar storage failures remain retryable.
  Hostname reservations remain until the agent confirms container removal.
- Linked GitHub/Google tokens are encrypted at rest using `BETTER_AUTH_SECRET`.
  Maintenance rewrites existing account tokens in bounded batches with concurrent
  refresh protection. Keep the secret stable and upgrade control-plane instances
  together; older binaries cannot read rewritten tokens.


- Flat documentation with product, operations, reference and developer navigation groups; focused local setup, configuration, testing and agent-maintenance guides. `pnpm docs:check` validates navigation and local links.


- `pnpm secrets:pull` restores local configuration from individual fields in the
  tagged `devpush (local)` 1Password API Credentials item, using a Keychain-held service-account
  token and writing the ignored environment file with owner-only permissions.

- Agent installer `--address IP` pins a routing address and disables automatic IP discovery. `--address auto` restores discovery. `vm:install URL` enrolls the local VM with its reachable IP for generated HTTP nip.io links. Requires updated agent and control plane; no database migration.

- Local VM setup uses macOS VZ/vzNAT networking and prints the VM's directly
  reachable IP, without forwarding host HTTP(S) ports. Existing owned VZ test VMs
  can be upgraded to vzNAT without deletion.

- Simple `vm:setup`, `vm:test`, `vm:stop` and `vm:destroy` commands create and
  manage a dedicated Lima test VM. Compose/Traefik tests run directly against
  its Docker installation, with no Docker-in-Docker layer.

- Consistent settings concurrency protection for projects, teams, account profiles, servers, backup policies and storage. Conflicts preserve drafts and show a persistent Sonner toast with a confirmed Reload action. No host-agent upgrade is needed for settings concurrency.

- Breaking API/MCP contract change: integer `settingsVersion` replaces timestamp `revision`; server rename and backup-storage updates/deletes now require the resource's current version.

- Descriptive browser and social titles for every app page, with dashes between page, project and team context and a pipe before devpush.

- Invitation recipients can decline from Notifications or an invitation link. Declining removes the pending invitation and invalidates its link without joining the team; only its active, verified recipient can perform the action. No migration is required.

- API keys offer 1-day, 180-day, 1-year and Never expires options alongside 7/30/90 days, retaining a 30-day default. The release schema permits nullable expiry and preserves permanent revocation semantics.

- Optional `DEVPUSH_MCP_URL` configures the full canonical assistant endpoint independently of agent and browser-auth origins. Public endpoints require HTTPS; changing the URL requires OAuth clients to reconnect.

- Public management API with scoped account API keys, pagination, safe response models, registered errors, settings-version checks and atomic idempotent writes. OpenAPI is generated from actual handlers and validated.

- Remote MCP tools reuse the management API, with scoped API-key authentication or per-assistant OAuth consent and revocable connections in Account settings. API/MCP are included with self-hosting.

- Backup and restore diagnostics upload over HTTP into the existing central log database with retry deduplication and 14-day retention. Requires agents built with this release; historical jobs have no retroactive logs.

- Editable Compose service comboboxes for routing, database backups and restores,
  with custom names for future deployments. Selected backup volumes use chips
  with known suggestions and custom names, separate from all-volume mode.

- Separate public IPv4 and IPv6 discovery and storage, IPv4-preferred generated URLs, and DNS instructions/verification for both families. Requires updated host agents.

- Engine-specific PostgreSQL, MySQL, MariaDB and MongoDB backup targets with generated
  restore commands and immutable engine metadata. Legacy PostgreSQL cluster
  archives require manual restoration. MongoDB backups require
  updating the host agent for archive filenames.

- Separate Volumes and Databases sections for Compose volume archives and database dumps, with generated
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

- Added a unified interactive `pnpm configure` wizard for local development,
  Cloudflare Workers, and Docker Compose, including GitHub App manifest setup,
  generated secrets, and confirmed Cloudflare R2/D1 provisioning without
  requiring edits to the tracked Wrangler configuration.

- Added a first-class Cloudflare Workers deployment target with D1 or remote libSQL,
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
  maintenance endpoints, and opt-in online SQLite backups.

- Added shared agent request validation and focused deployment-filter,
  project-settings, and backup helper tests.

- Added the new TanStack Start control plane scaffold in `app/`.

- Added the Go agent scaffold in `agent/`.

- Added root architecture, development, and protocol documentation.

- Added a minimal Docker Compose web example for remote validation.

### Changed

- Optional workspace settings appear after Members. Deployment UI API v4 adds
  workspace status, notices and a contextual action for allowance-blocked server
  creation; self-hosted builds continue without billing UI or limits.

- Reorganize documentation around first deployment, app management, installation
  operations and development. Add step-by-step domain/HTTPS and self-hosting
  guides, separate advanced host commands, and clarify routing, rollback,
  server trust and backup limitations. All documentation stays flat under `docs/`.

- Keep the app navigation logo neutral, transitioning to brand orange on hover or keyboard focus in both color modes.

- Switched the application to shadcn/ui Taupe in light and dark modes, with a
  slightly lifted dark page background below the card surface. Theme
  tokens live in a separate stylesheet shared through the marketing site's docs
  import; orange/violet charts and the white light-mode background are preserved.

- Use the current devpush mark for the Apple touch icon and email logo.
- Exclude runtime uploads from Git and Docker build contexts.

- Flattened pre-release migrations into one fresh `0000_initial` baseline per
  database, with matching Drizzle snapshots and all current guards/indexes. This
  retires the old upgrade chain; existing data must be backed up/exported and the
  databases recreated. No installed database is changed by this source update.
- Split public API dispatch, shared resource access, read operations and mutations
  into separate modules; removed a fixture-only backup upsert and its unused
  listing/summary helpers from production code.

- Routine server heartbeats retain `updated_at`; server lifecycle transitions still advance it. GitHub push deliveries update the project row only when its repository name changes.

- Backup settings save only the selected policy, preserve its creation date and use its own settings version. Project General and Build & deploy saves update their intended fields; stale environment lists are never automatically retried.

- Redeploy and rollback dialogs use vertical Environment, Commit, Branch and Message summary rows, matching backup and invitation summaries.

- Invitation dialogs use labeled Team and Role rows with the avatar beside the team name. Connected-app revocation uses an icon button with a tooltip, matching other table actions.

- Dockerfile Go and Node base images are pinned to verified multi-architecture index digests for reproducible builds. Update the tag and digest together when upgrading those bases.

- Trusted Node proxies now restore request URLs only to configured app/auth/MCP origins, fixing HTTPS origin checks, redirects and HSTS behind TLS termination. Proxies must overwrite the forwarded protocol and host headers; untrusted forwarding headers remain ignored.

- Recovery documentation distinguishes database snapshots from uploads and configuration backups, and architecture documentation states the current storage guarantees for provider credentials versus MCP tokens.

- Repository actions refresh expiring GitHub user access through Better Auth and persist rotated credentials. Expired or rejected refresh credentials show a safe retry/reconnect error instead of sending expired access tokens to GitHub.

- Hetzner setup releases its local creation reservation after documented validation, authorization or capacity rejections. Ambiguous service/network outcomes retain the reservation and creation is never retried automatically.

- Agent heartbeats recheck live server status and credentials before updating connection state, preventing an in-flight heartbeat from undoing server disable or deletion. Pending-credential promotion is atomic with the heartbeat update.

- The production scheduler keeps running after failed HTTP calls, bounds connection/request timeouts and retries failed maintenance on the next minute tick. Maintenance also runs after scheduler startup instead of waiting for the next hour boundary.

- Interrupted account-cleanup jobs are reclaimed after ten minutes within their retry limit. Claim checks protect database cleanup and completion from stale workers; avatar cleanup finishes before a job reports success. No migration or agent upgrade is required.

- Team URLs reserve the built-in Settings, Invites and Uploads routes during renaming, creation and account bootstrap. Existing team slugs are not renamed automatically.

- Project creation honors an explicitly selected Compose file and runs automatic root-file detection only when no path is supplied.

- Account email changes require approval from the current verified mailbox and verification of the new address, rechecking the installation allowlist before saving. Verification-email delivery failures are reported instead of silently succeeding. GitHub and Google sign-in require verified provider email addresses.

- Connected apps uses a compact table ordered Status, App, Scope, Access and Expires, followed by unlabeled actions, with status badges, muted scope/access/expiry metadata and consistent outer padding and loading skeletons. Scope shows the team avatar with a full-name tooltip, then All projects or the actual project avatar/name; multiple-project grants show up to three avatars, a count and full-name details. Missing restricted project details appear as Unavailable project. Its header keeps the inline MCP URL and copy icon as one action for empty and populated lists, preserving muted text without an underline while the copy icon fades smoothly to full opacity on hover/focus, respecting reduced-motion preferences. Account keeps API keys and browser-authorized connections adjacent. This adds display metadata only; no migration or protocol change is required.

- Connected apps shows each connection's access and expiration alongside its scope. API-key and MCP consent forms label the separate deployment/application log permission as “Allow access to logs”.

- API-key and MCP consent scope selectors show team and project avatars in their options and selected values.

- API keys and connected apps use the existing settings empty-state layout with a clear next step. API-key creation remains in its empty state; the Connected apps MCP URL copy action stays inline in the header sentence.

- Team invitations use the standard dialog layout and width, with a muted description beneath the title.

- Notifications use a masked unread dot instead of a counter. Invitation dropdown rows and dialogs follow the legacy layout, including relative time/inviter metadata, team-specific titles, full expiry dates and compact team/role rows.

- About devpush appears directly below Help in the user menu. Notifications remains a separate header icon button with more spacing before the avatar; Help keeps its muted external-link arrow.

- The app uses the shadcn Neutral theme with Nova styling, Inter and Lucide, preserving the white light-mode background and orange/violet chart colors (600 in light mode, 400 in dark mode).

- Deployment badge tooltips use “Latest successful deployment” and “Previous successful deployment”.

- Admin allowlist search and pagination run on the server with 25 rules per page, preserving access to the full rule set. Documentation uses user/developer guides and a ReallySimpleDocs navigation manifest, with current API and runtime support documented.

- Manual deployment commit options reuse a 30-second cache when reopening the dialog. Backup and restore log viewers reuse cached output and poll only newly appended bytes, preserving output during refresh failures and close animations. No migration or agent upgrade is required.

- Server details render independently of chart history. History responses retain representative peaks and gaps instead of sending every raw sample; chart code loads separately, and cached history refreshes less often. No migration or agent upgrade is required.

- Backup policy rows show Run directly, with Settings and View activity in their text-only action menu.

- Policy names in backup activity filter Activity by that policy; settings remain available through the policy Settings button.

- Backup activity uses label-only metadata tooltips, medium-weight IDs and muted policy names; contents metadata is omitted from rows and action menus use text-only entries.

- Backup activity includes shortened operation IDs and metadata tooltips, omits server metadata, and groups logs/details in vertical action menus. Policy menus offer View activity and Run backup beside Settings. Status tooltips show only the status; log dialogs explain the operation and 14-day retention.

- User navigation removes the Default team shortcut. Account avatars fall back to initials when an image fails.

- Lists keep compact single-line rows with truncation, responsive secondary details and contained horizontal scrolling; backup Latest badges sit before actions. Mobile navigation collapses ancestor labels, truncates the current item and scrolls tabs. Help and About live in the avatar menu; invitations are accessed through the notification button.

- Light-mode success indicators use green-600; dark mode retains green-400.

- Failed/error indicators use CircleAlert; canceled operation indicators use CircleX.

- Status colors are consistent across deployments, backups/restores, servers, selectors, filters and toast icons: destructive failures, theme-aware green success and neutral canceled states.

- Backup activity marks the latest run per policy; deployment Current and Previous badges explain their meaning on hover. Restore details use concise summary copy.

- Development agent transport resets return an HTTP 502 and retain diagnostics without broadcasting an error overlay to unrelated browser tabs.

- Deployment, log and backup loading filters show their default All labels inside disabled selects.

- Restore details use regular foreground text for the recorded message, with a muted label.

- Restore activity uses a Details action with clearer outcome copy; historical Docker volume targets display their Compose names without changing recorded errors.

- Restore and Info dialogs show the current server status icon. Restore details lists Started first, uses colored status icons, and places the retained error message immediately beneath Status.

- Backup Activity shows volume, database and remote indicators as separate metadata items. Deployment list timestamps show the full UTC date and time on hover.

- Backup policies have a Backups action and Activity policy filter available to members. Restore and Info dialogs use bordered Backup, Volumes and Databases lists; Info includes a separate Restore result list with status and actual start time.

- Saved custom-domain hostnames are read-only; add and verify a new hostname before removing the old entry. Environment, route and HTTPS settings remain editable.

- Domain DNS guidance uses a neutral alert with a theme-aware amber warning icon and heading, combined instructions above the DNS table, muted diagnostics below it, and a primary Verify button. Clarifies that one matching A or AAAA record is sufficient.

- Domain verification uses a standard destructive alert with a circle-alert icon and directly visible error details.

- Backup Activity replaces History, removes the unimplemented Canceled filter, uses natural-width controls and offers Reset filters. Restore and Info dialogs share grouped volume/database rows with muted labels and per-item archive sizes.

- Restore summaries separate Environment and Server, use regular text, and separate rows with borders. Unknown environment dots use matching skeletons, list action blocks use a negative right margin for alignment, and backup history uses the existing server status icons.

- Backup history environment and server names link to their corresponding history filters, preserving other active filters.

- Restore history uses a text-only Info action. Log dialogs retain their contents during the closing animation and stop polling immediately on close.

- Restore dialogs use a two-column summary for creation time, policy and environment, with separate volume/database checkbox lists and muted empty states. The replacement warning appears in the description. Read-only Details shows each restore’s recorded selection.

- Copy buttons omit tooltips while retaining copied checkmark feedback and accessible labels.

- Restore dialogs use a compact checklist of volumes and databases, selected by default and restored together. Local/remote copies are deduplicated; destination names come from the backup. No agent protocol or database migration is required.

- The About dialog uses a narrower layout.

- Field copy buttons use compact input-group sizing and right-side alignment consistent with shadcn.

- The favicon and About dialog use a white logo on orange.

- Monitoring charts use orange and violet, with 400 shades in dark mode and 600 shades in light mode.

- Copy icons for IDs, install commands and backup locations use a Copy tooltip, then show a check icon and Copied tooltip for 1.5 seconds instead of success toasts. Clipboard failures use inline tooltip feedback.

- Deployment list status icons have tooltips consistent with backup history.

- Backup history groups Restore and icon-only Logs actions, uses ArrowDown for backup and Undo2 for restore badges, and removes underlines and the redundant View error action. Recorded errors remain available in the log viewer.

- Backup history uses compact activity rows instead of table columns, with status icons and environment colors in filters.

- Domain warnings use amber status headings, keep Verify inside the warning,
  and use shadcn Collapsible for technical details.

- Backup volume/database rows follow editable-list headers, borders and destructive
  remove actions. Volume names accept typing and suggestions; database help appears in the section description.

- Domain verification failures use per-domain alerts and DNS guidance; hostname
  validation remains separate. Deployment dialog loading matches its five-row limit.

- Backup policy switches replace status icons; manual runs require confirmation.
  Volumes and Databases have separate sections with editable Compose service inputs.

- Simplified backup policy icon actions, grouped backup storage
  fields, and moved storage removal into its settings dialog.

- Put domain verification errors on their domain rows, removed domain status and
  required-field footnotes from routing forms, and top-aligned editable rows.

- Moved Admin settings above Account settings in the user menu.

- Updated the agent toolchain to Go 1.27 and added a stable `version` command
  used by the installer summary.

- Scoped Worker database clients to individual fetch and scheduled invocations
  while Node uses SQLite files or configured remote libSQL clients.

- Reduced the shared client entry chunk by moving server metrics and Recharts
  behind the server-detail route boundary and replacing simple route-filter
  schemas with a typed string allowlist. Reclassified build-only UI tooling,
  added focused browser-form regression coverage, and pinned audited transitive
  dependencies to patched versions while aligning ESLint with its shared
  configuration.

- Reduced the production control-plane image by bundling its migration and
  agent-publication runners at build time instead of installing the complete
  development dependency tree in the runtime image.

- Added per-request SSR query hydration, bounded client query freshness and
  Better Auth session-cookie caching, persisted parsed Compose metadata at
  project write time, parallelized independent database and GitHub reads, and
  reduced optional Worker startup imports.

- Adopted the neutral Nova interface with Inter interface
  typography, IBM Plex Mono for code-oriented content, card-backed grouped
  lists, size-scaled rounded resource/account avatars, and medium-weight page
  section navigation. Environment-variable actions now use a shared button
  group, environment color selections use contrast-aware check marks, and
  charts assign series colors consistently from `chart-1` onward using a
  orange-and-violet palette with light- and dark-mode contrast. Metric readouts
  use tabular monospace numerals.

- Established SQLite main/log migration baselines with forward migrations,
  validated on SQLite, D1 and libSQL. Earlier devpush schemas are unsupported.

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

### Removed

- Retired local Cloudflare staging configuration and the old devpush test-tunnel
  autostart, connector files and stale credential backups. Local development uses
  Lima directly; production must be configured explicitly for its intended target.

- TanStack starter manifest/icons, unused logo variants and scaffolding metadata.
- Unused UI components, private exports, dependencies and an unreachable agent command wrapper.
- Uncalled account-identity backfill and backup helper APIs. Database-writing test fixtures now live under `src/test`, rather than in production services.

### Fixed

- Docker Compose now forwards `DEVPUSH_SIGN_IN_MESSAGE` to the dashboard.
  Production image validation starts the actual Compose stack and checks the
  sign-in notice, migrations and health. Validation uses Compose build arguments
  and the selected image consistently across services.
- Blank `BETTER_AUTH_URL` now falls back to the dashboard URL during server
  rendering, fixing Docker installations that leave this optional value empty.
  Compose health checks use IPv4 loopback to match the app listener.
- Docker builds exclude local environment files, databases, Cloudflare secrets
  and generated installation configuration from their build context.

- Recognize serialized missing-resource errors in route boundaries so stale project
  URLs show Not found instead of the generic crash screen.

- Preserve status, avatar and other semantic icon colors while highlighting select,
  dropdown and combobox options; remove descendant color overrides and their
  ineffective opt-out attributes.
- Show proper empty states for filtered deployments, repository and member searches,
  administrator user/allowlist results, account teams and empty service/volume
  suggestions. Empty deployment lists no longer collapse to a border.

- Upgrade TanStack Start to 1.168.60, its matching Router to 1.170.41 and the Seroval security override to 1.6.9, resolving the critical server-function reflected-XSS advisory [GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8).

- MCP consent identifies the callback host and explains app-name verification. Token exchanges have a separate rate budget from sign-in, and public auth requests cannot inject internal grant headers.
- Managed ingress reconciles pinned images, ports and ACME contact on deployment; agent reinstallation preserves the configured contact. Replacing ingress can briefly interrupt routing.
- Invitation resend rechecks pending status and management permission at the write; banning and unbanning preserves the default team.
- Workspace disconnects normalize reserved close codes, and unexpected public checksum failures no longer expose internal paths.

- Reused runtimes start a fresh cleanup/volume-retention window; pending cleanup skips runtimes assigned back to the server.
- Malformed retention settings are isolated to their policy instead of aborting the installation-wide maintenance sweep.
- Global maintenance expires queued and running backup/restore jobs on offline agents and releases their reservations.
- Redeploy and rollback resolve current routing without reviving removed hostnames, and reject environments moved to another server.
- Agent execution persists an interruption fallback before running; restart reports failure instead of leaving jobs running until timeout. Credential rotation drains active work and guards concurrent credential changes. Requires updated agents; no protocol or schema change.
- Local setup and secret synchronization share Node's environment-file parsing and round-trip-safe encoding, including multiline credentials.


- Close project creation immediately after a successful save, before refreshing
  cached data and navigating, so the repository-selection skeleton cannot flash
  during the handoff. Refresh/navigation failures cannot submit a second project.

- Hetzner test-server destruction waits for delayed Primary IP detachment or
  auto-deletion after the server disappears, instead of failing immediately.

- Retention skips deleted resources and unsupported remote snapshots without stopping other policies. Failed cleanup retries wait an hour, with the same eligibility rules enforced when work is queued.

- Backup runs and jobs store destination metadata instead of duplicate credentials. Claims load current workspace storage credentials while preserving historical locations. No host-agent upgrade is required for claim-time credential resolution. Pre-release remote snapshots without a storage ID cannot fall back to embedded credentials.

- Project/team/server deletion releases canceled backup-cleanup reservations, and retention does not enqueue work for deleted servers. Container cleanup retries consistently across server states and completion guards its job type and captured attempt.

- Deleting an account immediately invalidates invitations to its sole-owned teams; asynchronous cleanup rechecks that those teams still have no other members.

- Cloudflare storage now fails explicitly when R2/S3 is unconfigured; local upload and installation-version filesystem access stays in Node-specific modules.

- Backup API/MCP mutations now honor the installation feature flag and share browser validation and atomic writes, including storage reference protection, volume normalization and default archive prefixes.

- Clean settings forms refresh their values and version together; dirty drafts retain their original version across context refreshes and saves in other sections.

- The global notification toaster now follows the selected app theme, including route error pages.

- Settings conflict toasts use clearer copy and stacked Reload/outline Dismiss actions instead of a corner close icon.

- Public action errors use plain transport objects, so stale browser bundles do not require a custom serializer to show conflict codes. Concurrent Compose edits are covered in development and production HTTP checks.

- Settings conflicts now survive TanStack Start transport, including concurrent project/team renames. Failed settings actions use Sonner; stale drafts remain intact until a confirmed Reload.

- Avatar uploads use per-upload URLs and keep the previous object until settings commit. Rejected saves remove only the staged upload; cleanup is restricted to the owning account, team or project, including account-deletion jobs. No migration or agent upgrade is required.

- Team settings recheck current access and avatar state at the final write, and unexpected database failures no longer appear as slug conflicts.

- Admin deletion uses a dedicated authorized path for active or banned accounts, retaining shared-team ownership safeguards and rechecking admin access at the final write. Ban/unban cannot reactivate deleted accounts. No migration or agent upgrade is required.

- Account profile changes must use validated app actions; the unused generic auth profile mutation is disabled to prevent arbitrary avatar-path assignment.

- MCP streaming responses retain their serving instance through the final result, clean up on cancellation/failure and prevent proxy transformation. Real SDK tests cover delayed legacy responses and modern progress streams.

- Git commands disable inherited tracing and redact managed GitHub tokens and encoded authorization headers from captured diagnostics. Requires updated host agents; no protocol or database migration is needed.

- Host heartbeats exclude unrelated Compose projects and omit oversized managed inventories instead of sending invalid or truncated snapshots. Liveness and metrics continue, and host-switch checks still inspect all containers. Requires updated host agents; no protocol or database migration is needed.

- Control-plane and browser-auth origins require HTTPS outside local development hosts, even with an explicitly configured HTTPS MCP endpoint. App startup, configuration validation and updated agents reject insecure or noncanonical origins. Existing public HTTP installations must configure HTTPS before upgrading; no database or protocol migration is needed.

- Deleting a project while keeping its runtimes preserves hostname reservations so new projects cannot claim routes still advertised by the running containers. Reservations remain until explicitly cleaned up; manual container removal does not release them. No migration or agent upgrade is required.

- Captured runtime logs continue delivery after their runtime is replaced or its project is deleted, using historical deployment ownership on the original server. Agents prune inactive outbox files only after full acknowledgment and retain failed captures. Upgrade the app before agents; no database migration or protocol change is required.

- CI actions use verified full commit pins, and newly created agent ingress/volume utility containers use verified multiarchitecture image digests. Existing ingress containers are preserved. Updated agents are required for image pins; no protocol or database migration is needed.

- Worker smoke tests run live D1 fixture commands asynchronously so HTTP timers, socket events and local server output remain responsive during seeding.

- API request fingerprints use locale-independent key ordering across runtimes. Server-disable confirmation and documentation explain queued work, running apps and active-job timeout behavior.

- Backup requests require an explicit policy when multiple enabled policies match, rather than choosing an arbitrary destination. Single-policy requests remain supported.

- Referenced backup-storage deletion returns HTTP 409. API rename collisions now report `PROJECT_NAME_CONFLICT` instead of `OPERATION_CONFLICT`, without admitting work.

- Agent job claims and timeout guards retain exact stored JSON snapshots rather than reserializing payloads. Backup polling bounds contention retries while preserving queued work and stale-snapshot race checks.

- Route validation agrees across app and agent: query/fragment paths and comma prefixes with stripping are rejected, while literal dollars are escaped in generated Compose values. Update host agents for the matching route validation and rendering fix.

- MCP authentication distinguishes invalid credentials from server failures, preserving safe diagnostics without turning outages into reauthorization prompts.

- Successful sign-out and account deletion clear private query data before navigation; failed sign-out preserves the current session's cache.

- Trusted reverse proxies use only `DEVPUSH_CLIENT_IP_HEADER` (default `x-forwarded-for`, rightmost entry), ignoring unselected spoofable headers. Existing proxies that overwrite only `X-Real-IP` must explicitly select `x-real-ip`.

- Branch wildcards cannot match by overlapping their fixed prefix and suffix. API Compose-path changes discard metadata from the old file while unchanged paths retain it.

- Tokenized agent installers reject malformed enrollment tokens, and the root update helper reads the control-plane URL as data instead of sourcing the agent environment file. Rerun a trusted installer to refresh an existing host's update helper.

- Updated Seroval, source-map-js, Sharp, Vitest, fast-uri and brace-expansion to patched releases; the dependency audit reports no known advisories. Worker type definitions match Wrangler's supported version.

- Agent diagnostics redact every token-bearing repository URL in an output line, including repeated and truncated URLs. Requires updated host agents; no protocol or database migration is needed.

- MCP rate-limit responses preserve browser access and retry headers, and failed requests release their serving instance.

- Local development stop commands verify the process command and checkout before stopping it, preserving unrelated processes when a PID file is stale or another app uses the same port.

- Public API parsing rejects prototype-named request fields instead of silently accepting malformed input. Validation-error formatting safely handles prototype-named paths without exposing internal diagnostics.

- Team and project avatar initials retain their resource color when a select option or menu item is highlighted.

- Project, team and account actions expose registered public errors while hiding unexpected internal diagnostics. Settings field validation and bulk invitation feedback remain actionable.

- Manual deployment loads the latest five commits only for the selected branch, preserving all matching branches and caching each selection for 30 seconds.

- Admin user search and pagination run against all accounts, removing the newest-50 cutoff. Server actions expose explicit public error codes, hide unexpected diagnostics from clients and retain server-side logs.

- Project and server list metadata stays grouped on the left, with actions pushed to the far right; loading rows use the same alignment.

- Compose environment values preserve quotes, backslashes, dollar signs and multiline content. GitHub clone credentials stay out of command arguments and checkout configuration; unused deployment checkouts and env files are pruned while container references are retained. Requires updated host agents.

- GitHub push deployments survive repository renames, capture commit author/time/URL, and record failures when the assigned server is disconnected or its agent needs updating. Valid signed deliveries bypass shared-IP throttling; existing work is preserved when a push is blocked.

- Lost-agent deployments fail after ten minutes without heartbeats, with an atomic recovery guard. Cron authentication uses constant-time secret comparison.

- Lint errors and warnings are corrected; control-plane switching no longer copies an agent mutex.

- Local Node development no longer broadcasts disconnected-client connection resets as Vite errors to every browser tab. Errors on connected requests remain visible, with request-path diagnostics.

- Backup history links Policy names to their settings and places Started immediately after Policy; deleted policies retain a non-clickable label.

- Backup history uses secondary type badges, icon/count contents with hover details, compact Restore buttons and View error dialogs for failed restores.

- Backup history uses status icons, type badges, policy names and compact volume/database/remote summaries. Backup rows offer an outline Restore button; failures display a single destructive alert.

- Overflowing tables and backup history use the app scrollbar styling, including loading states.

- Backup policies group an outline Run button with an outline Settings icon, including loading states. Labeled Run and Visit buttons no longer repeat their labels in tooltips.

- Table text columns use consistent outer padding, including loading states, while action columns retain their compact spacing.

- Deployment lists group small outline Visit buttons with a muted trailing arrow and vertical ellipsis buttons; loading rows retain the same controls.

- Restored the neutral app theme, with orange/violet metric series at 600 in light mode and 400 in dark mode, and orange-600 backgrounds for the About logo and favicon.

- Project and server lists use a single small outline Settings icon button linking to their settings; server installation and administrative actions remain on the details page.

- Backup history lists each backup and restore separately, with type filters, relative timestamps and UTC tooltips, clearer file storage summaries, and icon restore actions. Logs refresh now sits beside the filters.

- Project logs loading keeps known filter defaults visible and centers “Loading logs” with a spinner inside the viewer.

- Use the extra-small Verify action in domain alerts.

- Keep domain error-details triggers visually neutral and show error content without padded backgrounds.

- Show domain DNS record instructions using the environment’s assigned host server public IP, matching verification.

- Use a regular domain alert with amber icon and title, and verification in its action area.

- Allow additional manually named backup volumes after all suggested volumes have been selected.

- Show the required secret access key error alongside all other backup storage field errors on creation.

- Preserve the restore dialog when switching backup files and reset destination fields without replaying overlay animations.

- Keep direct new-project route dialogs mounted through query loading, matching the launcher and avoiding loading-overlay remounts.

- Keep the new-project dialog mounted while its lazy-loaded contents arrive, preventing a close/reopen flicker on the first launch after refresh.

- Label the About chat link Discord and show devpu.sh/docs and devpu.sh/chat as link text.

- Rename the invitation action and dialog to Add members and the email field to Email addresses.

- Restore the member invitation textarea’s default multi-row height and normal Enter behavior while retaining automatic growth and no resize handle.

- Remove secret-storage help text from both new and existing backup storage dialogs.

- Start member invitations at one textarea row, shorten instructions, skip existing members, and report invitation results through toast summaries instead of inline counts.

- Combine member invitations into one auto-expanding email textarea, skip duplicate and invalid addresses, and submit with Enter while Shift+Enter inserts a new line.

- Place Community before GitHub in About and reduce the logo tile corner radius.

- Move backup storage removal to the table row, retaining confirmation and inline failure handling.

- Show a masked, read-only saved backup storage secret when editing, without replacement help text.

- Match backup storage secondary columns to the muted styling of other tables.

- Use a Discord chat label; present backup storage in a labeled table without metadata icons and mark only optional storage fields.

- Restore visible Engine and Database column labels in backup policy forms and keep database scope guidance only in the section description.

- Restored the unified d/P logo in the header and help dialog, with a size-4.5
  header mark, and updated the SVG favicon.

- Kept volume/database Add actions inside their respective empty states and added
  editable Compose service inputs with dropdown suggestions.

- Constrained the deploy dialog commit list so long messages and branch names
  truncate instead of expanding the list and footer beyond the dialog.

- Keep backup restore status in a Latest restore column, with its timestamp in a
  tooltip, so completed restores do not add a second row. Match the loading layout.

- Database dumps now contain gzip-compressed output matching their `.sql.gz`
  filenames and the restore reader. PostgreSQL local/R2 recovery was verified.

- Retention counts only runs with artifacts in each storage tier, so a failed
  remote upload cannot expire the last successful remote recovery point.

- Members no longer see backup Run controls that require owner/admin access.

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

- Fixed GitHub App manifest registration by accepting GitHub's generated webhook
  secret instead of submitting an unsupported manifest field.

- Clarified setup completion with one ordered deployment path, deferred GitHub
  App installation to the in-product project flow, and simplified the local
  GitHub manifest callback page.

- Generated readable unique GitHub App names, and clarified that CLI deployment
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

- Collapsed server metric summaries into one latest-sample query,
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
