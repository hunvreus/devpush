---
description: Authentication, schemas, pagination and mutation guarantees for the supported devpush management API.
---

# Public management API

The supported management API is rooted at `/api/v1`. Its resource IDs are stable
across name changes. The browser's generated TanStack Start transport URLs remain
private implementation details. The [host-agent protocol](/docs/agent-protocol/)
uses separate credentials and is not the public management API.

The [operation reference](/docs/api-operations/) lists the implemented
operations. `GET /api/v1/openapi.json` serves OpenAPI 3.1 from the exact request and
response schemas used by the handlers. The document is validated against the
OpenAPI schema in tests. Unsupported browser workflows are omitted rather than
advertised as placeholder endpoints.

## Make your first request

Create a scoped key in **Account → API keys**. Store it outside source control,
then send it to your installation (not the marketing site):

```sh
curl "https://YOUR-DEVPUSH-HOST/api/v1/projects?limit=25" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY"
```

A list response contains `items` and `nextCursor`. Use the returned cursor to
continue; do not assume the first page includes every project. For writes, read
[Idempotency and jobs](#idempotency-and-jobs) before retrying a request.

For assistant setup rather than API implementation, use
[API keys and AI assistants](/docs/api-and-mcp/).

## Authentication and scopes

Create user-owned credentials in **Account → API keys**. Every key targets a team
and an optional project allowlist. Use `Authorization: Bearer KEY`. Requests do
not fall back to browser cookies or accept agent/enrollment credentials.

Effective access is the intersection of the issued scopes, role ceiling, current
membership/role, active account/team state and selected projects. Membership IDs
bind credentials to one membership instance. Removing and re-adding a member does
not restore its old credentials. Bans and inactive teams permanently revoke the
associated credentials.

Read-only projections omit encryption data, agent credentials, enrollment
secrets, provider tokens and environment-variable values. Variable metadata is
readable; values are externally write-only. Logs require `logs:read` separately
because application output may contain secrets. Project-restricted keys cannot
perform whole-team management or enumerate unrelated servers and storage.

The key-creation UI grants Read only, Deploy or Manage presets, filtered by the
issuing role. Log access is an additional opt-in. These scopes are enforced by
both the REST handlers and MCP tool execution:

| Scopes | Granted by | Minimum current and issued role |
| --- | --- | --- |
| `projects:read`, `servers:read`, `deployments:read`, `backups:read` | All presets | Member |
| `logs:read` | Separate log permission | Member |
| `deployments:write` | Deploy and Manage | Member |
| `projects:write`, `secrets:write` | Manage | Member |
| `servers:write`, `backups:write`, `backups:restore`, `projects:host-commands` | Manage | Admin or owner |

Operations can impose further restrictions: deleting a project requires a
team owner or admin even though ordinary project edits use `projects:write`. Creating a
project or managing team storage/servers requires an unrestricted team grant.
API keys default to 30 days. The creation UI offers 1, 7, 30, 90, 180 or 365 days,
or no expiry; see [API keys](/docs/api-and-mcp/#api-keys). Browser-authorized MCP grants expire after 30 days.
Accounts may hold 100 active keys and 100 active MCP grants independently.

MCP OAuth tokens are accepted at `/mcp`; REST currently accepts API keys only.
OAuth token scopes are also a ceiling: narrowing a refresh request cannot regain
the stored connection's broader write or log permissions.

## Requests and responses

Use JSON bodies and `Content-Type: application/json` for writes. Unknown
top-level properties, duplicated query parameters, attempts to override path IDs in the
body/query, and oversized payloads are rejected. Maximum request body size is
128 KiB. The generated OpenAPI describes each operation's current fields.

Read operations return their resource or `{ "items": [...], "nextCursor": ... }`.
Lists default to 25 items and allow at most 100. Follow the returned cursor with
the same operation and filters. Cursors are signed and bound to the membership,
resource restrictions and query; a cursor cannot be transplanted into another
query. They are continuation markers, not a database snapshot.

GitHub installation, repository and deployment-option discovery fetches one
provider page per request. Permission and environment filters can produce an
empty page that still has `nextCursor`; continue until that cursor is null.

Log delivery also limits individual entries and the total returned bytes. A page
contains at most 100 entries and 256 KiB of log content, with per-entry truncation
reported explicitly. Retention can remove earlier entries, so responses expose
`retentionMayHaveRemovedEarlierEntries` rather than implying a complete archive.
Individual entries are limited to 64 KiB of UTF-8 content; pagination advances
past a truncated entry rather than returning its remainder on a later page.

Every REST API response includes `X-Request-ID`, `Cache-Control: no-store` and an
`Vary: Authorization` header. Requests with an Origin header must
match the installation origin; arbitrary browser origins are not permitted.

## Idempotency and jobs

All writes require `Idempotency-Key`, a nonempty string of at most 128 characters.
Create a fresh unpredictable key for each intended action. Reuse the exact key
and request payload only to retry that same action.

```sh
curl "$DEVPUSH_URL/api/v1/projects/$PROJECT_ID/deployments" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $ACTION_ID" \
  --data '{"environmentId":"ENVIRONMENT_ID","branch":"main"}'
```

The effect, accepted audit event and replay result commit in one guarded database
batch. Permission revocation before that admission prevents the effect.
Revocation after admission cannot undo a job already accepted for execution.
If access changes after admission, the response or a later replay can still be
denied. Revoked credentials do not retain access to the result. Check the
resource or job history with current authorized access before issuing a new
action when an earlier request's outcome is uncertain.
Concurrent retries return the original deployment/backup/job IDs and do not
cancel their own deployment by queuing another one. Reusing a key with different
input returns `IDEMPOTENCY_CONFLICT`.

When queuing a backup, specify `policyId` if its environment has multiple enabled
policies. Omitting it is supported only when exactly one enabled policy can run;
ambiguous requests return `BACKUP_POLICY_REQUIRED` without queueing work.

Replay records are retained for at least 24 hours. Scheduled maintenance removes
expired records in bounded batches. After removal, a sufficiently late retry can
be treated as a new action; do not use idempotency as indefinite job storage.
Poll the returned status URL and store the admitted resource ID instead.

Secret-bearing request fingerprints use a keyed digest. Configured secret values
are absent from platform responses, audit events and replay data.
Replay identity is bound to the membership, operation, target and idempotency
key. Rotating a credential does not reset a valid retry's identity; another
credential can replay it only after passing its own current authorization checks.

## Settings versions and destructive operations

Editable resources expose an integer `settingsVersion`. Configuration writes must
send the version returned by their latest read. A stale write returns HTTP 409
`SETTINGS_CONFLICT`; fetch the current settings and review the intended change
before submitting a new request. Replaying the same failed payload with a newer
version can overwrite someone else's edits.

Projects share one version across general/build settings, environments, server
assignments, routes, domains and variables. Backup policies, backup storage and
servers each have their own version. Creating a policy does not require a project
version; updating/deleting it requires that policy's version. Operational updates,
including heartbeats, metrics and job progress, do not advance settings versions.
Permissions, referenced environments/storage and version checks are enforced in
the same atomic write. Successfully admitted idempotent retries still replay the
original result.

Destructive operations require the confirmations specified in their input
schemas. Only eligible current roles can restore data or change host lifecycle
commands. The server rejects concurrent active restores for an environment.
Queued operations finish asynchronously through the existing host-agent jobs.

## Errors and rate limits

Errors have this shape:

```json
{
  "error": {
    "code": "SETTINGS_CONFLICT",
    "message": "The resource settings changed. Read its current settings version and try again.",
    "requestId": "REQUEST_ID"
  }
}
```

Validation failures can include bounded field errors. Unexpected diagnostics are
kept out of responses. Typical statuses are 400/422 for invalid input, 401 for
missing/invalid credentials, 403 for insufficient access, 404 for unavailable
resources, 409 for a stale `settingsVersion`, conflicting state or conflicting idempotency request, and 429 for
rate limits. Honor `Retry-After` and retain the request ID when reporting a failure.

REST and MCP share limits; creating another key does not reset a membership budget.

| Budget | Limit |
| --- | --- |
| Resource reads, per membership | 120 per minute |
| Writes, per membership and operation | 20 per minute |
| REST transport, per IP | 240 requests per minute |
| MCP transport, per IP | 180 requests per minute |
| MCP transport, per credential/IP pair | 120 requests per minute |
| Authentication-provider POST routes, per IP | 30 per five minutes |

Transport budgets include authentication and protocol traffic. Membership budgets
apply to resource operations. If a client IP cannot be identified, requests share
an unknown-address bucket. Configure [trusted proxy handling](/docs/configuration/#reverse-proxies).

Accepted operation audit records retain operation/resource IDs, not payloads,
for 30 days before becoming eligible for scheduled pruning.

## Other HTTP integrations

| Integration | Purpose | Authentication |
| --- | --- | --- |
| `GET /api/health` | Main database connectivity; HTTP 503 when unavailable | None |
| `POST /api/github/webhook` | GitHub events and push deployments | GitHub webhook signature |
| Agent endpoints | Enrollment, heartbeats, jobs and logs | Dedicated agent/enrollment credentials |
| Maintenance endpoints | Operator cron invocation | Configured cron secret |
| `/mcp` | Curated assistant tools over remote HTTP | API key or dedicated OAuth connection |

The health endpoint does not prove agents, GitHub, email, log storage or public
application routes are healthy. OAuth endpoints belong to the maintained auth
provider and should be consumed through its discovery metadata, not invented
callback URLs.

The canonical MCP resource URL defaults to `DEVPUSH_BASE_URL` plus `/mcp`.
Operators may set `DEVPUSH_MCP_URL` to another full endpoint, independently of
agent connectivity and the Better Auth issuer. OAuth credentials are bound to
that resource URL; reconnect clients after changing it. See
[Local development](/docs/local-setup/) for Lima configuration.

## Installation requirements

Use the installation's stable `DEVPUSH_SECRET_ENCRYPTION_KEY` for stored secrets,
cursor signatures and request fingerprints; see [Configuration](/docs/configuration/).
Apply both database migration sets before serving API traffic. Upgrade and
pre-release database rules are in [Production operations](/docs/production-operations/#release-database-baseline).
Writes use integer `settingsVersion`; clients must read the current resource
version before saving.

When `DEVPUSH_BACKUPS_ENABLED` is disabled, backup mutation operations return
`BACKUPS_DISABLED`; this applies to API-key and OAuth MCP calls as well as the
browser. Reads of existing backup records remain available. Policy creation uses
the same default destination prefix as the UI when the prefix is omitted;
explicit prefixes are preserved.
