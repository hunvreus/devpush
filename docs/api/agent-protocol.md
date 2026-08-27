# Agent protocol

The agent uses outbound HTTP polling for durable deployment jobs. WebSocket
transport is intentionally deferred to future interactive sessions, such as a
container console, where bidirectional low-latency traffic is required.

`agentVersion` is informational release metadata. Compatibility is negotiated
with `protocolVersion` and additive capability names. The control plane keeps
registration and heartbeats available to older agents even when an update is
required before they can claim newer job types. Unknown request fields are
ignored so agents and control planes can roll out additive changes independently.
Hub and agent builds use the same product release numbering when cut from a
release, but their versions do not need to match. Development builds report
`dev`; release strings never decide protocol compatibility.

## Connection lifecycle

1. Agent registers with an expiring enrollment token at
   `POST /api/agents/register`.
2. Control plane returns the server ID and a dedicated agent credential.
3. Agent atomically stores that credential and sends periodic heartbeats to
   `POST /api/agents/heartbeat`.
4. Agent polls `POST /api/agents/jobs/next` for queued agent work.

Heartbeat payloads may include host `system` identity, `metrics`, `runtimeIds`,
and current Compose `runtimes`. `runtimeIds` is a cached list of Docker Compose
project names observed from containers with the
`com.docker.compose.project` label. If Docker runtime discovery fails, the agent
omits `runtimeIds`; omitted means unknown, while an empty array means the agent
observed no matching container-backed runtimes.

```json
{
  "serverId": "srv_123",
  "token": "agent_token",
  "agentVersion": "1.0.0",
  "protocolVersion": 1,
  "capabilities": [
    "jobs.compose.deploy.v1",
    "jobs.compose.cleanup.v1",
    "jobs.backup.v1",
    "jobs.backup.cleanup.v1",
    "jobs.restore.v1",
    "runtime.logs.v1"
  ],
  "system": {
    "hostname": "app-01",
    "operatingSystem": "Ubuntu 24.04.2 LTS",
    "kernelVersion": "6.8.0-64-generic",
    "architecture": "amd64",
    "cpuCoreCount": 4,
    "uptimeSeconds": 22140
  },
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
  },
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
`401` for invalid credentials, `403` for disabled or deleted servers, `404` for
unknown jobs, `409` for invalid job state, and `500` for unexpected control-plane
failures. Unexpected exceptions are logged server-side and are not returned to
the agent.

## Deploy jobs

Deploy jobs target one server and include a deployment snapshot plus a
short-lived GitHub installation token. Project settings changed after the
deployment was queued do not mutate the claimed job.

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

Cleanup completion is sent to `POST /api/agents/jobs/complete` with the cleanup
job ID:

```json
{
  "type": "deprovision",
  "jobId": "job_123",
  "status": "succeeded"
}
```

For purge completions, `type` is `"purge"` and `jobId` points to the delayed
purge job.

## Deploy logs

Deploy logs use monotonically increasing sequence numbers per deployment stream.
The job payload includes `logStartSeq`, because the control plane may already
have written queued/claim logs before the agent starts reporting.

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
status to `POST /api/agents/jobs/complete`.

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

The control plane accepts logs only for active environments assigned to that
server. It hashes `(runtimeId, service, observedAt, content)` to deduplicate
overlapping polling windows.
