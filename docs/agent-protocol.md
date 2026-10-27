---
description: HTTP contracts and capabilities for deployment host agents.
---

# Agent protocol

This reference is for contributors changing the agent or control-plane protocol.
To connect or update a server, use [Servers](/docs/servers/) or
[Agent maintenance](/docs/agent-maintenance/) instead.

The agent receives jobs through outbound HTTP polling. Protocol changes must
preserve credential boundaries, capability negotiation and durable completion
reporting; product API keys cannot authenticate these endpoints.

`agentVersion` is informational release metadata. Compatibility is negotiated
with `protocolVersion` and additive capability names. The control plane keeps
registration and heartbeats available to older agents even when an update is
required before they can claim newer job types. Unknown request fields are
ignored so agents and control planes can roll out additive changes independently.
Hub and agent builds use the same product release numbering when cut from a
release, but their versions do not need to match. Development builds report
`dev`; release strings never decide protocol compatibility.

## Connection lifecycle

### Registration and polling

1. Agent registers with an expiring enrollment token at
   `POST /api/agents/register`.
2. Control plane returns the server ID and a dedicated agent credential.
3. Agent atomically stores that credential and sends periodic heartbeats to
   `POST /api/agents/heartbeat`.
4. Agent polls `POST /api/agents/jobs/next` for queued agent work.

Heartbeat payloads may include host `system` identity, `metricSamples`, `runtimeIds`,
and current Compose `runtimes`. `runtimeIds` is a cached list of managed `dp_`
Docker Compose project names observed from containers with the
`com.docker.compose.project` label. Unrelated Compose projects are excluded from
heartbeat inventory, while host-switch safety checks still inspect all projects.
If discovery fails or the managed inventory exceeds 200 runtimes, the agent
omits that inventory and continues reporting liveness and metrics. Runtime state
is also omitted if a managed runtime exceeds 500 services. Inventories are never
truncated: omitted means unknown. The protocol supports an empty array for an
observed empty inventory; the current Go sender omits empty slices.

```json
{
  "serverId": "srv_123",
  "token": "agent_token",
  "agentVersion": "1.0.0",
  "protocolVersion": 1,
  "publicIpv4": "203.0.113.10",
  "publicIpv6": "2001:db8::10",
  "capabilities": [
    "jobs.compose.deploy.v1",
    "jobs.compose.cleanup.v2",
    "jobs.backup.v1",
    "jobs.backup.archive.v1",
    "jobs.backup.cleanup.v1",
    "jobs.restore.v1",
    "runtime.logs.v1",
    "metrics.history.v1"
  ],
  "system": {
    "hostname": "app-01",
    "operatingSystem": "Ubuntu 24.04.2 LTS",
    "kernelVersion": "6.8.0-64-generic",
    "architecture": "amd64",
    "cpuCoreCount": 4,
    "uptimeSeconds": 22140
  },
  "metricSamples": [
    {
      "id": "a478749b42384752a5a7073b47534902",
      "observedAt": "2026-10-09T01:30:00.000Z",
      "metrics": {
        "cpuPercent": 12.5,
        "memoryUsedBytes": 2147483648,
        "memoryTotalBytes": 8589934592,
        "diskUsedBytes": 53687091200,
        "diskTotalBytes": 214748364800,
        "networkReceiveBytesPerSecond": 18432,
        "networkTransmitBytesPerSecond": 4096,
        "diskReadBytesPerSecond": 8192,
        "diskWriteBytesPerSecond": 16384
      }
    }
  ],
  "runtimeIds": ["dp_fb3167db1f_a1b2c3d4e5"],
  "runtimes": [
    {
      "runtimeId": "dp_fb3167db1f_a1b2c3d4e5",
      "services": [
        {
          "name": "web",
          "containerName": "dp-web-1",
          "state": "running",
          "health": "healthy",
          "restartCount": 0,
          "startedAt": "2026-08-02T20:00:00Z",
          "exitCode": 0
        }
      ]
    }
  ]
}
```

Registration and heartbeat metadata optionally include `routingAddress`, a pinned
IPv4 or IPv6 address. When present, it takes precedence over discovered families
and clears the other stored family, preventing an old IPv4 from overriding an
IPv6 pin. Without it, failed or omitted discoveries preserve known addresses.
Using installer `--address` requires the updated agent and control plane; this
is an additive protocol field and requires no database migration.

The control plane uses reported runtime IDs to reconcile leaked
devpush-controlled Compose runtimes. A runtime must be observed beyond the
grace window before cleanup is queued, and active environment runtimes,
in-flight deployment runtimes, and runtimes already covered by unfinished
cleanup jobs are kept. Reconciliation only auto-enqueues `deprovision` jobs;
if a deprovisioned runtime is still observed after the volume retention window,
reconciliation can also enqueue a volume-only `purge` job.

Heartbeat responses include `runtimeLogTargets`, the active Compose runtimes
the agent should tail for runtime/application logs:

```json
{
  "serverId": "srv_123",
  "status": "connected",
  "metricsAcceptedThrough": "a478749b42384752a5a7073b47534902",
  "runtimeLogTargets": [{ "runtimeId": "dp_fb3167db1f_a1b2c3d4e5" }]
}
```

Registration and heartbeat responses may include `credential`. Enrollment and
rotation use a staged handshake: the server accepts the current and pending
credential until the agent successfully authenticates with the pending value.
That request promotes the pending credential and retires the previous one.
The host initiates rotation with `POST /api/agents/credentials/rotate` using its
current server ID and credential. The plaintext replacement is returned once
for the agent to persist; the app does not initiate rotation.

Agent endpoints use consistent error statuses: `400` for malformed payloads,
`401` for invalid credentials, `403` for disabled servers or deleted servers
without permitted remaining work, `404` for
unknown jobs, `409` for invalid job state, and `500` for unexpected control-plane
failures. Deleted servers with permitted queued/running deployments or container
cleanup can continue authenticating for that work; deletion is not an unconditional
403 on every agent endpoint. Unexpected exceptions are logged server-side and
are not returned to the agent.

### Metric history acknowledgments

`metrics.history.v1` adds ordered batches of up to 240 `metricSamples`. Each
sample has a stable 32-character lowercase hexadecimal random ID, a UTC
`observedAt`, and a nonempty `metrics` object. The hub stores collection time,
not upload time. Its successful heartbeat response includes
`metricsAcceptedThrough`, equal to the last sample ID in the submitted batch,
only after the batch has been saved. Retries are deduplicated using a
server-scoped hash of sample ID as the existing metric row primary key.
Expired samples outside the hub's configured monitoring retention are acknowledged
without being reinserted. Heartbeat/connection history remains on hub receipt time.

The agent retains 24 hours locally even after acknowledgment, with a 3,600-sample
safety cap. Checkpoints are scoped by control-plane URL and enrolled server ID.
It uploads oldest pending records first; a missing, mismatched, failed, or lost
acknowledgment never advances the checkpoint. New samples continue to be saved
while the backlog drains. A new destination replays available history; returning
to a previously used destination resumes its saved checkpoint.

Run `sudo devpush-agent metrics resync` on the host to reset the active
checkpoint on the next heartbeat and replay retained samples. Use `--config`
for a nondefault config path. The command writes a request marker; it does not
edit the running agent's history or contact the hub. A request made during an
upload is processed by the next heartbeat. The command also works while the
agent is stopped. Samples collected while the host/agent was down do not exist;
expired samples cannot be recovered. Corrupt history is reported and preserved
for operator inspection rather than overwritten.

This replaces the old heartbeat `metrics` object and requires a coordinated
agent/control-plane upgrade for metric ingestion. The deployment protocol
version remains 1; metric support is identified by `metrics.history.v1`.
No database migration is needed. Older binaries continue to report liveness
but do not provide metrics through the new contract. Hub data loss after an
acknowledgment requires the host-side resync command.

### Control-plane switching

`POST /api/agents/switch` accepts `serverId`, the dedicated agent `token`, and
`action` (`prepare` or `rollback`). Enrollment tokens cannot authorize this call.

`prepare` atomically disables a connected source server only when it has no
assigned projects or environments, deployment history, or queued/running jobs.
It returns a signed `ticket`; disabled servers cannot authenticate or claim work.
An ineligible server returns HTTP 409. The agent separately verifies that the
host has no managed deployment state or Compose containers before preparing.

`rollback` also requires the returned `ticket`. It re-enables the source only
when its disabled status and update timestamp still match that preparation.
Invalid tickets are rejected, and an intervening change returns HTTP 409. The
ticket has no expiry; the server timestamp prevents reuse after another change.
Destination enrollment and heartbeat verification occur before preparation.
The CLI retains separate source/destination state and recovery files; see the
[maintenance workflow](/docs/agent-maintenance/).

## Deploy jobs

In the payload, `releaseCommand` and `releaseService` are the UI's **Pre-deploy
command** and **Pre-deploy service**. They run before service updates; they are
not the custom deploy-command override.

New ingress containers and the Alpine volume backup/restore utility use pinned
multiarchitecture image digests. Updating these dependencies requires verifying
the upstream index digest and Linux amd64/arm64 manifests, changing the source
constants and releasing updated agents. Upgrading the agent does not itself
restart ingress containers. On the next deployment, ingress reconciliation checks
image pins and configuration, pulls a replacement before removing an outdated
container, and preserves its certificate volume. Replacement can briefly
interrupt application routing.

The agent's `DEVPUSH_BASE_URL` must be an HTTP(S) origin without embedded
credentials, a path, query or fragment. HTTP is accepted only for loopback,
`.localhost` and `host.lima.internal` development hosts; other origins require
HTTPS. Public HTTP configurations must move to HTTPS before upgrading agents.

Deploy jobs target one server and include a deployment snapshot plus a
short-lived GitHub installation token. Project settings changed after the
deployment was queued do not mutate the claimed job.

GitHub authentication stays in the Git child environment rather than command
arguments or checkout configuration. Git commands discard inherited
`GIT_TRACE*` and `GIT_CURL_VERBOSE` settings; managed token and encoded
authorization values are redacted from captured output and command errors.

```json
{
  "type": "deploy",
  "id": "dep_123",
  "logStartSeq": 2,
  "repo": {
    "fullName": "hunvreus/flask-basics",
    "branch": "main",
    "token": "github_installation_token"
  },
  "project": {
    "name": "flask-basics"
  },
  "runtime": {
    "type": "compose",
    "path": "compose.yml",
    "projectName": "dp_fb3167db1f_a1b2c3d4e5",
    "action": "deploy",
    "releaseCommand": null,
    "releaseService": "web",
    "readinessPath": null,
    "deployCommand": null,
    "rollbackCommand": null,
    "timeoutSeconds": 1800
  },
  "envVars": [],
  "routes": [
    {
      "host": "flask-basics-203-0-113-10.nip.io",
      "service": "web",
      "port": 3000,
      "path": "/",
      "https": true,
      "stripPrefix": false
    }
  ]
}
```

`runtime.type` is the dispatch boundary for future runtime drivers.
`projectName` is the devpush-controlled Compose runtime name. Agents pass it
with `docker compose -p`, so user-provided top-level Compose `name:` values do
not control runtime identity. Runtime names are intentionally short to avoid
Docker network and container name length limits.

When routes are present, the agent writes a generated Compose overlay next to
the checked-out Compose file and deploys with both files:

```sh
docker compose \
  -p "$projectName" \
  -f compose.yml \
  -f devpush.compose.yml \
  up -d --no-build
```

The overlay attaches routed services to the shared `devpush-proxy` network and
adds Traefik labels. The user Compose file is not modified.

`stripPrefix` controls whether Traefik removes the route path before forwarding
to the service. For example, `/api -> api:8080` with `stripPrefix: true` sends
`/v1/users` to the service when the public request was `/api/v1/users`.

After `up -d`, the agent waits for Compose containers to be running and for any
Docker health checks to report `healthy`. `docker compose up -d` exiting with
zero is not enough for a successful deployment.

Rollback is modeled as redeploying a previous revision into the same environment
runtime. devpush does not currently keep multiple full Compose runtimes alive
for instant rollback because stateful services and named volumes would diverge.

## Cleanup jobs

Cleanup jobs target one server and remove devpush-controlled Compose runtimes
after a project or team is deleted. The control plane computes runtime IDs from
persisted environments and deployment history, then groups cleanup jobs by
server.

```json
{
  "type": "deprovision",
  "id": "job_123",
  "attempt": 1,
  "cleanup": {
    "runtimeIds": ["dp_fb3167db1f_a1b2c3d4e5"],
    "removeVolumes": false,
    "reason": "Project deleted."
  }
}
```

The agent removes Docker resources by the Compose project label
`com.docker.compose.project=<runtimeId>`. Deprovision jobs remove containers and
networks only. The control plane also enqueues a delayed `purge` cleanup job
after the retention window. Purge jobs use the same payload shape with
`removeVolumes: true`, causing the agent to remove matching Docker volumes too.
Deletion cleanup jobs contain at most 200 distinct runtime IDs per server. When
more targets exist, the control plane queues additional jobs without omitting
targets. Their delayed purge jobs become available seven days after deletion.

Cleanup completion is sent to `POST /api/agents/jobs/complete` with the cleanup
job ID:

```json
{
  "type": "deprovision",
  "jobId": "job_123",
  "attempt": 1,
  "status": "succeeded"
}
```

Cleanup capability `jobs.compose.cleanup.v2` requires a positive integer `attempt`
in claims and completions. Echo the claimed value unchanged, including interruption
reports persisted for crash recovery. Older attempts are acknowledged and ignored;
they cannot finish a reclaimed job. Agents advertising only cleanup v1 receive no
container cleanup work and are shown as requiring an update. Update the control
plane and agents together; this changes the wire contract without a schema migration.
Drain pending completions before upgrading an agent from the previous contract.

For purge completions, `type` is `"purge"` and `jobId` points to the delayed
purge job.

## Deploy logs

Deploy logs use monotonically increasing sequence numbers per deployment stream.
The job payload includes the next `logStartSeq` for agent output. Queue,
cancellation and timeout messages use a separate `control` stream and sequence.
The app combines both streams when displaying deployment history.

```json
{
  "deploymentId": "dep_123",
  "logStartSeq": 2,
  "logs": ["Building web..."],
  "events": [
    {
      "phase": "revision_started",
      "message": "Building Compose services."
    }
  ]
}
```

The agent sends progress to `POST /api/agents/jobs/progress`. The control plane
deduplicates log chunks with the unique `(deployment_id, stream, seq)` key, then
returns `{ "ok": true }`.

When the deploy finishes, the agent posts the unsent tail logs/events and final
status to `POST /api/agents/jobs/complete`. `logStartSeq` is required in progress
and completion requests, and retries must use the original sequence and lines.
Captured output is committed to the log database before updating deployment
state in the main database. A failed request can therefore be retried without
duplicating stored output. A completion received after cancellation or another
terminal state still stores its remaining output and returns `ignored: true`;
the final deployment state and aliases remain unchanged.

The agent advances its progress checkpoint only after `200 OK` with `ok: true`.
Completion requests are persisted in its completion outbox before upload and
remain there through failures or unacknowledged responses, including `202`. A `202 Accepted` response alone is not a durable completion
acknowledgment and must not clear the saved report.
On restart, the agent retries them with the current credential.

Pending deployment output is sent oldest first in batches of at most 5,000
lines and approximately 1 MiB of encoded log content. Events are also bounded
by count and encoded size. Upload limits do not discard an unsent tail or replace
captured lines with an omission marker. A completion outbox file keeps all its
pending output; replay sends bounded progress chunks before the final completion
and removes the file only after the final storage acknowledgment.

```json
{
  "type": "deploy",
  "deploymentId": "dep_123",
  "status": "succeeded",
  "gitSha": "43ba6c5",
  "logStartSeq": 18,
  "logs": ["Deployment completed."],
  "events": [
    {
      "phase": "completed",
      "message": "Deployment completed."
    }
  ]
}
```

## Runtime logs

Runtime logs are separate from deploy logs. Deploy logs describe the deployment
job; runtime logs describe application output from active Compose services.

After heartbeat, the agent tails each returned `runtimeLogTargets` entry with
`docker compose -p <runtimeId> logs --timestamps --since ...` and posts batches
to `POST /api/agents/runtime-logs`:

```json
{
  "serverId": "srv_123",
  "token": "agent_token",
  "logs": [
    {
      "runtimeId": "dp_fb3167db1f_a1b2c3d4e5",
      "service": "web",
      "observedAt": "2026-06-01T00:00:00Z",
      "content": "Listening on 3000"
    }
  ]
}
```

The control plane accepts logs for active environments assigned to that server,
or historical deployment runtimes recorded on that same server. This permits
durable captures to finish delivery after replacement or project deletion;
runtime ownership is never inferred from the upload alone. It hashes
`(runtimeId, service, observedAt, content)` to deduplicate
overlapping polling windows.

Runtime output is stored in the separate log database, with project and
environment identity assigned by the control plane. Reads recheck project
permissions and current runtime/server assignments in the main database.
Uploads use bounded insert statements; a failure midway through storage returns
an error, and retrying the complete batch deduplicates the already stored lines.
Runtime output retains its existing 24-hour lifetime and 10,000-row per-runtime
limit. Periodic maintenance also expires output from stopped or removed runtimes.
The agent retries pending outbox captures even when the runtime is no longer a
current collection target, without collecting new output for inactive targets.
After full acknowledgment, inactive outbox files are removed; empty inactive
cursor files are also pruned. Failed or unverifiable captures remain on disk.
If historical ownership has already been permanently removed, delivery remains
unacknowledged and needs operator recovery rather than silent deletion.

Successful responses are `200 OK` with
`{ "ok": true, "accepted": 1, "inserted": 1 }`. `accepted` counts assigned,
valid lines stored or already present through deduplication; `inserted` counts
new rows. Success is returned after persistence. The agent treats a batch as
delivered only when `ok` is true and `accepted` equals the submitted line count.
Other responses, malformed acknowledgments, and transport failures leave the
batch pending on disk for retry. Duplicate uploads must remain idempotent.

## Local recovery after remote upload failure

When complete local backup files survive a remote upload failure, the agent
completes the backup with `status: "failed"`, a provider error message,
`manifest.localRecoveryAvailable: true`, and its local artifacts. The control
plane validates paths against the claimed job, stores only local artifacts for
this failed completion, and permits restoring them. Other failed completions do
not publish artifacts. Recovery availability in the UI also requires retained
local volume or database artifacts; the marker alone is insufficient.

## Database backup formats

Backup job `databaseDumps` entries contain control-plane-generated `service`,
`command` and `format` (`sql` or `archive`). Commands write uncompressed stdout;
the agent gzips it once. Archive output is named `NN-service.archive.gz` and SQL
output `NN-service.sql.gz`. Agents supporting archive filenames advertise
`jobs.backup.archive.v1`; MongoDB jobs are rejected before enqueueing when the
server lacks that capability. Restore commands are generated on the control plane
from original backup metadata; the public restore API accepts only the artifact
and target service, never a client-supplied command.

## Public server addresses

Agents discover IPv4 and IPv6 independently over HTTPS using ipify, at startup and every
15 minutes. Registration and heartbeats report cached `publicIpv4` and `publicIpv6`; a
failed discovery retains the last known address. Heartbeats do not perform discovery on
every request. The control plane stores each family separately and derives
`publicAddress` with IPv4 preferred, falling back to IPv6. Connection IPs remain
monitoring observations and do not replace routing addresses. Discovery identifies
outbound public addresses, not inbound HTTP reachability; NAT may require separate
network configuration.

DNS instructions show A and AAAA records for available addresses. Verification succeeds
when either family resolves to its assigned server address. Generated nip.io URLs use
the preferred address; existing aliases are not automatically rewritten when the server
address changes; configuration updates can generate replacement environment aliases, and
new deployment aliases use the address current when queued.

The release schema stores both address families. Use agents built with this release for
dual-address reporting; older agents may report only one family.

## Backup and restore diagnostics

`POST /api/agents/job-logs` accepts `{serverId, token, jobId, offset, content}`. The control plane authenticates the agent and verifies that the backup or restore job belongs to its server. Content is limited to 16 KiB per upload and 10 MiB per job, with contiguous byte offsets. Replaying identical content at an acknowledged offset is idempotent; altered or out-of-order uploads return HTTP 409. `{ok:true}` acknowledges central persistence. The host saves its next offset only after acknowledgement and retries unsent file content after outages or restarts. No extra requests are made when uploads have caught up.

`GET /api/agents/job-logs?type=backup|restore&id=<activity-id>` reads stored diagnostics with session authentication and active project/workspace membership. Backup IDs resolve their associated agent job; restore IDs are job IDs. Central output remains readable when the agent is offline. Logs expire after 14 days. The existing scheduled log cleanup removes expired rows.

The release logs baseline includes operation diagnostics. Older jobs may have
only their recorded completion/error summary. Database dump stdout remains a backup artifact and is never uploaded as log content.

## Interrupted execution

Before running a claimed job, current agents persist a minimal failed-completion
fallback in their existing completion outbox. It contains identities, not job
secrets. A normal result replaces it atomically. Restart recovery reports the
interruption before claiming more work and does not automatically repeat a
partially executed restore or deployment. A crash between claim and local
persistence is recovered by the control-plane deadline. Backup, restore and
backup-cleanup jobs also expire through global maintenance without an agent poll.

A recovery-file write failure prevents execution and triggers an immediate failed
completion attempt. If the control plane is also unreachable, its timeout remains
the recovery mechanism. Container cleanup failures can be retried automatically;
partial deployments and restores are never automatically replayed.


## Optional hub-issued certificates

Agents advertise the additive `ingress.certificates.v1` capability. A heartbeat
response includes `managedCertificates: true` only when the application build
provides a certificate service. Without it, the agent makes no certificate requests.
This does not change `protocolVersion` or require an OSS operator to configure an
issuer. Builds with a certificate service require an agent with this capability for managed HTTPS.

`POST /api/agents/certificates` authenticates `{serverId, token, csrPem?,
installedCertificateSha256?}`. The JSON body is limited to 32 KiB and the CSR to
16 KiB. Unlike older agent payloads, unknown fields are rejected. Agents cannot
request for another server; deleted/disabled servers and inactive workspaces are
denied.

The response is one of:

- HTTP 200 without a CSR: `{status: "configuration", dnsNames: ["*.server.example.com"]}`.
- HTTP 202: `{status: "pending", retryAfter: 12}`, with a matching `Retry-After`
  header. Retry timing is an integer from 1 to 3,600 seconds.
- HTTP 200: `{status: "ready", certificatePem: "…", expiresAt: "…"}`. The PEM
  contains only a public chain; expiry is an ISO timestamp.

Successful responses use `Cache-Control: no-store`. Without a service, the endpoint returns HTTP 404;
provider errors return a generic HTTP 503. Core authenticates before invoking any
plugin service and does not pass agent credentials to it.

The host persists its own ECDSA key and CSR before requesting issuance. It checks
that the chain matches its key, wildcard name and validity period, installs it,
then repeats the CSR request with `installedCertificateSha256`, the lowercase
64-character SHA-256 of the leaf DER. The issuer validates that acknowledgement
before allowing new managed deployment routes. A lost acknowledgement is retried
without generating another key or order. Renewal begins within 30 days of expiry, using one third of the lifetime for
shorter-lived certificates.

`<state-dir>/ingress-certificates/` holds mode-0600 request/installation state and
versioned certificate/key files. Only `dynamic/certificates.yaml` is watched by
Traefik through a read-only mount. Atomic replacement enables certificate reload
without restarting Traefik. Custom domains keep their existing ACME resolver.
Adding this file provider changes ingress configuration: an older managed Traefik
container is replaced on its next routed deployment. Expect a brief ingress restart.

Issuer implementations must validate CSR signatures and restrict names to the
server's allocated namespace. DNS and ACME account credentials stay on the hub.
The default application registers no hub certificate issuer. A composed plugin can
supply one. No public database migration is required.

## Response bounds

The agent accepts at most 16 MiB in a successful control-plane POST response and requires a single valid JSON value. Oversized or trailing payloads fail before job execution. Non-success diagnostics remain capped at 4 KiB. This hardening requires an updated agent binary but does not change the protocol version or payload shapes.
