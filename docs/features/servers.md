# Servers

Servers are user-managed hosts running the devpush agent. The control plane does
not open inbound connections to servers; agents register once, then use outbound
HTTP polling for heartbeats, jobs, deploy progress, cleanup work, and runtime
logs.

All team members may view server state. Only team owners and team admins may
add, rename, enroll, disable, enable, or delete servers. These permissions are
enforced in server services as well as reflected in the UI. Members see read-only
server details and agent-update guidance directing them to an owner or admin.

Workspace and project connection warnings use the same neutral alert. For an
existing unavailable server, all workspace members get a link to its server detail
page; members also see guidance to contact an owner or admin. Project warnings
only consider servers assigned to active environments. Missing or deleted server
assignments link to project server settings, where the assignment can be changed.
These warnings do not grant access: server reads require workspace membership,
and server management remains restricted to owners and admins.

Enrollment tokens expire after one hour and are exchanged for a dedicated agent
credential. Rotation is staged: the old credential remains valid until the
agent persists and proves possession of the replacement, so a lost response
does not require reinstallation. Disabling blocks authentication without
erasing the credential. Rotation is initiated on the host with
`sudo devpush-agent credential rotate`; it is not exposed as routine server
administration in the app.

Generated installers receive the control plane's configured
`DEVPUSH_BASE_URL` and persist it in `/etc/devpush/agent.env`. The agent uses
that origin for registration, heartbeats, jobs, logs, and binary updates.
Changing the control-plane origin does not rewrite existing agent config.
Use the root-only maintenance switch command described in
[Local setup](../development/local-setup.md#agent-maintenance) for an empty host.
Changing only the URL does not move credentials or deployment ownership.

Agent upgrades use the checksum-verified root-owned updater described in
[Production operations](../development/production-operations.md). The agent
process itself remains unprivileged.

Updates download and verify before draining. Identical binaries are a no-op.
For a changed binary, maintenance blocks claims, lets the current job finish,
and flushes saved completion reports while heartbeats continue. A drain timeout
resumes claiming and postpones the update. Only then does it stop the agent,
replace the executable atomically, and start the service. A missing confirmation
heartbeat restores the previous binary. Running containers are not stopped.
This does not make manual service restarts or forced process termination safe.

Switching is restricted to servers without projects, deployment history,
Compose containers, or queued/running jobs. Destination registration and a
confirmation heartbeat happen before the source is disabled. Destination state
and credentials live in a separate directory; source completions are never sent
to the destination. The source check and disable are one conditional database
write. Configuration selection is atomic. Failure restores the source config
and re-enables it using a signed rollback ticket tied to the disabled row's
timestamp; operator changes invalidate that ticket. Successful switches leave
the old server record disabled for explicit later cleanup.

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
5 seconds while visible, including pending enrollment and connected servers.
On Cloudflare and Node, heartbeat notifications refresh server status and metrics; both
views keep a one-minute recovery poll while connected. Blocked WebSockets
retain five-second polling. Both the list and detail page pause polling in hidden tabs and refresh immediately
when the tab regains focus. The server detail page shows up to 24 hours of
timestamp-based CPU, memory, disk usage, and network history with synchronized
hover state and the latest value in each chart header. Disk I/O is retained for
future diagnostics but is not part of the default dashboard. Missing collection
periods are rendered as gaps and are not interpolated, connected with a dashed
estimate, or treated as zero.

The agent saves a rolling 24-hour metric history locally before upload,
including successfully uploaded samples. Unacknowledged samples are retried in
ordered batches; recovered samples fill charts at their original collection
times. Connection availability still shows the communication outage. The newest
chart value can lag while an older backlog drains (about six minutes for a full
24-hour backlog at 240 samples per heartbeat).

Run `sudo devpush-agent metrics resync` on the server to replay the retained
history after hub data loss. Changing the control-plane URL or enrolling a new
server identity starts an independent upload checkpoint. Restarts preserve the
history and checkpoint; samples older than 24 hours expire locally. Neither a
stopped agent nor an offline host collects samples, so those gaps remain.

Raw heartbeat and host-metric samples are retained for seven days by default.
Set `DEVPUSH_MONITORING_RETENTION_DAYS` to an integer between 2 and 3650 to
change that window. Periodic maintenance removes expired samples in bounded
batches; it also catches up after servers stop reporting. This does not change
the charts' 24-hour display window.

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

Captured runtime logs are persisted in the agent state directory before upload.
Each runtime gets one upload chunk per heartbeat, up to 500 lines and 8 MiB;
remaining captured lines stay pending instead of being discarded. The agent
advances its saved collection cursor only when every chunk from that capture
has been acknowledged. Failed or incomplete acknowledgments keep the original
batch for retry, including after an agent restart.

Set `DEVPUSH_RUNTIME_LOG_QUEUE_BYTES` in the agent environment or config file to
bound local queue storage (128 MiB by default). A full queue pauses collection
without deleting existing pending logs and reports the collection failure in
both the agent log and application runtime logs. Collection uses bounded time
windows instead of a per-service line tail; windows that exceed the capture
buffer are shortened and resumed from their acknowledged end. Docker rotation
before capture can still omit source output during sustained overload or long
outages. The delivery guarantee applies to captured batches, not every line
ever emitted by Docker.

## Form and confirmation behavior

Server names share browser/server validation. Failed name edits preserve the
entered name; pending saves disable editing. Enrollment generation shows an
inline failure with an explicit retry action; it does not repeatedly regenerate
commands automatically after failure. Disabled servers must be enabled first.

Enable, disable, and delete confirmations remain open during requests and show
failures inside the dialog. Usage inspection runs when opening deletion from
either server view; failed inspections can be retried. Closing and reopening
the dialog invalidates old inspection responses. Typed confirmation is checked
again before submitting a disable or delete request.
