# AI Agent Guidelines for /dev/push

This document provides comprehensive guidelines for AI agents working on the /dev/push codebase. It covers scripts, FastAPI application code, Docker/Compose, and project-wide conventions.

## Table of Contents

- [Scripts (`scripts/`)](#scripts-scripts)
- [FastAPI Application (`app/`)](#fastapi-application-app)
- [Docker & Compose](#docker--compose)
- [Project Structure](#project-structure)
- [General Conventions](#general-conventions)
- [Testing & Deployment](#testing--deployment)

---

## Scripts (`scripts/`)

These guidelines apply to every script under `scripts/` (install/start/stop/restart/helpers/etc.).

### Environment Detection & Paths

1. **Always source `scripts/lib.sh`** (use the `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` pattern, then `source "$SCRIPT_DIR/lib.sh"`). The lib sets `APP_DIR`, `DATA_DIR`, `ENV_FILE`, etc., and auto-detects dev vs prod via systemd or `DEVPUSH_ENV`.
2. **Do not hardcode relative paths.** Derive everything from `APP_DIR`, `DATA_DIR`, or `SCRIPT_DIR`.
3. **Expose overrides via `DEVPUSH_*` env vars** (already handled by the lib).

### Docker / Compose Usage

1. Call `ensure_compose_cmd` before issuing any compose commands (or rely on `set_compose_base` which calls it internally).
2. Use `set_compose_base` to populate `COMPOSE_BASE` (reads `SSL_PROVIDER` from `.env` internally).
3. Run compose via `run_cmd "Message..." "${COMPOSE_BASE[@]}" <subcommand> …`. Never spell `docker compose` / `docker-compose` directly.
4. `set_compose_base` also ensures `SERVICE_UID`/`SERVICE_GID` are exported so Docker builds run with the correct user. Never assume UID/GID 1000; always go through the helper.

### Output & Spacing

1. **Use `run_cmd` for every non-trivial operation** (package installs, docker commands, helper scripts). It handles spinners, logging, and error capture.
2. At the top of each logical section add a short comment (`# Install Docker`, `# Start stack`, etc.) so the script reads like a TOC. Skip obvious blocks like `usage()`.
3. For blank lines between major blocks, call `printf '\n'` once—no bare `echo`.
4. When printing status messages manually (e.g., final "Success" line), use `printf "${GRN}…${NC}\n"` for consistency.
5. Use parent/child command structure for multi-step operations:
   ```bash
   printf "Installing...\n"
   printf "%s Building runner images...\n" "$CHILD_MARK"
   build_runner_images
   run_cmd "${CHILD_MARK} Starting services..." "${COMPOSE_BASE[@]}" up -d
   ```

### Flags & CLI UX

1. Keep flag sets minimal; only add options when they're truly needed (e.g., `--no-migrate`, `--timeout <value>`).
2. In usage blocks, show value placeholders as `<value>` and list allowed values inline.
3. Validate flag values early and exit via `usage` on invalid input.
4. For sensitive input (tokens, passwords), make flags optional and prompt securely with `read -s` if not provided and TTY is available.

### Helper Scripts

1. Prefer shared helpers over inline logic:
   - Runner images: call `build_runner_images` (emits child lines per runner).
   - DB migrations: `run_cmd "Running database migrations..." bash "$SCRIPT_DIR/db-migrate.sh"`.
2. If a helper emits output, rely on its own logging (no extra text before/after unless absolutely necessary).

### Comments & Structure

1. Break scripts into clear sections with comments (e.g., `# Create data directories`, `# Validate core env`).
2. Within a section, keep related commands together and avoid interleaving unrelated work.
3. Use `set -Eeuo pipefail` and a trap that prints the last command and `SCRIPT_ERR_LOG` (see `start.sh` / `install.sh` for reference).
4. It's fine to precede the argument-parsing block with a short comment like `# Parse CLI flags` for readability.

### Miscellaneous

1. Avoid `echo` unless you truly need the "no newline" behavior; prefer `printf`.
2. When running commands as the service user from privileged scripts (e.g., install), wrap them in `runuser -u "$user" -- bash -c '…'` so files are owned by `devpush`.
3. When creating files/dirs that might already exist, guard with `[[ ! -f … ]]` / `install -d …` and let them be no-ops if present.
4. For comment documentation aimed at future maintainers, keep it short and factual—no personal notes or TODOs; use `AGENTS.md` instead.
5. Use `validate_env "$ENV_FILE" "$ssl_provider"` whenever you need to enforce required environment variables; it handles core values and SSL-provider-specific secrets for production.

---

## FastAPI Application (`app/`)

### Project Structure

- `app/routers/`: Route handlers organized by domain (auth, project, team, user, admin, etc.)
- `app/forms/`: WTForms form definitions (one file per domain)
- `app/models.py`: SQLAlchemy ORM models
- `app/services/`: Business logic services (GitHub, deployment, domain, Loki, etc.)
- `app/utils/`: Utility functions (access control, pagination, color, etc.)
- `app/templates/`: Jinja2 templates organized by domain
- `app/workers/`: Background workers (arq, monitor) and tasks
- `app/config.py`: Pydantic settings and configuration
- `app/dependencies.py`: FastAPI dependencies and template helpers
- `app/db.py`: Database connection and session management

### Routing Conventions

1. **Router organization**: One router per domain (auth, project, team, user, admin, etc.)
2. **Route naming**: Use `name="route_name"` for URL generation via `request.url_for()`
3. **Dependencies**: Use FastAPI's `Depends()` for dependency injection:
   - `get_current_user`: Require authentication
   - `get_db`: Database session
   - `get_settings`: Application settings
   - `get_team_by_slug`: Team access control
   - `get_role`, `get_access`: Permission checks
4. **Template responses**: Always use `TemplateResponse` from `dependencies.py` (handles HTMX fragment wrapping automatically)
5. **Flash messages**: Use `flash()` helper from `dependencies.py` for user notifications

### Forms (WTForms)

1. **File organization**: One form file per domain (e.g., `forms/project.py`, `forms/team.py`)
2. **Form classes**: Inherit from `StarletteForm` (from `starlette-wtf`)
3. **Validation**: Use WTForms validators; custom validation in `validate_<fieldname>()` methods
4. **Translation**: Use `_l()` helper for translatable labels (e.g., `_l("Create team")`)
5. **Form handling**: Use `await FormClass.from_formdata(request)` and `await form.validate_on_submit()`

### Templates (Jinja2)

1. **Structure**: Organized by domain with `pages/`, `partials/`, and `macros/` subdirectories
2. **Layouts**: 
   - `layouts/base.html`: Main layout
   - `layouts/app.html`: Authenticated app layout
   - `layouts/fragment.html`: HTMX fragment wrapper (auto-applied by `TemplateResponse`)
3. **HTMX**: Templates automatically wrapped in fragment layout when `HX-Request` header is present
4. **Macros**: Reusable components in `macros/` (toast, dialog, select, tabs, etc.)
5. **Translation**: Use `_()` function in templates (defined in `dependencies.py`)
6. **Flash messages**: Access via `get_flashed_messages()` global function

### Models (SQLAlchemy)

1. **Base class**: All models inherit from `Base` (defined in `db.py`)
2. **Async**: Use async SQLAlchemy (`AsyncSession`, `select()`, `await db.execute()`)
3. **Relationships**: Use `selectinload()` or `joinedload()` for eager loading
4. **Timestamps**: Use `utc_now()` helper for `created_at`/`updated_at` fields
5. **Encryption**: Use `get_fernet()` helper for encrypted fields (e.g., OAuth tokens)

### Services

1. **Purpose**: Business logic that doesn't belong in routers or models
2. **Examples**: `GitHubService`, `DeploymentService`, `DomainService`, `LokiService`
3. **Dependency injection**: Services should be created via dependency functions (e.g., `get_github_service()`)

### Configuration

1. **Settings**: All configuration via `Settings` class in `app/config.py` (Pydantic `BaseSettings`)
2. **Paths**: Centralized in `Settings`:
   - `data_dir`: `/var/lib/devpush` (prod) or `./data` (dev)
   - `app_dir`: `/opt/devpush` (prod) or project root (dev)
   - `upload_dir`, `traefik_dir`, `env_file`, `config_file`, `version_file`: Derived from `data_dir`
3. **Environment variables**: Loaded from `.env` file (path from `settings.env_file`)
4. **Secrets**: Stored in `.env` file, never committed to git

### Database Migrations

1. **Tool**: Alembic (configured in `app/alembic.ini`)
2. **Location**: `app/migrations/versions/`
3. **Naming**: Descriptive names (e.g., `454328a03102_initial.py`, `87a893d57c86_allowlist.py`)
4. **Running**: Use `scripts/db-migrate.sh` (handles waiting for DB to be ready)

### Workers

1. **ARQ worker**: `app/workers/arq.py` - Handles async job queue
2. **Monitor worker**: `app/workers/monitor.py` - Monitors deployment containers
3. **Tasks**: `app/workers/tasks/` - Individual task implementations (deploy, cleanup, etc.)
4. **Job queue**: Access via `get_job_queue()` dependency (returns `ArqRedis` connection)

### Code Style

1. **Imports**: Group by standard library, third-party, local
2. **Type hints**: Use modern Python type hints (`str | None` instead of `Optional[str]`)
3. **Async/await**: All database and HTTP operations should be async
4. **Error handling**: Use FastAPI's `HTTPException` for HTTP errors
5. **Logging**: Use `logging.getLogger(__name__)` for module-level loggers
6. **Comments**: Minimize comments; code should be self-documenting
7. **Variable names**: Keep them short and simple; don't rename existing functions/variables

---

## Docker & Compose

### Compose Files

1. **Base files**:
   - `compose/base.yml`: Main application stack
   - `compose/override.yml`: Production overrides
   - `compose/override.dev.yml`: Development overrides
   - `compose/ssl-*.yml`: SSL provider-specific overrides

2. **Naming**: Use `run` mode (not `app` or `stack`) for the main application stack

3. **Environment variables**: Use `${VAR:-default}` syntax in compose files

4. **Volumes**:
   - Application data: `${DATA_DIR:-../data}` → `/var/lib/devpush`
   - Named volumes: `devpush-db`, `loki-data`, `alloy-data` (for stateful services)

### Dockerfiles

1. **Location**: `docker/` directory
2. **App**: `Dockerfile.app` (prod) and `Dockerfile.app.dev` (dev). Both accept `APP_UID`/`APP_GID` build args (populated via `SERVICE_UID`/`SERVICE_GID`) so the container user matches the host service user.
3. **Runners**: `docker/runner/Dockerfile.*` (one per language/runtime)
4. **Entrypoints**: `entrypoint.*.sh` scripts for container initialization

### Container Services

1. **app**: FastAPI application
2. **worker-arq**: ARQ background worker
3. **worker-monitor**: Monitor background worker
4. **pgsql**: PostgreSQL database
5. **redis**: Redis cache/queue
6. **traefik**: Reverse proxy and SSL termination
7. **loki**: Log aggregation
8. **alloy**: Telemetry agent (ships logs to Loki)

---

## Project Structure

### Directory Layout

```
/
├── app/                    # FastAPI application
│   ├── routers/           # Route handlers
│   ├── forms/             # WTForms definitions
│   ├── templates/         # Jinja2 templates
│   ├── services/          # Business logic services
│   ├── workers/           # Background workers
│   ├── utils/             # Utility functions
│   ├── migrations/        # Alembic migrations
│   └── ...
├── compose/               # Docker Compose files
├── docker/                # Dockerfiles and entrypoints
├── scripts/               # Shell scripts
│   ├── lib.sh            # Shared library functions
│   ├── provision/        # Provisioning scripts
│   └── upgrades/         # Version upgrade hooks
└── data/                  # Local dev data (gitignored)
```

### Path Conventions

1. **Production**:
   - Code: `/opt/devpush`
   - Data: `/var/lib/devpush`
   - Config: `/var/lib/devpush/config.json`
   - Env: `/var/lib/devpush/.env`

2. **Development**:
   - Code: Project root
   - Data: `./data`
   - Config: `./data/config.json`
   - Env: `./data/.env`

3. **Always use `settings.data_dir`, `settings.app_dir`, etc.** from `app/config.py` rather than hardcoding paths

---

## General Conventions

### Git Workflow

1. **Branches**:
   - `main`: Production branch
   - `development`: Staging branch
   - `feature/name`: Feature branches
   - `issue/123-name`: Issue branches

2. **PRs**: Submit against `development`, not `main`

3. **Commits**: Use conventional commits format: `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
   - Example: `feat(scripts): add upgrade hooks for version-specific migrations`

### Code Style

1. **Python**: Follow existing patterns; minimize comments; keep variable names short
2. **Shell**: Use `printf` instead of `echo`; prefer `run_cmd` for operations; keep scripts consistent
3. **No renaming**: Don't rename existing functions/variables unless explicitly requested

### Security

1. **Secrets**: Never commit secrets; use `.env` file (gitignored)
2. **Sessions**: Use signed cookies (Starlette `SessionMiddleware`)
3. **CSRF**: Enabled via `CSRFProtectMiddleware`
4. **Input validation**: Always validate user input (forms, query params, etc.)

### Error Handling

1. **Scripts**: Use `set -Eeuo pipefail` and ERR traps
2. **FastAPI**: Use `HTTPException` for HTTP errors; let exceptions bubble up for 500s
3. **Logging**: Log errors with appropriate level (ERROR, WARNING, INFO)

---

## Testing & Deployment

### Local Development

1. **Start stack**: `scripts/start.sh` (auto-detects dev mode)
2. **Stop stack**: `scripts/stop.sh`
3. **View logs**: `scripts/compose.sh logs [service]`
4. **Run migrations**: `scripts/db-migrate.sh`
5. **Clean data**: `scripts/clean.sh`

### Production Deployment

1. **Install**: `scripts/install.sh` (run as root/sudo)
2. **Update**: `scripts/update.sh` (run as root/sudo)
3. **Start/Stop**: `systemctl start/stop devpush.service` or `scripts/start.sh` / `scripts/stop.sh`
4. **Status**: `scripts/status.sh` or `systemctl status devpush.service`

### Provisioning

1. **Hetzner**: Use `scripts/provision/hetzner.sh` to provision a server
2. **Token**: Prompt securely if not provided via `--token` flag

### Upgrade Hooks

1. **Location**: `scripts/upgrades/X.Y.Z.sh`
2. **Naming**: Use stable version numbers only (no prerelease suffixes)
3. **Execution**: Hooks run if `current_version < hook_version <= target_version`
4. **Idempotent**: All operations must be idempotent (safe to run multiple times)

---

## Key Principles

1. **Consistency**: Follow existing patterns; don't introduce new conventions without good reason
2. **Simplicity**: Keep code simple and straightforward; avoid over-engineering
3. **Documentation**: Update this file when introducing new patterns or conventions
4. **User experience**: Scripts should provide clear feedback (spinners, success messages, error details)
5. **Security**: Never expose secrets; validate all input; use secure defaults

---

Following these guidelines keeps the codebase maintainable and consistent. When in doubt, mirror existing patterns in similar files. If you need to deviate, explain why in a comment and update this file.
