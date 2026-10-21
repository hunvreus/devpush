---
description: Update agents, rotate credentials and recover interrupted maintenance.
---

# Agent maintenance

Run these commands on the deployment server as an operator. Enrollment and server
permissions are covered in [Servers](/docs/servers/); the public control-plane settings
are in [Configuration](/docs/configuration/).

## Agent upgrades

The agent installer creates a root-owned updater. Run it manually with:

```sh
sudo /usr/local/lib/devpush/update-agent
```

It downloads the platform binary and published SHA-256 checksum, skips an
identical binary, and drains current work before replacing a changed binary and
restarting the agent. Heartbeats continue during draining; completion reports
must be acknowledged before restart. A drain timeout postpones the update.
The command displays download, verification, drain, restart, and reconnection
phases. During draining it explains that active work and heartbeats continue.
Application containers remain up. The next deployment reconciles pinned Traefik
and socket-proxy images and ingress settings. A required ingress replacement can
briefly interrupt routing; image download failure leaves the existing container
in place. Failed startup restores the previous binary. Set
`DEVPUSH_AGENT_AUTO_UPDATE=true` on the control plane before generating install
commands to enable a daily systemd timer for newly installed agents. Existing
hosts can opt in or out directly:

```sh
sudo systemctl enable --now devpush-agent-update.timer
sudo systemctl disable --now devpush-agent-update.timer
```

The main service runs as the dedicated `devpush` user; the updater service runs
as root. The agent user belongs to the Docker group, whose daemon access is
effectively root-level access to the host. It is not a sandbox for untrusted code.

The installer records its phase output and suppressed package-manager details
in a root-readable timestamped log under `/var/log/devpush-agent/`.
`/var/log/devpush-agent/latest.log` points to the latest installation run. The
running agent writes to the systemd journal; inspect it with
`sudo journalctl -u devpush-agent -f`.

The control plane embeds its configured `DEVPUSH_BASE_URL` into new install
scripts. Changing the public control-plane origin requires updating
`DEVPUSH_BASE_URL` and restarting or redeploying the control plane before
generating new commands. Existing agents retain their old URL in
`/etc/devpush/agent.env`. To connect an empty host to a different control plane,
use the [agent maintenance workflow](#switch-an-empty-server), which
enrolls a new identity and supports rollback. Moving active hosts between control
planes is not supported by that workflow.

The version in `app/package.json` identifies the bundled agent release shown as the
latest available version. `DEVPUSH_RECOMMENDED_AGENT_VERSION` is optional and
marks older agents as recommended updates without blocking communication.
Protocol versions and advertised capabilities—not these release strings—control
which jobs an agent can safely claim.

## Agent credentials

Rotate a host's credential only when it may have been exposed or as part of a
security policy:

```sh
sudo devpush-agent credential rotate
```

The command pauses claims, waits for active work and completion acknowledgments,
authenticates with the current credential, atomically stores its replacement, and
restarts the agent. A drain timeout postpones rotation. It does not reinstall Docker or the agent.

## Switch an empty server

Switch an empty server to another control plane:

1. Create a fresh server record on the destination and generate an install command.
2. Save only its `dps_...` enrollment token to a root-readable file on the VM.
3. Run:

```bash
sudo devpush-agent maintenance switch \
  --url https://destination.example.com --token-file /root/destination-token
```

The destination must use HTTPS and the source must support `/api/agents/switch`.
Managed projects, deployment history, Compose containers, and outstanding jobs
block switching. Destination credentials are isolated from the original state.
The source is disabled before selecting the new config; a failed confirmation
heartbeat restores the original config and re-enables the source. Applications
are never stopped by maintenance. Remove the disabled source record separately
after a successful switch.

For recovery, the original config and signed source rollback data are retained
as `/etc/devpush/agent.env.switch-backup` and its `.json` companion with mode
`0600`. Treat them as credentials. A process crash, power loss, or failed source
rollback requires operator recovery; automatic rollback covers reported runtime
errors, not an interrupted maintenance command. Failed staging may leave a
destination record and state directory; inspect before retrying.

`sudo devpush-agent maintenance drain` pauses claims without stopping the agent.
Use `sudo devpush-agent maintenance resume` to undo a manual drain. Maintenance
commands exclude concurrent maintenance operations. Agent binaries installed
before drain support cannot be upgraded automatically through this path; they
fail closed and require an operator-supervised idle bootstrap. Existing agents
must receive the updated updater before using the new safe update flow.

## Pending completion recovery

An agent drains its saved completion outbox before claiming more work. A rejected
or unreadable completion therefore blocks new claims rather than silently losing
the result. Inspect the agent's `deliver pending completion failed` diagnostic
and preserve its state directory while reconciling control-plane ownership or
restoring damaged state. Do not delete outbox entries merely to resume claims.

## Interrupted jobs

Current agents save an interruption report before executing a job. A normal result
replaces it; after a crash, restart reports failure before accepting new work.
Use Deployments, service health and application/database checks to inspect the
runtime or restored data before retrying: a failed job can
have completed some external effects. Recovery does not automatically repeat it.

An unreachable agent's queued or running backup/restore work expires through
control-plane maintenance after 25 hours. This releases blocked work; it does
not prove that a host-side process stopped or that a partial restore was undone.

Container deprovision/purge failures use bounded automatic retries. Current
agents echo the claim attempt in normal and interrupted completions; stale reports
are acknowledged without finishing a newer attempt. Upgrade agents for cleanup v2
and drain pending completions before switching from the old contract. Deployments,
backups and restores are not automatically repeated after an interruption.
If the recovery record cannot be written, the agent attempts an immediate failed
completion without executing the job. If both disk and network delivery fail,
control-plane deadline recovery remains necessary.

## Remove an agent

There is no automated uninstaller. First delete the server in devpush, review
whether to cancel ongoing deployments, and wait for permitted work and cleanup
to finish. Back up any
volumes and archives you need. Stop and disable the agent and updater timer before removing binaries,
`/etc/devpush` configuration or the state directory:

```sh
sudo systemctl disable --now devpush-agent-update.timer
sudo systemctl disable --now devpush-agent.service
```

Those files contain credentials and recovery data.

Only remove `devpush-traefik`, `devpush-docker-socket-proxy` and their networks
when no retained application depends on them. Removing the agent alone does not
stop deployed containers, remove Docker or erase remote backup objects. Inspect
Docker resources explicitly rather than deleting every resource on a shared host.
