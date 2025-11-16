# Setup Migration: Go → Python/FastAPI

## Summary
Migrated from standalone Go setup app to integrated Python/FastAPI multi-step setup flow.

## What Changed

### Removed
- `setup/` directory (Go app, handlers, templates, binaries)
- `scripts/prod/setup.sh`

### Added
- `app/forms/setup.py` - WTForms for 3 setup steps
- `app/routers/setup.py` - Setup router with combined GET/POST routes
- `app/templates/setup/` - 5 page templates + progress indicator

### Modified
- `app/main.py` - Added `check_setup_complete()` function and conditional route loading
- `scripts/prod/install.sh` - Starts app and shows setup URL

## Architecture

### Setup Flow
1. **Domains & SSL** - Configure hostnames, LE email, SSL provider credentials
2. **GitHub App** - Create app via manifest or enter credentials manually
3. **Email** - Configure Resend API key and sender address
4. **Review** - Confirm all settings before applying

### Key Design Decisions

#### Conditional Route Loading (Fail-Safe Design)
- Check setup state once at startup (`SETUP_COMPLETE` module-level constant)
- **If setup incomplete (`not SETUP_COMPLETE`)**: only `/setup/*` routes loaded (explicit)
- **If setup complete (else)**: normal app routes loaded (safe default)
- Symmetric conditional imports for clarity
- Any bug/exception defaults to normal mode (safer than allowing reconfiguration)
- Requires restart to switch modes (which happens automatically via `restart.sh`)

#### GitHub App Creation
- **No popup/postMessage** - GitHub redirects directly to `/setup/github/callback`
- Callback exchanges code for credentials via GitHub API
- Credentials saved to session and pre-fill form on redirect to step 2
- Simple form POST to GitHub manifest endpoint

#### Session-Based State
- Each step saves to `request.session['setup_data']`
- Current step tracked in `request.session['setup_step']`
- Survives GitHub redirect roundtrip
- Cleared after successful completion

#### Final Submission
- Writes `.env` file (preserves SECRET_KEY, ENCRYPTION_KEY, POSTGRES_PASSWORD, SERVER_IP)
- Writes `/var/lib/devpush/config.json` with `setup_complete: true`
- Calls `scripts/prod/restart.sh` to apply changes
- App restarts, reads flag, loads normal routes

## Installation Flow

```bash
# User runs install script
sudo bash scripts/prod/install.sh

# Script installs dependencies, Docker, creates user, clones repo
# Writes initial .env with generated secrets
# Starts application with docker compose up -d
# Shows: "Complete setup at http://<IP>:8000/setup"

# User visits URL, completes 4-step setup wizard
# On final submit:
#   - .env updated with user config
#   - config.json created with setup_complete: true
#   - restart.sh called
#   - App restarts in normal mode
# User redirected to https://<app_hostname>
```

## Testing Checklist

- [ ] Fresh install shows setup UI at root
- [ ] Step 1: Form validation works
- [ ] Step 1: SSL provider fields show/hide based on dropdown
- [ ] Step 2: "Create GitHub App" button posts manifest to GitHub
- [ ] Step 2: GitHub callback saves credentials to session
- [ ] Step 2: Redirect to step 2 pre-fills form
- [ ] Step 2: Manual credential entry works
- [ ] Step 3: Email form validates
- [ ] Step 4: Review shows all settings (sensitive fields redacted)
- [ ] Step 4: Final submit writes .env correctly
- [ ] Step 4: config.json gets `setup_complete: true`
- [ ] restart.sh executes successfully
- [ ] After restart, visiting root redirects to auth/login
- [ ] After restart, visiting /setup redirects to root

## API Endpoints

### Setup Routes (only loaded when `not SETUP_COMPLETE`)
- `GET /` → redirects to `/setup`
- `GET /setup` → redirects to current step
- `GET|POST /setup/step/1` → Domains & SSL form
- `GET|POST /setup/step/2` → GitHub App form
- `GET|POST /setup/step/3` → Email form
- `GET /setup/step/4` → Review page
- `POST /setup/step/4` → Final submission, restart
- `GET /setup/github/callback` → GitHub manifest conversion callback

### Normal Routes (only loaded when `SETUP_COMPLETE` / else branch)
- `GET /` → redirects to user's default team
- All auth, admin, user, project, github, team, event routes
- Setup routes are NOT loaded (don't exist in route table)
- **This is the safe default** - any error reading config falls through to here

## Benefits

1. **Single stack** - No Go dependency, pure Python/FastAPI
2. **Code reuse** - Same templates, styling, components as main app
3. **Simpler maintenance** - One codebase instead of two
4. **Progressive validation** - Each step validated before next
5. **Session persistence** - Survives external redirects (GitHub)
6. **No popup complexity** - Simple redirect flow
7. **Future extensibility** - Can expose settings in admin panel

## Notes

- Setup state checked **once** at startup (no runtime overhead)
- No middleware (routes literally don't exist in the other mode)
- Uses existing form libraries (WTForms, Alpine.js, HTMX)
- Follows existing code patterns (combined GET/POST routes)
- SSL provider credentials conditionally collected based on dropdown

