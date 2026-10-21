---
description: Inspect and resolve blocked resource deletion without discarding cleanup evidence.
---

# Recover blocked deletions

This guide is for installation operators. Ordinary project, team or server
deletion starts in the dashboard. Use this workflow only when cleanup cannot
finish, for example after a server is lost or a retained runtime needs removal.

Do not mark data removed just to clear a warning. Confirming cleanup is a record
of work you have already verified; it does not perform that work on an unreachable host.

## Inspect the blocker


`pnpm cleanup:recover` is an installation-operator command with direct main-database
access, not a team API. Run it from a checkout with dependencies installed and
the intended installation's database configuration. It never resets databases.
SQLite must already exist; use `DEVPUSH_DATABASE_PATH` to select its absolute path.
For libSQL, set `DEVPUSH_DATABASE_URL` and `DEVPUSH_DATABASE_AUTH_TOKEN`.
Add `--cloudflare` for the main D1 binding and explicit account in the generated
Wrangler configuration; this uses Wrangler authentication, not application API keys.
`DEVPUSH_WRANGLER_CONFIG` selects another configuration. For Cloudflare libSQL,
provide its URL/token instead of using `--cloudflare`.

Start with inspection:

```bash
pnpm cleanup:recover list
pnpm cleanup:recover inspect project PROJECT_ID
pnpm cleanup:recover inspect job JOB_ID
pnpm cleanup:recover inspect artifact ARTIFACT_ID
```

Inspection also accepts `team` and `server`. It reports selected job state,
retained environments and archive references, excluding credentials. Each list
is capped at 101 rows; inspect individual IDs rather than assuming a truncated
report is a complete inventory. Reports include a revision for the selected target.

## Choose a recovery action

- `retry-job JOB_ID` requeues an unsuccessful terminal container-cleanup job.
  Restore agent connectivity first. Attempts are preserved; the job gets ten more
  attempts. Any remaining volume-retention delay is preserved. It does not replay
  deployments, backups or restores.
- `cleanup-project PROJECT_ID` queues normal deprovision/purge jobs for a deleted
  project's intentionally retained runtimes, including the normal volume-retention
  delay. It does not delete files from the operator's machine.
- `confirm-job JOB_ID` records that all external effects of that job have been
  resolved manually. For deprovision this means containers/routes are removed;
  purge also requires removing retained volumes. An unsuccessful execution stays
  canceled with explicit resolution evidence, rather than becoming a successful
  deployment or backup. Backup-cleanup confirmation releases its run reservations;
  archive references still require individual confirmation.
- `confirm-artifact ARTIFACT_ID` removes only the recorded reference after the
  exact local/remote archive has been removed manually. Check its storage location,
  object key and checksum first. This command does not delete external files and
  rejects active backup/cleanup work.

## Preview and apply

Every mutation requires the current inspection revision, an operator identity and
evidence/reason. Without `--apply` it previews the operation:

```bash
pnpm cleanup:recover retry-job JOB_ID --revision REVISION \
  --operator OPERATOR --reason "Agent reconnected; retry container cleanup"
# Repeat the same command with --apply after reviewing the preview.
```

## Verify before confirming removal

Never confirm removal merely because an agent is unreachable. Reconnect it and
retry, or stop/drain it and verify manual cleanup or permanent host destruction
before confirming. Running jobs are rejected, except container-cleanup claims that
have been stale for more than one hour (or have no claim timestamp), matching agent
cleanup recovery. Retrying cannot repair an incompatible agent; upgrade it when required.
Commands check their guards and record an audit entry atomically; concurrent
changes reject stale operations. Evidence stays in the job payload or backup-run
manifest, with actor/action records in `api_audit` under its normal retention.
Reports can contain infrastructure names and archive paths; keep them private.
Normal maintenance releases hostname reservations after confirmed container
removal and collects database records only after retention and all other blockers
are satisfied. No command provides a force-delete bypass.

