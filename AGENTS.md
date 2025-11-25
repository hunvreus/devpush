# Internal Scripting Guidelines

These guidelines apply to every script under `scripts/` (install/start/stop/restart/helpers/etc.). Other parts of the repo (FastAPI, docs, etc.) can have their own conventions, but anything in `scripts/` should follow the rules below so everything stays consistent.

## Environment Detection & Paths

1. **Always source `scripts/lib.sh`** (use the `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` pattern, then `source "$SCRIPT_DIR/lib.sh"`). The lib sets `APP_DIR`, `DATA_DIR`, `ENV_FILE`, etc., and auto-detects dev vs prod via systemd or `DEVPUSH_ENV`.
2. **Do not hardcode relative paths.** Derive everything from `APP_DIR`, `DATA_DIR`, or `SCRIPT_DIR`.
3. **Expose overrides via `DEVPUSH_*` env vars** (already handled by the lib).

## Docker / Compose Usage

1. Call `ensure_compose_cmd` before issuing any compose commands (or rely on `get_compose_base` which calls it internally).
2. Use `get_compose_base <mode> [ssl-provider]` (`mode` is `run` or `setup`) to populate `COMPOSE_BASE`.
3. Run compose via `run_cmd "Message..." "${COMPOSE_BASE[@]}" <subcommand> …`. Never spell `docker compose` / `docker-compose` directly.

## Output & Spacing

1. **Use `run_cmd` for every non-trivial operation** (package installs, docker commands, helper scripts). It handles spinners, logging, and error capture.
2. At the top of each logical section add a short comment (`# Install Docker`, `# Start stack`, etc.) so the script reads like a TOC. Skip obvious blocks like `usage()`.
3. For blank lines between major blocks, call `printf '\n'` once—no bare `echo`.
4. When printing status messages manually (e.g., final “Success” line), use `printf "${GRN}…${NC}\n"` for consistency.

## Flags & CLI UX

1. Keep flag sets minimal; only add options when they’re truly needed (e.g., `--setup`, `--no-migrate`, `--ssl-provider <value>`).
2. In usage blocks, show value placeholders as `<value>` and list allowed values inline.
3. Validate flag values early and exit via `usage` on invalid input.

## Helper Scripts

1. Prefer shared helpers over inline logic:
   - Runner images: call `run_cmd "Building runner images..." bash "$SCRIPT_DIR/build-runners.sh"`.
   - DB migrations: `run_cmd "Running database migrations..." bash "$SCRIPT_DIR/db-migrate.sh"`.
2. If a helper emits output, rely on its own logging (no extra text before/after unless absolutely necessary).

## Comments & Structure

1. Break scripts into clear sections with comments (e.g., `# Create data directories`, `# Validate core env`).
2. Within a section, keep related commands together and avoid interleaving unrelated work.
3. Use `set -Eeuo pipefail` and a trap that prints the last command and `SCRIPT_ERR_LOG` (see `start.sh` / `install.sh` for reference).
4. It's fine to precede the argument-parsing block with a short comment like `# Parse CLI flags` for readability.

## Miscellaneous

1. Avoid `echo` unless you truly need the “no newline” behavior; prefer `printf`.
2. When running commands as the service user from privileged scripts (e.g., install), wrap them in `runuser -u "$user" -- bash -c '…'` so files are owned by `devpush`.
3. When creating files/dirs that might already exist, guard with `[[ ! -f … ]]` / `install -d …` and let them be no-ops if present.
4. For comment documentation aimed at future maintainers, keep it short and factual—no personal notes or TODOs; use `AGENTS.md` instead.
5. Use `validate_env "$ENV_FILE" "$ssl_provider"` whenever you need to enforce required environment variables; it handles core values and SSL-provider-specific secrets for production.

Following these rules keeps `start/stop/restart/install/update` readable and ensures new scripts fit the existing tooling. When in doubt, mirror the current `scripts/start.sh` and `scripts/install.sh` structure. If you need to deviate, explain why in a comment and update this file.

