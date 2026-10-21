# Architecture

devpush has two execution boundaries: a TanStack Start control plane and a Go
agent on each deployment server. The control plane never runs Docker. Agents own
Compose execution, Traefik ingress, host observations and local recovery state.

```mermaid
flowchart LR
  Browser --> App[Control plane]
  GitHub --> App
  Agent -->|Outbound HTTP| App
  App --> Main[Main database]
  App --> Logs[Log database]
  App --> Storage[Object storage]
  Agent --> Docker[Docker Compose]
  Agent --> Traefik
```

## Code ownership

`app/src/routes` defines loaders, guards, search contracts and route states.
Product UI and state live in `features/<domain>`. Generic shadcn primitives live
in `components/ui`; shared components need actual reuse. Runtime-independent
schemas and client helpers belong in `lib`, and authorization, persistence and
provider integrations in `server`. Agent code is separate under `agent/`.

Shared server services work on Node and Cloudflare. Vite aliases select database,
object-storage, version-reader and workspace-notification implementations.
Workers never fall back to local files. Agent HTTP routes validate requests and
delegate to typed services; browser, API and MCP handlers reuse domain logic.

See [Configuration](docs/configuration.md), [API](docs/api.md) and
[Agent protocol](docs/agent-protocol.md) for supported external contracts.

## Storage and atomic writes

| Store | Ownership |
| --- | --- |
| Main SQLite, D1 or libSQL database | Accounts, teams, projects, environments, servers, deployments, control events, jobs, observations, backup metadata, credentials, API audit and idempotency. |
| Separate log database | Deployment output, runtime output, operation diagnostics and log-cleanup cursors. |
| Local or S3-compatible object storage | Avatars and published agent binaries. |
| Deployment host | Runtime volumes, local backup archives and durable upload outboxes. |

There are no cross-database foreign keys. Log ingestion validates identity in the
main database before writing output. Every read rechecks current authorization.
Output writes are bounded and idempotent; an acknowledged upload is persisted or
deduplicated. Main-database queue and cancellation events commit with their state
changes; reads merge these with agent output from log storage.

All backends use guarded SQL statements and atomic batches. D1 does not support
application callback transactions. Admission predicates check live permissions
and resource state inside the final write, rather than relying only on an earlier
read. Builds and remote requests never hold database transactions open.

Node uses native SQLite or remote libSQL. Workers use D1 or a request-scoped
libSQL web client, closed after each statement or batch. The libSQL adapter keeps
positional result mapping so joined columns with duplicate names remain distinct.
Main and log stores have independent connection configuration.

Project runtime configuration is one type-discriminated JSON object. Compose is
the only supported runtime. Environments, aliases and domains have stable
relational identities. Backup policies remain separate because scheduling and
retention query them across projects; editing one policy updates one row and
preserves its creation timestamp. Runs represent executions; artifacts represent
independently retained local or remote files.

## Authorization and credentials

Installation administration is independent of team roles. `DEVPUSH_ADMIN_EMAIL`
selects the administrator; the earliest-created user is the fallback. Team
members may use projects and ordinary project settings. Owners and admins manage
servers, storage and privileged deploy/rollback host commands. Services enforce
these rules independently of UI visibility.

Membership changes check the actor, target role and remaining active ownership
inside the mutation. Ownership transfer promotes and demotes in one guarded
statement. Bootstrap creates a team and its owner together. Invitation acceptance
checks the pending token, verified email, expiry and active account/team in the
batch adding membership. Concurrent demotions cannot remove every active owner.

Project environment variables and backup-storage secrets are encrypted with
AES-GCM. Backup credentials live only in the current workspace storage record;
queued jobs and run history contain storage IDs and immutable locations. The
control plane decrypts current credentials only for a compatible authenticated
claim. Missing or foreign storage fails the job; historical ciphertext is not a
fallback.

Linked provider account tokens use reversible encryption as described below.
Protect databases, exports and encryption keys as secrets. API keys, OAuth access and
refresh tokens, authorization codes and agent credentials use hashed storage;
OAuth confidential-client secrets follow the provider's encryption policy.
Public origins require strong, distinct authentication and encryption secrets.

Avatar replacement uploads a unique object before committing its reference.
Only a successful save permits removal of the previous owned object; a rejected
save removes its newly staged object. Cleanup validates resource ownership and
does not trust arbitrary stored image URLs.

## Provider-token storage

Better Auth encrypts linked provider access and refresh tokens using
`BETTER_AUTH_SECRET`; account hooks encrypt ID tokens using the same codec.
GitHub account reads and Google identity parsing decrypt stored values before use.
Maintenance rewrites up to 100 existing plaintext account records per invocation.
Each rewrite compares the original access, refresh and ID tokens together so a
concurrent provider refresh is preserved. This uses the existing account columns
on SQLite, D1 and libSQL; no schema migration is required. Deploy all control-plane
instances together and retain the original authentication secret. API/MCP bearer
credentials use their existing hashed storage.

## Public sign-in notice

The public sign-in notice comes from `DEVPUSH_SIGN_IN_MESSAGE` in deployment
configuration. Login reads it without an installation-settings database query.
It has no Admin editor or concurrency counter; changing it requires a restart or
redeploy. Authentication policy remains separate, in the allowlist table.

## Settings consistency

Editable resources use an integer `settings_version`. A form captures its values
and version together. Save checks that version and current permissions, changes
only the intended fields, and increments the version in one write. Project
sections share one version; teams, accounts, servers, policies and storage have
independent versions. Dependencies are still validated at write time.

Clean forms adopt refreshed values and version together. Dirty forms retain their
original baseline, including when another section saves. Editors use immutable
resource IDs so navigation cannot reuse a different resource's draft.
Configuration-field triggers cover internal/provider changes; explicit settings
saves increment once, including no-op saves. Heartbeats, metrics, job progress,
sign-in activity and Compose metadata refreshes do not advance settings versions.
There is no monotonic `updated_at` trigger. Server heartbeats leave that lifecycle
timestamp alone; registration, credential promotion and connection-state changes
may update it. Unchanged GitHub push metadata does not touch the project row.

Stale saves return `SETTINGS_CONFLICT`. Browser forms preserve the draft and show
a persistent Sonner notification with Reload and Dismiss. Reload confirms before
discarding all page edits. Renamed projects/teams return a safe current URL.
REST/MCP return 409 with the same conflict code. There is no automatic retry,
merge or force overwrite. Expected action errors cross RPC as safe plain objects;
unexpected errors are logged server-side and replaced by a generic public code.
Field validation remains beside its input; save failures use Sonner.

## Deployment lifecycle

An environment has a stable runtime ID. Compose reconciles it in place using
`docker compose -p <runtimeId>`, preserving service identity and named volumes.
The effective server is the environment override or project default. Deployments
reach their project through their environment, rather than a second project ID.

Queue admission snapshots the repository ref, resolved runtime configuration,
expanded routes and encrypted environment variables. GitHub credentials are
resolved at claim time and never frozen in that snapshot. Enqueueing commits the
record, superseded-deployment cancellation, control events and generated aliases
in one batch. Duplicate GitHub delivery IDs skip every effect. Hostname collisions
roll back admission, and generated aliases cannot claim custom-domain names.

Claims select work inside a guarded update. A partial unique index permits one
running deployment per runtime. Claims and terminal writes recheck status; a
canceled or completed deployment cannot move aliases again. Completion persists
output before committing deployment state and successful environment/branch
alias changes. Timeout handling commits the failure event and terminal state
atomically, in bounded batches.

Redeploy and rollback create new deployment records using the selected commit,
runtime settings and environment-variable snapshot. Public routes are resolved
from current project routing, active domains and aliases, with a new deployment
hostname. They cannot restore a removed hostname. Historical replay rejects an
environment moved to another server; create a normal deployment there instead.
Queued job payloads are subsequently assembled from their deployment record.

The agent clones the exact revision using a short-lived installation token in
Git's child environment, not command arguments or persisted remote URLs. Compose
paths must remain inside the repository after symlink resolution. Checkout pruning
protects bind sources and Compose references of all containers, including stopped
ones; inventory failure prevents deletion.

The resolved Compose override removes published host ports and host networking,
keeps services on their runtime network, and attaches routed services to the
shared ingress network. A pinned Docker socket proxy on a separate internal
network serves Traefik. Application networks cannot reach that proxy.

Default deployment uses `compose up -d`; it is not a zero-downtime rollout.
Pre-deploy commands run in a selected Compose service. Custom deploy/rollback
commands run on the host with resolved variables and managed Compose paths.
They replace only the update operation; checkout, image preparation, reporting
and readiness checks remain managed. Commands using Compose must include the
managed override. See [Compose deployments](docs/compose-deployments.md).

All deployed repositories are trusted host code. Privileged services, bind mounts
and Docker access can reach host data. Role checks on host commands are not tenant
isolation, and project environment variables enter those commands' environment.
Use separate servers for mutually untrusted repositories.

## Agent jobs and recovery

Enrollment exchanges a one-hour token for a dedicated agent credential.
Registration and heartbeats prove possession of staged replacement credentials
before retiring old ones. Rotation uses compare-and-set guards and the host CLI
drains active work before restarting. Disable cuts authentication; deletion
permits only explicitly retained deployment/cleanup work.

The agent serializes claims, execution and completion delivery with a filesystem
lock. Before execution it persists a minimal failed-completion fallback containing
only job identities. The normal result atomically replaces it. After restart the
outbox reports interruption before claiming more work; it does not rerun a partial
restore or deployment automatically. A crash between the remote claim and local
persistence still relies on control-plane timeout recovery.

Completion and log outboxes survive restart. Credentials are attached at delivery,
not stored in pending files. Network errors and rejected acknowledgments retain
the report and block further claims. This deliberately avoids silently abandoning
results; [Agent maintenance](docs/agent-maintenance.md) covers recovery. Do not
turn a schema/identity failure into permission to discard a completion.

Deployments have deadline and lost-heartbeat recovery. Backup, restore and backup
cleanup jobs expire after 25 hours; queued jobs measure from availability, running
jobs from claim time. Periodic maintenance sweeps these globally in pages of 500,
so an offline agent cannot reserve an environment indefinitely. Per-agent polling
also sweeps its own jobs. Failure releases associated run/cleanup state with the
same claim and payload guards. Container cleanup uses separate bounded retries.

Backup execution creates a run and job together after checking current policy,
environment, storage and server. Schedule keys deduplicate each policy/UTC minute;
a partial unique index prevents simultaneous active backups in one environment.
Restore admission prevents another active restore for that environment.
Completion commits artifacts and run/job statuses together. Retention independently
selects generations for each tier with remaining artifacts, reserves cleanup and
releases failed reservations for a later retry. Remote archives preserve their
original location while credentials come from current storage configuration.
See [Backups](docs/backups.md) for contents, consistency and restore limits.

## Observations, logs and notifications

Runtime reconciliation decides ownership inside the cleanup batch. Active
environments, in-flight deployments and unfinished cleanup jobs protect a
runtime. Reassignment back to a server resets its observation cleanup timestamps;
a subsequent orphaning starts a new grace and seven-day volume-retention window.
Each cleanup job contains at most 200 runtimes.

Agents discover IPv4/IPv6 separately at startup and every 15 minutes, retaining
cached addresses after failed discovery. Installer `--address IP` persists a
routing pin and disables discovery; `--address auto` restores it. The pin takes
precedence over discovered addresses. Connection IP is monitoring metadata, not
routing configuration. Generated names embed the selected address; existing
hostnames are not universally rewritten after an IP change.

Metrics are saved locally before upload, retaining 24 hours and a checkpoint per
control-plane origin/server identity. Acknowledgments advance ordered batches;
replay uses original collection times. Collection gaps stay gaps. Server charts
fetch history separately from lightweight live status and downsample displayed
extrema without modifying stored samples. Monitoring retention defaults to seven
days; maintenance prunes bounded pages even for offline servers.

Runtime logs use per-runtime durable capture queues, content-hash deduplication
and acknowledged cursors. A full host queue pauses capture. Pending captures can
finish uploading after a runtime leaves the active list, using historical server
ownership, while reads still check current project permissions. Docker rotation
before capture can lose source output; captured output is retained until acknowledged.

Deployment output uses stable agent sequences and bounded replay chunks.
Backup/restore diagnostics use byte-cursor host files and central operation logs;
dump stdout is an artifact, never diagnostics. Operation logs retain 14 days,
with a 10 MiB per-job host limit and 100 MiB total budget. Maintenance removes
expired runtime output and orphan deployment output with durable scan positions.

Workspace notifications contain invalidation hints, not authoritative data.
Cloudflare uses one SQLite Durable Object per team with hibernating WebSockets;
Node uses a process-local broadcaster. Socket admission validates origin, session
and membership; broadcasts recheck active access and close revoked connections.
Notification failure cannot roll back an acknowledged mutation. Browsers batch
hints, reconnect with backoff and refetch authorized snapshots. Polling repairs
missed hints and handles unavailable sockets; hidden pages pause live refreshes.
A multi-process Node deployment needs shared pub/sub for immediate cross-process
notifications; recovery polling still works.

## Browser data ownership

TanStack Query owns cached section data and its 30-second freshness window.
Router loaders consult `fetchQuery` with no competing freshness window, reusing
fresh data and deduplicating requests. Intent preloading uses that same client.
These are in-memory caches, not persisted browser storage. Account/admin/auth and
invitation direct loaders do not all share that policy.

Loaders perform authorization and bounded reads. Normal page rendering does not
repair data, call GitHub or probe stored objects. Compose metadata is persisted
project state, refreshed during explicit workflows. API Compose-path changes
clear metadata from the old file. Mutations cancel older reads, invalidate affected
queries including inactive entries, then seed authoritative saved values.

Authenticated settings/team/invitation routes use client rendering; login keeps
SSR. Pending layouts preserve known identities, labels and disabled controls;
only unknown data becomes a skeleton. Cached empty lists immediately show real
empty states. Background errors retain visible data. Branch options fetch commits
only for the selected branch; logs fetch appended output with separate terminal
keys to prevent late running responses from hiding final output.

## External management access

`/api/v1` and `/mcp` share `server/api/operation-contract.ts` and the operation
executor. Explicit schemas validate inputs and safe DTOs; browser aggregate
contexts are never serialized as public resources. The catalog also generates
OpenAPI. Read projections, write dispatch and authorization context have separate
modules, rather than one catch-all handler.

API keys bind to a user, membership instance, team, optional project restrictions,
issued scopes/role ceiling and expiry. Every request checks current access;
credentials cannot revive after membership removal. Nullable expiry means no
scheduled expiration; finite durations are 1–365 days. OAuth grants always expire.
Write effects embed live authorization and commit API audit/idempotency records
atomically. The membership owns the shared operation rate budget. Accepted work
is not canceled by later revocation. These audit records are not a unified audit
trail for browser and background activity.

MCP uses the SDK's stateless fetch handler. Browser authorization uses the OAuth
provider for discovery, PKCE codes, opaque tokens, refresh rotation and reuse
revocation. The bridge additionally checks the active devpush grant and intersects
token scopes with it. API-key bearer authentication is supported separately.
Node supports DNS-pinned client metadata discovery; Workers use dynamic
registration without an unpinned-fetch fallback. Auth initializes lazily within
requests, rather than seeding resources during module import.

`DEVPUSH_MCP_URL` fixes the canonical resource/audience; the OAuth issuer uses
`BETTER_AUTH_URL`. This permits localhost MCP with a VM-reachable base URL.
Changing the resource URL requires reauthorization. API token/idempotency/audit
maintenance uses bounded pages; refresh reuse records survive until expiry.

## Deletion and retention

Deletion is a guarded soft-delete transition, not a full relational cascade.

| Resource | Immediate effects | Deferred or retained state |
| --- | --- | --- |
| Account | End sign-in, remove provider accounts, revoke keys/grants, queue cleanup. | Remove memberships, invitations and avatar; delete eligible sole-member teams; retain user/job records until final cleanup. |
| Project | Cancel affected work; keep hostname reservations until container removal. | Queue requested runtime cleanup and delayed purge; retained containers keep routes. |
| Team | Cancel work, mark resources deleted and revoke credentials. | Keep server/runtime references for cleanup. |
| Server | Cancel backup/restore work, release reservations, remove monitoring and mark deleted. | Preserve the chosen handling of ongoing deployments and permitted cleanup access. |

Settings owned by surviving teams/projects remain when a user leaves. Backup
policies, history and storage credentials do not cascade on soft deletion. Maintenance permanently removes eligible deleted resources in bounded batches
after a 30-day retention window. It deletes projects before servers and teams;
foreign-key cascades remove owned settings, backup metadata and credentials.
Pending/failed jobs, retained environments, recorded backup artifacts and unresolved
runtime observations block collection. Successful cleanup records remain for at
least 30 days so agents can retry lost acknowledgements. Project/team avatars are
removed before their owning rows; storage failures preserve the reference for retry.
Hostname reservations are released after successful deprovisioning, without
waiting for delayed volume purge or the metadata retention window. Intentionally
retained runtimes keep their reservations. External archives and failed cleanup
still require explicit resolution. Audit history survives resource deletion until
retention. Remaining lifecycle work is tracked only in [TODO](TODO.md).

Account cleanup fences attempts with claim time and attempt number; avatar cleanup
finishes before success. Container cleanup claims and completions carry the monotonic attempt number
under `jobs.compose.cleanup.v2`. A completion from an older attempt is acknowledged
without modifying the current attempt; SQL snapshot guards also fence concurrent
reclaims. Deleted servers can retry a retained cleanup completion even when idle. Retention ignores deleted resources and unsupported remote
snapshots, and failed cleanup waits an hour before automatic retry.

Operator deletion recovery builds guarded SQL batches in
`app/src/server/deletion-recovery.ts`. The CLI connects directly to the selected
SQLite, libSQL or D1 main database using installation-operator access. Inspection
whitelists fields; mutations require a snapshot revision, reason and explicit
apply. Each batch records the operator action before its guarded effects, so a
concurrent change produces no audit or mutation. Container retries preserve
attempts, retained-project cleanup uses normal agent jobs, and verified manual
resolutions retain evidence without inventing successful backup executions.
Final garbage collection still enforces its retention and external-resource guards.

## Migrations and repository hygiene

Main and log databases each start with a `0000_initial` migration and matching
Drizzle journal/snapshot. Append future migrations; never rewrite an applied one.
Migration runners reject unknown histories and populated untracked stores. D1
requires fresh baseline bindings. Source updates never reset data automatically.

`app/public` contains intentional branding/metadata assets, not starter icon sets.
Runtime `public/uploads` is application state. `knip.jsonc` records non-import
entrypoints and platform replacements; its output needs reference checks before
removal. Test fixture writers stay in `src/test`. Verification commands and schema
workflows live in [Testing](docs/testing.md), not this architecture reference.


## Build-time application composition

The default build uses `app/src/deployment/default.server.ts`. A separate private
application can select an absolute server entry with the build-time
`DEVPUSH_DEPLOYMENT_SERVER` variable. Vite resolves that entry into the bundle;
changing the running application's environment cannot switch implementations.
No private DNS, issuer or commercial implementation is distributed in OSS.

`app/deployment-api.json` versions the typed contract in
`app/src/deployment/contract.ts`. The selected entry declares its supported API
version and creates named optional services: generated hostnames, server
reconciliation/maintenance and agent certificate requests. Unknown services or
incompatible versions fail explicitly. A hostname provider failure never falls
back silently to nip.io. The OSS entry supplies no overrides and retains existing
nip.io generation and custom-domain HTTPS behavior.

Deployment API v2 provides bounded, paginated routing-state reads, including
soft-deleted servers, team status, agent capabilities and routing-retention checks. Agent/enrollment credential hashes are excluded. These
are trusted server-side extension boundaries, not public API authorization.
Reconciliation reads persisted state rather than relying on UI-only mutation
callbacks, so API changes and deletion can be handled too. It runs before private
hostname/certificate work; maintenance runs the provider before permanently
pruning deleted rows. A provider cleanup failure prevents that prune pass.
Implementations must make reconciliation idempotent, bounded and retryable.

The optional certificate endpoint authenticates the existing agent credential,
rejects deleted/disabled servers and inactive teams, then passes sanitized routing
state and an optional CSR/installation fingerprint to the selected service.
Without a CSR it returns the permitted wildcard name. Later requests return
pending timing or a public certificate chain. Private issuance validates the CSR
signature and names; core bounds and validates the service response.

The shared agent advertises `ingress.certificates.v1`. A hosted heartbeat enables
certificate requests and reconciles persisted address changes; ordinary OSS
heartbeats add no certificate requests or provider calls. The agent stores its key
and CSR atomically, validates the returned key/name/validity, writes versioned PEM
files and atomically updates watched Traefik YAML. It acknowledges the leaf's
SHA-256 fingerprint after saving the files. The hosted service gates deployment
URLs on acknowledged validity and renews within 30 days of expiry.

Only Traefik's dynamic subdirectory is watched. Request/installation JSON stays
outside that directory. Managed wildcard routes omit the ACME resolver label;
custom domains keep the existing HTTP-01 resolver. Updating an older ingress
configuration replaces its managed Traefik container on the next deployment.
This is an additive agent capability, not a protocol-version break. No public
issuer/DNS automation or schema migration is added. Private hosted state and
migrations stay in its separate database; retained routing references prevent
premature managed-DNS retirement.


Deployment API v3 also provides a narrow workspace mutation boundary, an optional
HTTP handler under `/api/deployment/*`, and an optional build-time settings UI.
Core supplies sanitized workspace counts and membership authorization. Private
deployments may serialize server creation and restrict invitations/deployment
enqueue; core owns the actual mutations, permissions and SQL guards. The OSS
provider returns no such services and renders no additional settings. Payment
providers, prices, subscriptions and trial persistence remain outside core.
`DEVPUSH_DEPLOYMENT_UI` selects the optional UI module alongside the existing
server entry; both are trusted build inputs, never runtime unlock flags.

Deployment UI API v7 supplies workspace status, page notice, server-setup notice,
settings and settings-pending components, plus a scoped upgrade action for rejected
server additions. Core renders status beside the breadcrumb, notices in page
content across team/project routes (including cached pending contexts), and settings
after Members. All OSS default exports are empty: prices, trials and payment
behavior live in the private build. Both compatibility manifests must match; no
agent or database upgrade is required for this UI boundary. The generic server-list
route accepts `addServer=1` to open its enrollment dialog.

Private UI source directories are registered with Tailwind only in their composed
build, so external component utilities are generated without adding private paths
or classes to OSS output. Stylesheet URL imports remain JavaScript modules and
are excluded from this CSS transformation.

### Profile onboarding

New users confirm their profile once before entering a workspace. The public core stores
`user.profile_confirmed_at`; existing accounts are backfilled by migration 0003. Profile
confirmation reuses avatar validation and optimistic settings-version checks. Safe internal
return paths preserve invitations and project links. Invited users skip hosted plan selection.

Deployment UI API v8 adds build-time profile fields and plan-onboarding UI. OSS renders no
commercial fields or plan step. Hosted may add optional newsletter consent and a workspace
plan screen; creating a new hosted workspace enters plan selection without repeating profile
confirmation. Newsletter credentials, consent delivery and subscription management stay private.

Deployment UI API v9 adds optional account preference content/navigation and its matching
pending view. Profile and account extensions receive the user ID only for isolated client
cache keys; hosted endpoints derive identity from the authenticated session. OSS exports
remain empty. Account/Admin headings and back buttons are normal-flow content.
