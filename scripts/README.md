# Scripts Guidelines

This file defines how shell scripts in `scripts/` should be written and formatted.

## Baseline

- Use:
  - `#!/usr/bin/env bash`
  - `set -Eeuo pipefail`
  - `IFS=$'\n\t'`
- Always resolve and source `lib.sh`:
  - `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`
  - `source "$SCRIPT_DIR/lib.sh"`
- Add an ERR trap with a clear failure message.

## Paths and Environment

- Do not hardcode project paths.
- Use variables from `lib.sh` (`APP_DIR`, `DATA_DIR`, `ENV_FILE`, `CHART_DIR`, etc.).
- Prefer `DEVPUSH_*` env overrides already exposed by `lib.sh`.

## Output and Formatting

- Use shared run helpers from `lib.sh`:
  - `run_cmd` for child-style quiet operations (`└─ ... [spinner]` + suffix status).
  - `run_cmd_plain` for root-level quiet operations (`... [spinner]` + suffix status).
  - `run_cmd_stream` for noisy operations that should stream logs (`docker build`, `helm upgrade`).
    - Supports `--indent <level>` to control streamed log indentation.
- Success/failure markers must be suffix-style:
  - `... ✔`
  - `... ✖`
- Streamed logs should remain dimmed/indented for readability.
- Add `printf '\n'` only between major logical blocks.

## Step Structure

- Use clear section headers only for grouped operations.
- Keep labels stable and explicit (example: `Ensuring Colima is running with Kubernetes...`).
- Use root-level spinner lines for standalone single-item actions (namespace/secret apply, etc.).

## CLI Flags

- Keep flag parsing near the top of the script.
- Validate flag values early and fail fast on invalid input.
- Current `start.sh` supports:
  - `--no-migrate` (compatibility no-op)
  - `--timeout <value>`
  - `-v|--verbose`
  - `-h|--help`

## Reliability and Idempotency

- Scripts should be safe to re-run.
- Prefer apply/upgrade patterns (`kubectl apply`, `helm upgrade --install`) over destructive operations.
- Add readiness waits for async infra operations (Kubernetes API, rollouts, etc.).

## Validation

- Validate required tools early (`require_cmd ...`).
- Validate key inputs/files early (`.env`, chart path, etc.).

## Scope

- `lib.sh` contains shared functional and output helpers.
- Keep script-specific logic in each script (`start.sh`, `stop.sh`, etc.).
- Do not duplicate helper logic across scripts.
