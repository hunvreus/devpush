---
description: Schedule application backups, configure remote storage and restore data.
---

# Backups

Back up named volumes and databases belonging to an environment's Compose runtime.
Team owners and admins configure policies, run backups and restore data. Members
can inspect history and logs.

If Backups is unavailable, ask your installation operator to enable it. The
[configuration reference](/docs/configuration/#agents-monitoring-and-backups)
lists the required flags. Application backups are separate from
[control-plane database backups](/docs/production-operations/#control-plane-backups).

## Create a policy

1. Open a project's **Backups** page and add a policy.
2. Choose its environment and the volumes or databases to protect.
3. Set a UTC schedule, local retention and an optional remote destination.
4. Save the policy and run a manual backup.
5. Check its result. Test restore on a disposable staging environment with its
   own policy and data before relying on the schedule. Restore overwrites the
   owning environment; it cannot copy a production backup into a new test environment.
Each policy saves independently. A conflicting save keeps your edits; see
[Concurrent settings changes](/docs/accounts-and-teams/#concurrent-settings-changes).

For volumes, choose none, all named volumes, or selected names. Service and volume
fields suggest names from the saved Compose file and accept custom names for
future deployments. Typing a name does not create that service or volume.

Supported contents are:

- Named volumes scoped to the environment's Compose runtime.
- PostgreSQL, MySQL, MariaDB and MongoDB services.
- A manifest recording the run and artifact checksums.

Anonymous volumes, bind mounts outside Docker-managed volumes and external managed
databases are not included. Use the external provider's own backup tooling for those.

## Scheduling and manual runs

Schedules use five-field cron expressions in UTC. When both day-of-month and
day-of-week are constrained, either can match. The installation's scheduler queues jobs and the environment's server runs them.
Only one backup can be queued or running per environment. Use the policy's **Run** action for a manual
backup. The policy must be enabled for manual runs too. Pausing stops future
runs; it does not cancel already queued work. If another backup is active when a
schedule is due, that occurrence is skipped; it is not queued for later catch-up.

## Database backups

Select a service, engine and database name. Leave the database name empty for all
databases. devpush generates the commands; custom images must contain the engine's
client tools and provide its standard credentials:

| Engine | Container environment |
| --- | --- |
| PostgreSQL | `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| MySQL | `MYSQL_ROOT_PASSWORD` |
| MariaDB | `MARIADB_ROOT_PASSWORD`, falling back to `MYSQL_ROOT_PASSWORD` |
| MongoDB | `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD` |

SQL engines produce `.sql.gz` artifacts. MongoDB produces `.archive.gz` and needs
an agent advertising archive backup support. Restore uses engine and scope metadata
from the original run, even if the policy later changes.

PostgreSQL all-database backups concatenate individual dumps and restore through
`template1`. They recreate the backed-up databases but omit role ownership,
grants and cluster-wide settings. Provision required roles separately. Historical
dumps with unknown engine metadata require manual recovery; retained files are
not silently treated as another format.

## Volume archives

The agent mounts source volumes read-only in a temporary helper container and
creates gzip tar archives. It checks the Compose runtime label before mounting
backup sources or restore targets, preventing access to unrelated workloads.

Containers continue running during capture. Changing files can produce an
inconsistent archive; this is not an atomic snapshot. Use database-native dumps
for running databases and coordinate application writes when consistency matters.

## Remote storage

Owners and admins add destinations in **Team settings → Backup storage**.
Create the bucket with the provider first, then enter a name, bucket, region,
optional S3-compatible endpoint, access key ID and secret. Storage settings check
syntax but do not test provider access: verify a backup and recovery yourself.

Each policy can select one destination. Different policies may use different
buckets; a policy does not mirror to multiple destinations. devpush assigns the
object prefix automatically. Credentials are encrypted in the control plane and
supplied to the agent when it claims work. Servers need `rclone`; the installer
attempts to install it and warns if it cannot.

A storage connection's bucket, region and endpoint are immutable. Create another
connection to change location. Edit its credentials when rotating provider access.
Runs retain their original destination but use that connection's current credentials.
Deleting or changing a policy never redirects old restores to a new bucket.

Connections cannot be removed while referenced by policies, active jobs or retained
remote archives. Removing an unused connection does not delete its bucket or files.

## Retention and failures

Set local and remote retention independently by count, age in days or a total GB
cap. The control plane selects expired files and queues agent cleanup. A cleanup
failure does not change the original backup result and is retried after an hour.

If remote upload fails after capture, the run remains **Failed**, but complete
local archives remain restorable while retained. These files participate in local
retention without displacing the last successful remote recovery point. Incomplete
archives are removed. Inspect Logs for the failed stage; a later successful backup
clears the policy's upload warning.

Default local run directories are under
`/var/lib/devpush-agent/backups/<projectId>/<environmentId>/<runId>/`.
Artifacts use generated names; file paths are not user-configurable restore inputs.

## Restore

Choose a retained run, select **Restore**, review the environment, server and
selected volume/database targets, then confirm. The destination must be the owning
runtime on the original server, which must still be assigned to the environment.
Changing server assignment does not transfer backup history's restore target;
recovery to a replacement server requires manual recovery outside this workflow.
Stop application writes and allow for downtime: restoration overwrites selected data. It does not roll back application code.

When both copies exist, the UI prefers the recorded local artifact. A missing
local file causes failure; there is no automatic retry from the remote copy.
Remote-only items use their recorded destination. If a local copy is recorded but
lost, the UI does not offer a storage-source switch. An operator/integration can
explicitly select a retained remote artifact through the
[restore API](/docs/api-operations/): list the run's artifacts, choose its `remote`
artifact ID, and supply the required type and target. This still overwrites the
owning runtime and requires team owner/admin access, confirmation and idempotency.
It does not restore to another server. Failed-upload runs can offer
local recovery when usable artifacts remain. The UI exposes one content item per
local/remote pair; details show the actual targets recorded by each restore.

Only owners/admins can start a restore. Another queued/running restore for the
environment blocks a new one. There is no user-facing cancellation action;
closing a dialog does not cancel a job. Manual deletion of individual backup
files is not offered.

During a volume restore, graceful agent cancellation attempts to stop the restore
helper, roll back changed volumes and restart the containers that were running.
Recovery has its own bounded timeout. If the writer cannot be stopped or rollback
fails, the application stays stopped and the failure includes the retained
recovery directory under `<agent state directory>/restores/<job ID>/recovery`.
Inspect that data before manually recovering or retrying; it is not deleted
automatically after a failed rollback. Restore downloads also stage on this
persistent filesystem rather than the system temporary directory.

Before stopping containers, the agent durably journals the original container IDs
and restart policies, then disables automatic restarts. Recovery copies are synced
before volume replacement begins. After a hard kill or power loss, the next job
poll stops orphaned restore helpers and rolls back interrupted volume writes before
restarting those containers and accepting new work. Completed volume replacement
is recorded before restart, so recovery preserves committed data rather than
rolling it back. Unresolved journals retain their copies and block further jobs;
fix the reported Docker/storage problem and let the agent retry recovery.

The interrupted job is reported as failed; its requested restore is not replayed.
Database restore commands do not have volume rollback or automatic crash recovery.

## History and logs

Backup and restore attempts have separate activity rows. Use Details to inspect
the recorded source, targets and result, and Logs for progress and diagnostics.
Host and central job diagnostics are retained for 14 days; terminal error summaries
remain after detailed logs expire. Existing history cannot acquire full diagnostics
retroactively. Logs can contain application output; restrict access accordingly.

Disabling backups blocks new configuration changes, backups and restores through
the UI, API and MCP. History remains readable and queued work/cleanup can finish.
Deleting a project or server stops its retention jobs but does not automatically
remove remote archives; configure provider retention for external files.
Maintenance collects eligible deleted-resource metadata after its retention window,
but recorded archives and unresolved cleanup block collection. See
[operator deletion recovery](/docs/deletion-recovery/)
to inspect and resolve those blockers.
