# Backups

Backup persistence, backup settings UI, backup job queueing, backup job
completion, retention cleanup queueing, and retention cleanup completion are
implemented. Agent artifact upload execution, agent-side retention object
deletion execution, and restore execution are not implemented yet.

## Scope

V1 backups cover devpush-managed Compose runtimes for a single environment on a
single server.

Backups include:

- Compose-scoped named volumes for the environment runtime.
- Optional database dumps for services explicitly configured as databases.
- Backup metadata in the control plane.

Backups do not include:

- Bind mounts outside Docker-managed volume paths.
- Volumes marked `external: true`.
- Volumes with explicit global `name:` values unless the project opts them in.
- Object storage buckets, external managed databases, or third-party services.

## Storage destination

The first destination should be S3-compatible object storage. Store each backup
under a deterministic team/project/environment prefix:

```text
s3://<bucket>/teams/<teamId>/projects/<projectId>/environments/<environmentId>/backups/<backupId>/
```

Each backup directory contains:

- `manifest.json`: runtime ID, deployment ID, commit SHA, environment ID, route
  snapshot, Compose settings, started/completed timestamps, artifact list, and
  checksums.
- `volumes/<volume>.tar.zst`: archived volume contents.
- `databases/<service>.sql.zst` or `databases/<service>.dump.zst`: optional
  database dump artifact.

The server streams artifacts directly to storage using short-lived credentials
from the job payload. The control plane should not proxy backup data.

## Retention

Retention is per project environment.

V1 defaults:

- Keep daily backups for 7 days.
- Keep weekly backups for 4 weeks.
- Keep monthly backups for 3 months.

Retention deletion is queued as a separate cleanup job after the control plane
selects expired backup runs. A failed deletion must not mark the backup itself
failed; it should leave the backup visible with a cleanup warning.

Project and team deletion should retain backups until the configured backup
retention expires. Runtime volume purge and backup retention are separate
policies.

## Database dumps

Volume archives alone are not enough for live databases. V1 should support
database dump commands per service:

```yaml
service: postgres
command: pg_dumpall -U "$POSTGRES_USER"
output: databases/postgres.sql.zst
```

The command runs inside the target Compose runtime with:

```sh
docker compose -p <runtimeId> exec -T <service> <command>
```

The agent should stream stdout through compression to the destination object.
Secrets needed by the command come from the deployment snapshot environment, not
from current project settings.

If no database dump is configured, devpush should warn that database services may
only be crash-consistent through volume archives.

## Volume archives

For each included named volume, the agent should run an ephemeral helper
container that mounts the volume read-only and streams a compressed tar archive:

```sh
docker run --rm \
  -v <volumeName>:/data:ro \
  alpine sh -c 'cd /data && tar -cf - .'
```

The stream is compressed and uploaded as `<volume>.tar.zst`.

Backups should reject writable helper mounts. They should also record the Docker
volume label set, including `com.docker.compose.project`, so restore can verify
the target runtime.

## Restore

V1 restore creates an explicit restore job. It must not mutate a running
environment automatically.

Supported restore modes:

- Restore to the same environment after stopping the runtime.
- Restore to a new environment/runtime for inspection.

Restore steps:

1. Download and verify `manifest.json` checksums.
2. Stop the target Compose runtime.
3. Restore selected volume archives into Compose-scoped volumes for the target
   runtime.
4. If database dump artifacts exist, start the database service and run the
   configured restore command.
5. Start the full runtime and run the usual readiness checks.

Restore must create a deployment event trail and should require confirmation in
the UI because it can overwrite state.

## Persistence

The control plane stores backup configuration per project environment, backup
run history, and backup artifacts. Configuration includes destination, retention,
and database dump commands, but not storage credentials.

## Agent protocol

Backup and restore should use agent jobs, not WebSockets.

Reserved agent job types:

- `backup`
- `restore`
- `backup_cleanup`

The control plane can queue `backup` jobs for enabled environment backup
configs, complete backup jobs from agent-reported backup results, queue
`backup_cleanup` jobs for expired artifacts, and complete cleanup jobs from
agent-reported deletion results. Current agents only claim supported
cleanup/deploy work, so backup jobs remain queued until agent artifact upload
and retention deletion execution are implemented.

Each job must be idempotent around uploaded object keys and restore target
runtime IDs.
