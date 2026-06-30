# Servers

Servers are user-managed hosts running the devpush agent. The control plane does
not open inbound connections to servers; agents register once, then use outbound
HTTP polling for heartbeats, jobs, deploy progress, cleanup work, and runtime
logs.

## Connection state

The agent sends heartbeats to the control plane. A connected server becomes
disconnected when no heartbeat is observed within the configured disconnect
window. Team and project flows may still reference disconnected or pending
servers, but deployments fail fast when the selected project server is not
connected.

Server lists and detail pages show:

- Current status.
- Last seen time.
- Public address reported by the request.
- Agent version.
- 24-hour heartbeat count.
- 24-hour uptime estimate.

## Host metrics

Heartbeats may include host metrics:

- CPU percent.
- Load average.
- Memory used and total bytes.
- Disk used and total bytes.

The server detail page shows the latest metric sample and a 24-hour history for
the reported metrics. Missing metrics are treated as unknown, not zero.

## Runtime discovery

Agents may include observed Docker Compose runtime IDs in heartbeat payloads.
The control plane uses those observations to reconcile leaked devpush-controlled
runtimes. Active environment runtimes, in-flight deployment runtimes, and
runtimes already covered by unfinished cleanup jobs are kept.

## Runtime logs

Heartbeat responses include runtime log targets for active Compose runtimes
assigned to the server. The agent tails those runtimes and posts application log
batches back to the control plane. Runtime logs are separate from deploy logs:
deploy logs describe the deployment job, while runtime logs describe application
output from active services.
