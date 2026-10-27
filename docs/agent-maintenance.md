---
description: Update agents, rotate credentials and recover interrupted jobs.
---

# Agent maintenance

Run these commands on the deployment server as an operator.

## Updates and draining

```sh
sudo /usr/local/lib/devpush/update-agent
```

The updater verifies the binary, waits for active work to finish and its results to reach the dashboard, then replaces/restarts the agent. Drain timeout postpones the update; failed startup restores the previous binary. Application containers keep running. A later deployment may briefly interrupt ingress when replacing Traefik.

For manual maintenance, pause new jobs and resume afterward:

```sh
sudo devpush-agent maintenance drain
sudo devpush-agent maintenance resume
```

Enable or disable the daily updater on an existing host:

```sh
sudo systemctl enable --now devpush-agent-update.timer
sudo systemctl disable --now devpush-agent-update.timer
```

`DEVPUSH_AGENT_AUTO_UPDATE=true` enables it for newly generated installations. Check progress with `sudo journalctl -u devpush-agent -f`; installer logs live under `/var/log/devpush-agent/`.

## Rotate credentials

```sh
sudo devpush-agent credential rotate
```

This drains current work, replaces the credential and restarts the agent. A timeout postpones rotation.

## Switch an empty server

Only servers without projects, deployment history, Compose containers or outstanding jobs can move between installations.

Create a destination server, generate its install command and save only its `dps_...` token to a root-readable file:

```sh
sudo devpush-agent maintenance switch \
  --url https://destination.example.com --token-file /root/destination-token
```

A failed confirmation heartbeat restores the source configuration. After success, remove the disabled source record. Keep `/etc/devpush/agent.env.switch-backup` and its `.json` companion private: they contain recovery credentials. Interrupted switching needs operator recovery; inspect destination state before retrying.

## Interrupted work

Pending job results block new jobs until the dashboard accepts them. Investigate `deliver pending completion failed` and preserve the state directory. **Do not delete outbox entries to resume work.**

Interrupted deployments, backups and restores are reported failed, not automatically replayed. Inspect application/data state before retrying: some effects may already have occurred.

Volume restores keep journals and archives at `<agent state directory>/restores/<job ID>/recovery`. Restart recovery rolls back interrupted replacements, preserves completed ones and restarts affected containers. Recovery failure blocks new jobs and leaves containers stopped. Fix the reported Docker/storage error and let polling retry; never delete journals or recovery copies. Database restores require application-specific inspection.

Backup/restore work expires centrally after 25 hours without completion. That does not prove the host process stopped or its partial writes were undone.

## Remove an agent

Delete the server in devpush, review ongoing work, wait for cleanup and back up retained data. Then stop its services:

```sh
sudo systemctl disable --now devpush-agent-update.timer
sudo systemctl disable --now devpush-agent.service
```

Only then remove binaries/configuration/state. Remove Traefik/socket-proxy resources only when no retained application needs them. Removing the agent alone does not stop containers, uninstall Docker or erase remote backups.
