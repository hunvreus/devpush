---
description: Enroll deployment servers, configure routing addresses and monitor host health.
---

# Servers

A server is a Linux host running the devpush agent, Docker Compose and managed
Traefik ingress. It belongs to a team and can run several projects. All team
members may inspect it; owners and admins manage enrollment, settings and deletion.

## Server requirements

Use a Linux host with systemd, `curl`, and an amd64 or arm64 CPU. Run the
installer with administrator privileges. It checks Docker and Compose and attempts
to install missing dependencies. Automatic Docker setup supports Debian/Ubuntu and
Fedora/CentOS/RHEL/Rocky/Alma. On other distributions, or if setup fails, install
Docker with the Compose plugin yourself before retrying. The installer also
checks Git; remote backups need rclone.

Size the machine for your applications and image builds; there is no single
minimum that fits every Compose stack. Check that its container images support
the host CPU. ARM64 installer support does not establish that every application
or a physical Raspberry Pi has been tested.

Only deploy code trusted with the host. Docker access, privileged containers and
bind mounts can reach host resources; projects on one server are not isolated
from hostile code. Reserve ports 80/443 for devpush's Traefik proxy.

## Enrollment and networking

1. Open **Servers** in your team and add a server.
2. Run its generated command on that server, then wait for **Connected**.
3. Assign it to a project or environment in project settings.

Enrollment links expire after one hour. The agent exchanges the enrollment token for a
credential stored on the host, then connects outbound to `DEVPUSH_BASE_URL`.
Remote dashboard origins require HTTPS. Plain HTTP is limited to loopback,
`.localhost` and `host.lima.internal` development origins.

The control plane does not need SSH or inbound access to the agent. Application
traffic must reach Traefik on ports 80 and, for HTTPS, 443. Public certificates
also require valid DNS and reachability. Discovering an outbound public IP does
not establish inbound connectivity through NAT or a firewall.

Enrollment installs a systemd service. Use `journalctl -u devpush-agent` for host
diagnostics. A disabled server rejects agent authentication; enabling it restores
access without reinstalling. Disabling does not stop application containers and
can prevent active jobs from reporting their results.

## Routing addresses

The agent discovers IPv4 and IPv6 at startup and every 15 minutes. A failed refresh
keeps the last known address. Generated nip.io URLs prefer IPv4 and fall back to
IPv6; custom domains use the DNS records shown in project settings.

For a reachable private address, append `--address IP` to the final `sudo bash`
invocation in the generated install command. For example, change
`sudo bash "$tmp"` to `sudo bash "$tmp" --address 192.168.64.7`.

This persists `DEVPUSH_ROUTING_ADDRESS` and disables automatic discovery and
refresh. Reinstalling without the flag preserves the pin; `--address auto` removes
it. Private addresses generate HTTP URLs. This configures routing metadata, not
the host network. The [local VM installer](/docs/local-setup/#deploy-to-a-local-vm)
sets this automatically.

Changing an address does not rewrite every existing hostname. Do not assume a
restart or redeploy repairs every old Visit URL. Inspect the generated aliases;
for a stable public URL, use a [custom domain](/docs/domains/) and update its DNS
when the server moves.

## Monitoring

A server becomes disconnected after missing the heartbeat window. Disconnected
servers retain settings and history, but cannot accept a new deployment until
connected. The details page shows host identity, uptime, agent version, addresses
and recent resource usage.

The agent samples CPU, memory, disk capacity, network traffic and disk I/O every
30 seconds, independently of deployments. Charts show up to 24 hours; periods
without samples remain gaps. Disk I/O is stored for diagnostics but is not shown
in the default dashboard. Views update while visible through workspace
notifications with polling fallback. Hidden pages pause live refreshes.

## Application status and logs

The agent reports Compose service state, health, restart count, start time and
exit code. Open the project's **Logs** page for captured application output.
Logs retain a 24-hour central window; they are not a permanent archive.

Captured output survives temporary upload outages in a local queue. Collection
pauses if the queue fills. Docker can rotate away output before the agent captures
it during a long outage or sustained overload. See the
[agent settings](/docs/configuration/#host-agent-settings) for the queue limit.

### Operator diagnostics

The agent keeps a rolling 24-hour local metric history across restarts. To replay
retained samples after control-plane data loss, run:

```sh
sudo devpush-agent metrics resync
```

This cannot recover samples from a stopped host or agent. Raw monitoring records
have seven-day retention by default (`DEVPUSH_MONITORING_RETENTION_DAYS`), separate
from the dashboard's 24-hour chart window.

Runtime reconciliation cleans orphaned devpush containers after a grace period
and retains managed volumes for seven days before purge. Assigned environments
and active deployments protect their runtimes. Recovery and operator cleanup are
covered in [Agent maintenance](/docs/agent-maintenance/) and
[Recover blocked deletions](/docs/deletion-recovery/).

## Maintenance and deletion

Use [Agent maintenance](/docs/agent-maintenance/) to update binaries, drain jobs,
rotate credentials or move an empty server to another control plane. Maintenance
pauses claims and waits for current work; application containers keep running.

Server deletion inspects usage and requires confirmation. It cancels backup and
restore work; the chosen handling of ongoing deployments is preserved. A deleted
server may authenticate only to finish permitted work and container cleanup.
External backup archives are not automatically deleted.

## Troubleshooting a disconnected server

On the host, check the agent and its recent output:

```sh
sudo systemctl status devpush-agent
sudo journalctl -u devpush-agent -n 100 --no-pager
```

Check that the configured dashboard origin is reachable from the host. Installer
logs are under `/var/log/devpush-agent/`, with `latest.log` pointing to the latest
run. Keep enrollment commands and `/etc/devpush/agent.env` private: they contain
credentials. For interrupted jobs or updates, use [Agent maintenance](/docs/agent-maintenance/).
