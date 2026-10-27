---
description: Enroll, monitor and troubleshoot deployment servers.
---

# Servers

A server runs the devpush agent, Docker Compose and Traefik. It belongs to a team and can host several projects. Owners/admins manage it; members can inspect it.

## Requirements

Use Linux with systemd and an amd64 or arm64 CPU. Reserve ports 80/443 for Traefik. Size CPU, memory and disk for your applications and builds.

Run the generated installer with administrator privileges. It checks Docker, Compose and Git, and attempts dependency installation on Debian/Ubuntu and Fedora/RHEL-family systems. Other distributions may need manual Docker setup. Remote backups also require rclone.

Only deploy trusted code: Docker access is effectively host-level access. Projects sharing a server are not isolated from hostile repositories.

## Connect and monitor

Add a server in **Servers**, run its generated command and wait for **Connected**. Enrollment links expire after one hour. The agent connects outbound to the dashboard; no SSH key is stored there.

The details page shows connection state, agent version, addresses and resource charts. Charts cover 24 hours; raw metrics default to seven-day retention. Runtime logs retain 24 hours and are not an archive.

Disabling a server rejects agent authentication but leaves application containers running. It can also prevent active work from reporting results. Use [drain](/docs/agent-maintenance/#updates-and-draining) for routine maintenance instead.

## Routing addresses

The agent discovers IPv4/IPv6 at startup and every 15 minutes. For a reachable private IP, append `--address IP` to the generated command's final `sudo bash` invocation. This pins `DEVPUSH_ROUTING_ADDRESS`; `--address auto` restores discovery.

A pin changes routing metadata, not networking. IP changes do not rewrite all saved aliases; check Visit URLs and update custom DNS separately. [Local VM setup](/docs/local-setup/#local-deployment-vm) pins the address automatically.

## Troubleshooting

On the host:

```sh
sudo systemctl status devpush-agent
sudo journalctl -u devpush-agent -n 100 --no-pager
```

Check access to the configured dashboard's `/api/health`. Installer logs are under `/var/log/devpush-agent/`, with `latest.log` pointing to the latest run. Keep `/etc/devpush/agent.env` and install commands private.

`sudo devpush-agent metrics resync` replays the agent's retained 24-hour metric history after dashboard monitoring data loss. It cannot recover samples never collected.

Use [Agent maintenance](/docs/agent-maintenance/) for upgrades, credentials and interrupted jobs. Deleting a server does not erase external backup archives; inspect the confirmation's handling of ongoing work before proceeding.
