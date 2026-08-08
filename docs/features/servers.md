# Servers

Servers are user-managed hosts running the devpush agent. The control plane does
not open inbound connections to servers; agents register once, then use outbound
HTTP polling for heartbeats, jobs, deploy progress, cleanup work, and runtime
logs.

Enrollment tokens expire after one hour and are exchanged for a dedicated agent
credential. Rotation is staged: the old credential remains valid until the
agent persists and proves possession of the replacement, so a lost response
does not require reinstallation. Disabling blocks authentication without
erasing the credential. Rotation is initiated on the host with
`sudo devpush-agent credential rotate`; it is not exposed as routine server
administration in the app.

Agent upgrades use the checksum-verified root-owned updater described in
[Production operations](../development/production-operations.md). The agent
process itself remains unprivileged.

## Connection state

The agent sends heartbeats to the control plane. A connected server becomes
disconnected when no heartbeat is observed within the configured disconnect
window. Team and project flows may still reference disconnected or pending
servers, but deployments fail fast when the selected project server is not
connected.

The server detail page separates editable control-plane identity from reported
host facts. General shows status, last contact, name, and the copyable server
ID. Host shows:

- Agent version.
- Hostname, operating system, kernel, architecture, CPU core count, and actual
  host uptime when reported by the agent.

The public address is retained when a trusted proxy reports it, but it is not
shown as a host fact because direct requests do not reliably provide one.

Heartbeat history remains available for connection-state and missing-sample
handling, but the UI does not present heartbeat coverage as host or application
availability.

## Host metrics

Heartbeats may include host metrics:

- CPU percent.
- Memory used and total bytes.
- Disk used and total bytes.
- Aggregate non-loopback network receive and transmit rates.
- Aggregate physical-disk read and write rates.

The agent samples host metrics every 30 seconds in a loop independent from job
execution, and each collection attempt has a deadline so Docker inspection
cannot stall later samples. Screens displaying live server state refresh every
15 seconds while visible. The server detail page shows up to 24 hours of
timestamp-based CPU, memory, disk usage, and network history with synchronized
hover state and the latest value in each chart header. Disk I/O is retained for
future diagnostics but is not part of the default dashboard. Missing collection
periods are rendered as gaps and are not interpolated, connected with a dashed
estimate, or treated as zero.

## Runtime discovery

Agents may include observed Docker Compose runtime IDs in heartbeat payloads.
The control plane uses those observations to reconcile leaked devpush-controlled
runtimes. Active environment runtimes, in-flight deployment runtimes, and
runtimes already covered by unfinished cleanup jobs are kept.

Agents also report the latest container state, Docker health status, restart
count, start time, and exit code for each observed Compose service. This is
latest operational state rather than historical per-container resource
monitoring, and is displayed with the owning project environment.

## Runtime logs

Heartbeat responses include runtime log targets for active Compose runtimes
assigned to the server. The agent tails those runtimes and posts application log
batches back to the control plane. Runtime logs are separate from deploy logs:
deploy logs describe the deployment job, while runtime logs describe application
output from active services.
