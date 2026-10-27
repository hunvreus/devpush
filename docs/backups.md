---
description: Schedule application backups and restore retained data.
---

# Backups

Owners/admins manage backups in a project's **Backups** page. Members can inspect history. If unavailable, the operator must enable both [backup flags](/docs/configuration/#agents-and-backups).

These protect application data, not the devpush installation. See [installation backups](/docs/production-operations/#backups-and-recovery) for the dashboard's databases and uploads.

## Create a policy

Choose an environment, named volumes and/or database services, a UTC cron schedule, local retention and an optional remote destination. Save, run a manual backup and inspect its result.

Supported engines are PostgreSQL, MySQL, MariaDB and MongoDB. Containers need their native client tools and standard engine credentials. SQL dumps use `.sql.gz`; MongoDB uses `.archive.gz`. PostgreSQL dumps omit cluster roles/grants; provision them separately.

Volume archives capture live files without stopping containers. They are not atomic snapshots; prefer native dumps for running databases. Anonymous volumes, bind mounts and external managed databases are not included.

Only one backup runs per environment. A due occurrence is skipped if another backup is active. Pausing a policy stops future runs, not already queued work; manual runs also require an enabled policy.

## Remote storage and retention

Add an existing S3-compatible bucket in **Team settings → Backup storage**. Enter its endpoint, region and credentials, then select it in the policy. The server needs rclone. Saving storage validates syntax, not provider access: verify an actual upload and restore.

Bucket, endpoint and region are immutable. Create another connection to change location; rotate credentials on the existing connection. Old runs retain their original destination. Referenced storage cannot be deleted.

Set local/remote retention separately by count, age or total size. If upload fails, complete local archives remain restorable while retained. External archives are not automatically erased when deleting a project or server.

## Restore

Choose a retained run and **Restore**, review its targets and confirm. Stop application writes and allow downtime: restore overwrites selected data without rolling back code.

Restore targets the owning environment on its original server. It cannot copy data to another environment/server. Test on a disposable environment with its own policy first.

When both copies exist, the UI prefers local storage; a missing local file does not automatically fall back to remote. The [API](/docs/api-operations/) can explicitly select a retained remote artifact.

Volume restores retain recovery copies and a journal. After interruption, the agent recovers interrupted writes before restarting affected containers or claiming more work. Recovery failure leaves applications stopped and retains evidence. **Do not delete journals or recovery archives.** Check [Agent maintenance](/docs/agent-maintenance/#interrupted-work).

Database restores do not have automatic volume rollback. Inspect the database after interruption before retrying.

## Verify your backups

Check backup/restore activity and logs, not just the schedule. Test recovery before relying on a policy. Disabling backups prevents new changes/runs/restores, while history remains readable and queued work/cleanup can finish.
