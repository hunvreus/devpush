# Contributing to /dev/push

**Support development by sponsoring the author: https://github.com/sponsors/hunvreus**

## General Guidelines

- Submit pull requests (PRs) against the `development` branch, not `main`.
- For branches:
  - `main` is the production and default branch.
  - `development` is for staging.
  - New features are worked in `feature/name-of-the-feature` branches.
  - Issues are addressed in `issue/123-main-issue` branches.
  - When ready, we PR against `development`, test it and then finally merge to `main`.
- Keep changes focused: one feature or fix per PR.
- Test locally before submitting.
- Follow existing code style.

## Production Scripts (`scripts/prod/`)

### Standard Conventions

- All scripts must use `set -Eeuo pipefail` and error traps
- Capture stderr to `SCRIPT_ERR_LOG` (e.g., `/tmp/scriptname_error.log`)
- Source `lib.sh` for common functions (`err`, `run_cmd`, `run_cmd_try`)
- Argument parsing: Handle unknown options with `err "Unknown option: $1"; usage; exit 1`

**Usage Functions:**

- Exit 0 for `-h/--help`
- Exit 1 for invalid arguments
- Must be defined before argument parsing

**Privilege Model:**

- `/var/lib/devpush`: Root-owned (0755), accessed via `sudo`
- `/srv/devpush`: Owned by UID/GID 1000 (app container user)
- Use `sudo` for all operations on `/var/lib/devpush`
- Scripts work whether run as root (sudo is no-op) or devpush user (passwordless sudo via `/etc/sudoers.d/devpush`)

**File Operations:**

- Use `sudo test -f` instead of `[[ -f ]]` for root-owned files
- Use `sudo jq` for reading/writing root-owned JSON files
- Merge JSON with `jq '. + {new: $val}'` to preserve existing fields
- Always use temp files + atomic move for writes: `sudo tee file.tmp >/dev/null && sudo mv file.tmp file`
- Atomic moves prevent partial reads by other processes

**TTY Detection:**

- Check `[[ -t 1 ]]` before displaying spinners
- Check `[[ -t 0 ]]` before prompting for user input
- Non-interactive mode: require `--yes` flag for destructive operations

**Version Comparison:**

- Use `sort -V` for semantic version sorting
- Prerelease versions: `sort -V` treats `0.1.0 < 0.1.0-alpha < 0.1.0-beta < 0.1.0-rc`
- Note: This differs from semver (which treats `0.1.0-beta < 0.1.0`)

### Upgrade Hooks (`scripts/prod/upgrades/`)

**File Naming:**

- Use stable version numbers only: `X.Y.Z.sh` (e.g., `0.1.1.sh`, `1.0.0.sh`)
- No prerelease suffixes (e.g., no `0.1.0-beta.10.sh`)

**Execution Logic:**

- Hooks run if: `current_version < hook_version <= target_version`
- Versions are normalized (prerelease suffix stripped) before comparison
- Hooks are sorted with `sort -V` and executed in order
- Failed hooks log a warning but don't stop the update (idempotent design)

**Hook Structure:**

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

echo "Description of what this upgrade does..."

# Idempotent operations only
if [[ -d /var/lib/devpush ]]; then
  sudo chown -R root:root /var/lib/devpush 2>/dev/null || true
fi

exit 0
```

## Code Style

**Shell Scripts:**

- No comments unless absolutely necessary
- Keep variable names short and simple
- Do not rename existing functions/variables
- Use `run_cmd` and `run_cmd_try` from `lib.sh` for user-facing operations
- Prefer `grep -q` over `wc -l` for existence checks

**Python:**

- Follow existing patterns in the codebase
- Minimize comments

## Testing

- Test install script on a fresh Ubuntu/Debian VM
- Test update paths (beta → beta, beta → stable, stable → stable)
- Verify blue-green rollouts work for app and workers
- Check error handling in non-interactive mode

## Commit Messages

- Use conventional commits format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Examples:
  - `feat(scripts): add upgrade hooks for version-specific migrations`
  - `fix(install): use sudo for /var/lib/devpush operations`
  - `docs(contributing): add production scripts conventions`

---

Thanks for helping!
