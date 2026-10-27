---
description: Inspect and resolve blocked resource cleanup.
---

# Recover blocked deletions

For installation operators when dashboard cleanup cannot finish. This tool accesses the main database directly; it does not use team API credentials or reset databases.

Confirming cleanup records work you have **already verified**. It does not remove files from an unreachable host. Never confirm just to clear a warning or delete rows by hand.

## Select the installation

Run from a source checkout with dependencies installed:

- SQLite: `DEVPUSH_DATABASE_PATH`, an absolute path to an existing file.
- libSQL: `DEVPUSH_DATABASE_URL` and `DEVPUSH_DATABASE_AUTH_TOKEN`.
- D1: add `--cloudflare`, using the intended account/main binding and Wrangler authentication. `DEVPUSH_WRANGLER_CONFIG` selects another configuration.

## Inspect

```sh
pnpm cleanup:recover list
pnpm cleanup:recover inspect project PROJECT_ID
pnpm cleanup:recover inspect job JOB_ID
pnpm cleanup:recover inspect artifact ARTIFACT_ID
```

Inspection also accepts `team` and `server`. Reports include a revision required for changes. Lists stop at 101 rows; inspect specific IDs if truncated. Keep reports private.

## Choose an action

- `retry-job JOB_ID`: retry unsuccessful terminal container cleanup after restoring connectivity. It does not replay deployments/backups/restores or bypass volume retention.
- `cleanup-project PROJECT_ID`: queue normal cleanup for a deleted project's deliberately retained runtimes.
- `confirm-job JOB_ID`: record verified manual completion of its external effects. Container cleanup requires routes/containers removed; purge also requires volumes removed. Archive references need separate confirmation.
- `confirm-artifact ARTIFACT_ID`: forget an archive reference **after** verifying deletion of the exact object using its location/key/checksum. This does not delete the object.

## Preview, then apply

```sh
pnpm cleanup:recover retry-job JOB_ID --revision REVISION \
  --operator OPERATOR --reason "Agent reconnected; retry container cleanup"
```

Without `--apply`, this only previews. Add `--apply` after reviewing it. Each change verifies the current revision and records evidence atomically; concurrent changes reject stale requests.

Running work normally blocks confirmation. Stale container-cleanup claims have a one-hour exception, but an unreachable agent alone is never proof of removal. Reconnect/retry, or stop/drain the agent and verify manual cleanup or permanent host destruction first. There is no force-delete bypass.
