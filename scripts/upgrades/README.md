# Upgrade Hooks and Update Metadata

This directory contains versioned upgrade hooks and optional update metadata.

## Upgrade Hooks
- File format: `X.Y.Z.sh`
- Purpose: Idempotent upgrade steps that must run when moving across versions.

## Update Metadata
- File format: `X.Y.Z.json`
- Purpose: Declarative update scope defaults and user-facing reason.
- Note: without metadata or CLI overrides, `update.sh` defaults to updating `app` only.
- Keys:
  - `full` (boolean) to force a full stack update (equivalent to `--full`)
  - `components` (string) to default to a component set
  - `reason` (string) displayed to the user during update prompts

### Example (full update)
```json
{
  "full": true,
  "reason": "Postgres image upgrade requires full stack restart"
}
```

### Example (components update)
```json
{
  "components": "app,worker-jobs,worker-monitor",
  "reason": "Only app and workers changed"
}
```
