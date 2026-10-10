# Local setup

## Requirements

- Node.js 22 or newer.
- pnpm 10.17 or newer.
- Go 1.27 or newer.
- Docker for testing agent deployments.

## Control plane

```bash
cp app/.env.example app/.env
pnpm install
pnpm --dir app db:migrate
pnpm --dir app dev
```

The app uses `http://localhost:7429` as its default local origin. Startup fails
if that port is already in use.

For normal local testing with the Lima agent VM:

```bash
pnpm dev:start
pnpm dev:stop
pnpm dev:restart
```

`pnpm dev:start` requires the `devpush-test` Lima VM by
default, syncs the database, and starts the control plane in the background.
Use `DEVPUSH_LIMA_INSTANCE=name` for another VM, or `DEVPUSH_REQUIRE_LIMA=0`
when testing only the web app. The dev server log is `.tmp/devpush-dev.log`.

### Control-plane origin and agent connectivity

`DEVPUSH_BASE_URL` is the canonical public origin for generated links, server
enrollment, and agent communication. A generated installer exports it as
`DEVPUSH_BASE_URL`, persists it in `/etc/devpush/agent.env`, and the systemd
service loads it on every start. The agent uses that URL for registration,
heartbeats, jobs, logs, and binary updates.

`BETTER_AUTH_URL` is an optional auth-only origin. It defaults to
`DEVPUSH_BASE_URL`, but can differ when the browser and agent need different
names for the same local control plane. For a Lima agent, use:

```env
DEVPUSH_BASE_URL=http://host.lima.internal:7429
BETTER_AUTH_URL=http://localhost:7429
```

Inside Lima, `host.lima.internal` resolves to the macOS host. The browser keeps
using localhost for authentication, while the generated installer and agent use
the Lima-reachable base URL. Verify it from the VM before enrollment:

```bash
limactl shell devpush-test curl http://host.lima.internal:7429/api/health
```

Use the actual Lima instance name through `DEVPUSH_LIMA_INSTANCE` when it is not
`devpush-test`. Use a stable HTTPS origin for a remote server or any flow that
must be internet-accessible.

For temporary remote-agent testing, a Cloudflare Quick Tunnel must remain
running alongside the local control plane. When its process stops, the remote
agent loses its route to the laptop and appears disconnected even if the host,
agent service, and deployed containers are healthy. A new Quick Tunnel can have
a different URL; existing agents retain the previous URL. Check the persisted
`DEVPUSH_BASE_URL`, agent logs, and tunnel process before treating this as a host
outage. Quick Tunnel hostnames cannot be reused after the tunnel is recreated.
Use a stable named tunnel hostname for repeated remote testing. When forwarding
into Vite, `--http-host-header localhost` avoids granting a whole shared hostname
suffix access through Vite's host allowlist.

The shared remote test server uses the named tunnel `devpush-local` at
`https://devpush-local.hostnull.com`, forwarding to `http://localhost:7429`.
Its Cloudflare-managed route sets the HTTP Host header to `localhost`.
From the repository root, start the connector alongside the local app:

```bash
.tmp/cloudflared/cloudflared tunnel --no-autoupdate run \
  --token-file .data/cloudflared/devpush-local.token
```

The connector token is a private, Git-ignored local credential (mode `0600`),
not an application environment variable. Keep it across development sessions.
Restarting this connector preserves the public hostname; stopping it or the
local app still makes the remote agent unavailable. The downloaded binary is
in `.tmp/cloudflared`; an installed `cloudflared` can run the same command.

On the shared macOS development machine, the connector is supervised by
`~/Library/LaunchAgents/com.devpush.local-tunnel.plist`. It starts at login and
restarts after exit, using `.data/cloudflared/cloudflared` and the existing token.
Logs are written to `.data/cloudflared/connector.log`. Check its state with
`launchctl print gui/$(id -u)/com.devpush.local-tunnel` and verify
`https://devpush-local.hostnull.com/api/health` returns HTTP 200. Cloudflare error
1033 means no healthy tunnel connector is available; a healthy local endpoint
alone does not prove remote agents can reach it. The dev start/stop commands
manage the local app, while launchd manages this connector independently.
The laptop must be awake, online, and running the local app. Use a hosted
control plane when remote agents need availability independent of the laptop.

Restoring a tunnel to the same control plane is endpoint recovery, not migration
to another installation. Preserve the agent's server ID, credentials and state
folder. First verify the new tunnel reaches the existing local instance, drain
active work and completion reports, then back up and atomically update only the
persisted URL. Restart the agent, require a confirmed heartbeat, and resume job
claims; restore the backup if confirmation fails. Deployed containers keep
running. Release the maintenance lock before invoking the separate resume
command, since that command acquires the same lock.

There is no UI setting for this runtime configuration. Change
`DEVPUSH_BASE_URL` and restart or redeploy the app before creating new install
commands. Existing agents keep their persisted URL and credentials. Use the
maintenance switch flow below instead of changing only the agent URL.

Agents installed before this configuration change may still have
`DEVPUSH_SERVER_URL` in that file. Rename the key to `DEVPUSH_BASE_URL` before
starting the updated agent, or reinstall the agent with a newly generated
command on a host that has not already enrolled.

## Agent maintenance

The root-owned updater `/usr/local/lib/devpush/update-agent` downloads and verifies
the binary, then invokes `devpush-agent maintenance update --binary PATH`.
Identical binaries do not restart the service. Changed binaries wait up to
30 minutes for the current job and its saved completion reports, with heartbeats
continuing. Timeout or delivery failure postpones the update and resumes claims.
An unsuccessful restart/confirmation heartbeat restores the previous binary.

Switch an empty server to another control plane:

1. Create a fresh server record on the destination and generate an install command.
2. Save only its `dps_...` enrollment token to a root-readable file on the VM.
3. Run:

```bash
sudo devpush-agent maintenance switch \
  --url https://destination.example.com --token-file /root/destination-token
```

The destination must use HTTPS and the source must support `/api/agents/switch`.
Managed projects, deployment history, Compose containers, and outstanding jobs
block switching. Destination credentials are isolated from the original state.
The source is disabled before selecting the new config; a failed confirmation
heartbeat restores the original config and re-enables the source. Applications
are never stopped by maintenance. Remove the disabled source record separately
after a successful switch.

For recovery, the original config and signed source rollback data are retained
as `/etc/devpush/agent.env.switch-backup` and its `.json` companion with mode
`0600`. Treat them as credentials. A process crash, power loss, or failed source
rollback requires operator recovery; automatic rollback covers reported runtime
errors, not an interrupted maintenance command. Failed staging may leave a
destination record and state directory; inspect before retrying.

`sudo devpush-agent maintenance drain` pauses claims without stopping the agent.
Use `sudo devpush-agent maintenance resume` to undo a manual drain. Maintenance
commands exclude concurrent maintenance operations. Agent binaries installed
before drain support cannot be upgraded automatically through this path; they
fail closed and require an operator-supervised idle bootstrap. Existing agents
must receive the updated updater before using the new safe update flow.

## Hetzner test server

Use `pnpm setup:hetzner` to create a disposable remote agent server without a
provider integration in the product. Requires Node.js 22 and a Hetzner Cloud
project API token (read/write for creation) in `HETZNER_API_TOKEN`.

1. Add a server in the staging devpush UI and save its install command in a
   private file, for example `.tmp/hetzner-install.sh` with permissions `0600`.
   The command must use the public staging HTTPS origin, not localhost or Lima.
2. Add your public SSH key to the same Hetzner project in Hetzner Console.
3. List current options, then choose names from the response:

```bash
pnpm setup:hetzner -- --list
pnpm setup:hetzner -- --name devpush-test --location REGION --type TYPE \
  --ssh-key KEY_NAME --install-file .tmp/hetzner-install.sh
```

The second command previews current server prices without creating anything.
The default image is Ubuntu 24.04; use `--image NAME` to select another compatible
system image. Public IP charges are additional. Repeat with `--create` to create
a billable server. The helper validates live availability and architecture, then
passes the command as cloud-init user data. It does not create a devpush record.

Creation output includes the Hetzner server ID and SSH address. Creation does not
prove enrollment succeeded: check the devpush server status and, through SSH,
`cloud-init status --wait` and `/var/log/cloud-init-output.log`. The command is
sent to Hetzner and stored on the VM; treat the file and cloud-init logs as secrets.
The helper never retries creation automatically. If the outcome is uncertain,
check Hetzner Console before rerunning to avoid duplicate servers.

The helper records its new server and Primary IP IDs in the Git-ignored
`.data/hetzner-test.json` (no API or enrollment tokens). Use `--state PATH` for
multiple test instances. An existing tracking file prevents another creation
from overwriting resource IDs. If creation is uncertain, the pending file is
retained; reconcile it through Hetzner Console before removing it or retrying.

Preview cleanup, then delete the tracked server and its newly created IPs:

```bash
node --env-file=.env scripts/setup-hetzner.mjs --destroy
node --env-file=.env scripts/setup-hetzner.mjs --destroy --yes
```

Cleanup retains state on failure so rerunning can resume. Missing resources are
accepted; IPs reassigned to another server are never deleted. This only cleans
resources tracked by this helper, not existing SSH keys, networks, firewalls,
volumes, or servers created before tracking was added. Remove the devpush record
separately. Powering off a server does not stop billing.

## Production control plane

The production Compose file builds the app and the Linux agent binary into
one control-plane image:

Copy the example, fill every blank secret in `deploy/.env.production` with an
independently generated value, then start Compose. The interactive
`pnpm configure` self-hosted path generates these values automatically.

```bash
cp deploy/.env.production.example deploy/.env.production
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
```

Set `DEVPUSH_BASE_URL` in `deploy/.env.production` to the public HTTPS URL before
adding servers. The server installer uses that URL to register agents and
download `/api/install/agent/binary`.

The one-shot `migrate` service runs reviewed SQL migrations with
`pnpm --dir app db:migrate` before starting the Node server. It never runs
`drizzle-kit push` in production. The app also mounts the `app_uploads` named volume at
`/repo/app/public/uploads` so uploaded avatars are not lost when the app
container is recreated. Both SQLite files persist in the `control_plane_data` volume mounted at `/app/storage`.

## Auth

Generate a Better Auth secret:

```bash
pnpm dlx @better-auth/cli@latest secret
```

Set these values in `app/.env`:

```bash
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
DEVPUSH_BASE_URL=http://localhost:7429
# BETTER_AUTH_URL=http://localhost:7429
DEVPUSH_ADMIN_EMAIL=admin@example.com
DEVPUSH_SECRET_ENCRYPTION_KEY=replace-with-a-separate-long-random-secret
```

The admin email is optional for local development; when blank, the first user
becomes the installation administrator. Set it explicitly for deployed
instances. Keep the encryption key stable: changing it makes stored secrets
unreadable.

### Email OTP with Resend

Sign-in waits for Resend to accept the email before displaying code entry.
The form shows sending/verifying progress immediately and stays disabled during
successful navigation. A request-scoped Better Auth hook makes OTP and account verification email failures
return HTTP 503 rather than being logged and swallowed by its background helper.
This confirms provider acceptance, not inbox delivery. UI and auth integration
tests cover pending requests, failures, retries, and concurrent sends.

Required:

```bash
EMAIL_FROM="devpush <noreply@example.com>"
RESEND_API_KEY=re_...
```

SMTP is not supported yet.

## Database

After changing Drizzle schemas:

```bash
pnpm --dir app db:generate
```

For local schema sync:

```bash
pnpm --dir app db:push
```

`db:push` is for disposable local databases and rapid schema iteration only.
Generate main migrations with `pnpm --dir app db:generate` and log migrations
with `pnpm --dir app db:generate:logs`. Commit both and apply them with
`pnpm --dir app db:migrate` for production-compatible validation.

Local SQLite files default to `app/.data/devpush.sqlite` and
`app/.data/logs.sqlite` when commands run from `app/`. Override them with
`DEVPUSH_DATABASE_PATH` and `DEVPUSH_LOG_DATABASE_PATH`; the paths must differ.
Database integration tests create isolated temporary SQLite and D1 stores and
apply committed migrations automatically:

```bash
pnpm test:integration
```

## CI checks and Worker smoke tests

UI actions should use `getErrorMessage` (or `getFieldErrorMessage`) with an
action-specific fallback. HTTP 5xx responses and recognized technical diagnostics
use that fallback; network failures and rate limits get retry guidance. Preserve
actionable validation messages, and keep full failure details in server logs.

Keep loading states active through navigation. Close confirmations only after
the mutation succeeds. Use `afterMutation` for refresh/navigation following a
committed write so a failed follow-up cannot be reported as a failed write.
Use `copyText` for clipboard feedback and `refreshView` for background refreshes;
query-driven lists must distinguish failures from empty results and stale data.

Account general settings share a validation schema between browser and server.
Required Name/Username errors and avatar errors stay inline; server validation
returns field errors rather than relying on serialized exception text.

Team general settings use the same pattern for name, slug, and avatar fields.
Account/team general settings submit through real forms and prevent changes
during saves. Server creation and editing share their naming constraints.

CI runs typecheck, full lint, unit tests, native SQLite and libSQL integration
suites, the Node build, Go tests/vet, and the high-severity dependency audit.
The D1 integration tests run in both integration invocations.

A separate job builds and executes Workers with both D1 and remote libSQL. It
checks login, concurrent health requests, and scheduled deletion of expired
records in the main and log stores. Run the same checks locally with:

```bash
pnpm --dir app smoke:worker d1
pnpm --dir app smoke:worker libsql
```

The libSQL smoke needs two disposable libSQL HTTP servers on loopback ports
7561 and 7562, as configured in `.github/workflows/ci.yml`. Override these with
`DEVPUSH_DATABASE_URL` and `DEVPUSH_LOG_DATABASE_URL`; non-loopback hosts are
rejected. The script migrates those databases and writes test records. D1 uses
isolated local storage. Both commands generate temporary configuration under
`app/.tmp/` and stop their Wrangler process afterward. They do not deploy.

TypeScript enables `noUncheckedIndexedAccess`: handle missing query rows and
indexed values explicitly. Keep runtime guards; avoid assertions that merely
hide possible missing data. Tests use `required()` when a fixture must exist.

Add UI components with `pnpm dlx shadcn@latest add ...`. The application keeps
its shadcn 4.19.0 stylesheet, with its license notice, in `src/styles/shadcn.css`;
using the CLI does not require retaining its dependencies in the application.

## Remote libSQL / Turso

Node and Cloudflare Workers can use two remote libSQL databases.
Choose **Turso / remote libSQL** during `pnpm configure`, or set:

```env
DEVPUSH_DATABASE_URL=libsql://your-main-database.turso.io
DEVPUSH_DATABASE_AUTH_TOKEN=your-main-token
DEVPUSH_LOG_DATABASE_URL=libsql://your-log-database.turso.io
DEVPUSH_LOG_DATABASE_AUTH_TOKEN=your-log-token
```

Both URLs are required and must identify separate databases. Tokens are optional
for a self-hosted libSQL server that does not require authentication. URLs take
precedence over file paths. Supported schemes are `libsql://`, `https://` and
`http://`; HTTP is useful for local server testing. Do not put credentials in URLs.
Without remote URLs, Node keeps using better-sqlite3 for local files. Workers
use their D1 bindings when neither remote URL is configured.

For Node, run `pnpm --dir app db:migrate` to apply both committed migration sets,
then start the app. For Workers, the wizard stores URLs and tokens in
`app/.cloudflare-secrets.json`; use `pnpm --dir app db:migrate:cloudflare`. This changes the selected storage; it does not copy existing
local data to the remote databases. Run only one migration process at a time.

The adapter sends guarded SQL batches through libSQL's atomic write batches.
It does not expose callback transactions or use embedded replicas. The local
Docker backup profile does not export remote databases; use the database
provider's backup/export tooling for both stores.

Run `pnpm --dir app test:integration:libsql` to exercise the shared service suite
through libSQL with disposable local databases. This verifies the adapter and
SQL behavior; hosted credentials and network availability require a separate
check against the configured service.

## Smoke checks

After applying both SQLite migration sets:

```bash
pnpm smoke:deploy
pnpm smoke:agent
pnpm validate:local
pnpm validate:config
pnpm validate:production
```

This seeds disposable data, registers a server, queues a deployment, claims it
through the agent job protocol with a fake GitHub token, completes it, verifies
deployment logs were stored, and cleans up the seeded rows. It does not run
Docker Compose on a target server; use it to validate the control-plane job
lifecycle before testing a real host.

`pnpm smoke:agent` runs the agent's real Docker Compose deployment path against
local Docker. It creates a temporary Git repo, deploys it with Compose, runs the
pre-deploy command, verifies the mounted output, and tears the Compose project
down.

The app test suite also executes the generated agent installer in a staged
filesystem root. That verifies the installer writes `agent.env`, installs the
agent binary, generates the systemd unit, and calls `systemctl enable --now`
without touching the real host filesystem.

`pnpm validate:local` runs the local validation gate before a remote VPS attempt:
TypeScript, linting, app tests, the control-plane deploy lifecycle smoke, agent
tests, smoke-mode config validation, and the real Docker/Traefik agent smoke.
Set `DEVPUSH_SKIP_DOCKER_SMOKE=1` only when Docker is unavailable.

Before validating a real remote server, run the stricter config check:

```bash
pnpm validate:config -- --env deploy/.env.production --remote
```

That verifies the public base URL, optional auth override, OAuth credentials, GitHub App private key,
Resend settings and the packaged agent binary directory. Remote validation
rejects localhost/private control-plane hosts and paths on `DEVPUSH_BASE_URL`.

Then validate the production image:

```bash
pnpm validate:production
```

This checks the production Compose config, builds the app image, and verifies
that the runtime image contains the Linux agent binary, the built server
entrypoint, and the migration tooling.

## Remote validation

Use this after the control plane is reachable from the internet and
`DEVPUSH_AGENT_BINARY_DIR` points to Linux agent binaries.

Create a server in devpush, copy the generated install command, then run:

```bash
DEVPUSH_BASE_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
pnpm validate:remote
```

`DEVPUSH_BASE_URL` and `DEVPUSH_PROJECT_URL` must use HTTPS by default. Set
`DEVPUSH_ALLOW_INSECURE_BASE_URL=1` only for local or private test networks.

The script checks:

- `/api/install/agent` and `/api/install/agent/binary` are reachable.
- SSH access to the remote server works.
- The generated install command completes.
- `/usr/local/bin/devpush-agent` exists.
- `/etc/devpush/agent.env` exists.
- `devpush-agent` is active in systemd.
- `devpush-agent` logs show registration or heartbeat activity after the remote
  validation run started.
- Docker and Docker Compose are available to both root and the `devpush` agent
  user.
- Recent `devpush-agent` systemd logs are readable for debugging.
- Optionally, the managed Traefik and Docker socket proxy containers are
  running.
- Optionally, the deployed public route responds within a retry window.
- A success summary is written to
  `.tmp/remote-validation-<timestamp>.md`, or to
  `DEVPUSH_REMOTE_SUMMARY_PATH` when set.

If a remote validation step fails, the script prints best-effort diagnostics:
remote system information, `devpush-agent` systemd status and logs, Docker
containers, Docker networks, and listeners on ports 80/443. Set
`DEVPUSH_REMOTE_DIAGNOSTICS=0` to disable this.

The success summary records the checked URLs, mode flags, remote host, and
timestamps. It does not record the generated install command because that
command contains the server enrollment token.

After that, complete the product flow in the UI:

1. Confirm the server is shown as connected.
2. Create a project from a GitHub repo with a Compose file.
3. For the bundled example app, copy `examples/compose-web` into a GitHub repo
   that the GitHub App can access.
4. Set Compose file path to `compose.yml`.
5. Set the public route service to `web` and port to `3000`.
6. Set readiness path to `/health`.
7. Leave the pre-deploy command empty.
8. Trigger a deploy.
9. Confirm the deployment reaches `Succeeded`.
10. Visit or curl the configured public route.

You can add a deployed route check to the same command:

```bash
DEVPUSH_BASE_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
DEVPUSH_PROJECT_URL_TIMEOUT=180 \
pnpm validate:remote
```

For the full remote proof, require the deployed route and managed Traefik
checks:

```bash
DEVPUSH_BASE_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
DEVPUSH_FULL_PROOF=1 \
pnpm validate:remote
```

`DEVPUSH_FULL_PROOF=1` forces `DEVPUSH_VALIDATE_TRAEFIK=1` and
`DEVPUSH_REQUIRE_PROJECT_URL=1`. For install-only validation, leave
`DEVPUSH_FULL_PROOF` unset. Traefik reads Docker metadata through the managed
`devpush-docker-socket-proxy` container instead of mounting the Docker socket
directly.

To run every remote proof gate in order, use:

```bash
DEVPUSH_BASE_URL=https://devpush.example.com \
DEVPUSH_REMOTE_HOST=root@203.0.113.10 \
DEVPUSH_INSTALL_COMMAND='tmp="$(mktemp)" && curl -fsSL ...' \
DEVPUSH_PROJECT_URL=https://my-app.example.com \
pnpm validate:remote:proof
```

That command requires `deploy/.env.production` by default, verifies that
`DEVPUSH_BASE_URL` in that env file matches the requested proof origin, then runs remote
config validation, production image validation, and `pnpm validate:remote` with
`DEVPUSH_FULL_PROOF=1`.

### Google OAuth

Required:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Callback:

```text
http://localhost:7429/api/auth/callback/google
```

### GitHub OAuth

Required:

```bash
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

Callback:

```text
http://localhost:7429/api/auth/callback/github
```

### GitHub App installation

Required for repository selection and project creation:

```bash
GITHUB_APP_ID=...
GITHUB_APP_NAME=devpush
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=...
```

For a new checkout, use the interactive setup wizard. It creates `app/.env` and
can configure the GitHub App as part of the same flow:

```bash
pnpm configure
```

To replace only the GitHub App later, run
`pnpm run setup:github-app -- --env app/.env`. The helper opens GitHub for approval,
requests repository **Contents: Read-only**
permission, subscribes to **Push** and **Installation target**, configures OAuth
and webhooks, and exchanges the one-time manifest code locally. GitHub delivers
**Installation** and **Installation repositories** lifecycle events to every
GitHub App automatically; they are not selectable subscriptions. Existing apps
must be updated manually to match these permissions and selectable events.

Setup callback:

```text
http://localhost:7429/api/github/install/callback
```

Webhook URL:

```text
http://localhost:7429/api/github/webhook
```

Replace `http://localhost:7429` with the configured auth origin in production.
Unless explicitly overridden with `BETTER_AUTH_URL`, this is
`DEVPUSH_BASE_URL`.

### Object storage

No storage configuration is required. Avatars use
`app/public/uploads/avatars` locally and the production Compose volume persists
that directory. To use Cloudflare R2 or another S3-compatible service, set all
of these values:

```env
DEVPUSH_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
DEVPUSH_STORAGE_REGION=auto
DEVPUSH_STORAGE_BUCKET=devpush
DEVPUSH_STORAGE_ACCESS_KEY_ID=...
DEVPUSH_STORAGE_SECRET_ACCESS_KEY=...
```

When object storage is configured, avatars are private objects proxied by the
control plane. Agent binaries use the `agents/devpush-agent-linux-*` keys.
Production Compose publishes its packaged binaries automatically; source-based
installs can run `pnpm --dir app storage:sync-agents` after building them.

## Agent

```bash
pnpm agent:test
pnpm agent:build
```

For a Linux target server, provide a Linux binary to the control plane:

```bash
pnpm agent:build:linux
```

Then set this in `app/.env`:

```bash
DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
DEVPUSH_TRAEFIK_EMAIL=ops@example.com
```

The server install command shown in the UI detects Linux `amd64` or `arm64`,
downloads and checksum-verifies the matching binary from the configured control
plane, provisions required host packages on supported apt-, dnf-, and yum-based
systemd distributions, creates the `devpush` system user, writes
`/etc/devpush/agent.env`, installs a systemd service, and starts the agent.
Detailed installation output is stored in timestamped files under
`/var/log/devpush-agent/`; `latest.log` points to the latest run.

New projects default to an exact nip.io host derived from the assigned server,
such as `my-app-167-11-3-44.nip.io`. A local control plane uses
`127-0-0-1.nip.io` until the agent reports an IPv4 address. Generated aliases
are persisted, and private or loopback aliases use HTTP.

For a Lima-backed local server, add a custom domain such as
`my-app.localhost` in the project Domains settings, assign it to the desired
environment, and disable HTTPS. Names under `.localhost` resolve to the local
machine, and Lima forwards Traefik's exposed ports, so the route is available at
`http://my-app.localhost` without DNS or `/etc/hosts` changes.

`DEVPUSH_TRAEFIK_EMAIL` is optional but recommended for HTTPS routes. The
installer writes it to the agent environment so managed Traefik can register
Let's Encrypt certificates.

Run the agent manually for local protocol testing:

```bash
DEVPUSH_BASE_URL=http://localhost:7429 \
DEVPUSH_AGENT_TOKEN=dev-token \
go run ./agent/cmd/devpush-agent -config /tmp/missing-devpush-agent.env
```

Avatar form regression tests cover cancelling and replacing pending file reads,
read failures, retries, and unmounting. Account, team, and project forms show
image-read progress and block Save while reading; Cancel invalidates the read.

Project general/build form tests exercise missing names, invalid paths and
timeouts, server-side name conflicts, pending submit guards, network retry,
and preservation of unsaved edits across sections. These forms share the
server schema and return structured validation errors.

Admin form tests cover rule/import validation, pending dismissal, failed
requests, and confirmation retries. Allowlist service integration tests verify
large imports, duplicate normalization, atomic rollback, and admin permissions.

Account email forms preserve failed requests and show delivery errors in the
form. Account confirmation tests cover disconnect, team departure, and deletion
with exact confirmation, pending Escape prevention, retry, and success closure.

Project creation tests cover required fields, shared path/command/environment
constraints, pending edit/dismissal guards, and navigation failure after creation.
Duplicate environment keys are rejected per environment during creation.

Repository picker DOM tests cover inline retry, selection, and late responses
from closed dialogs. Invitation tests cover pending cancellation and prevent
repeating successful acceptance when navigation fails.

Route/domain settings tests cover required fields, hostname/path/port rules,
normalized duplicates, pending submissions, request retry, and preserving domain
edits when saving routes. Shared schemas enforce the same request constraints
on the client and server.

Environment variable tests cover required/duplicate keys, empty values, scoped
overrides, pending requests, retry, and invalid imports without partial insertion.
The `.env` importer accepts optional `export`, comments, quoted whitespace and
multiline quoted values; malformed assignments report their line number.

Environment definition tests cover required fields, duplicate identifiers,
Production protection, wildcard branch rules, pending submission, and failed
save retry. Production protection follows the saved environment identity.

Server assignment DOM tests cover new environments after context refresh,
unsaved selections, pending controls and retry. Persistence integration verifies
that definition-only environment saves retain stored server assignments.

Deployment-dialog tests cover options retry, late-response cancellation, pending
selection/dismissal, active-deployment confirmation, and navigation warnings after
queueing. Redeploy/rollback and project-deletion tests verify inline failures,
retry, pending dismissal and successful dialog closure without live deployments.

Backup creation/restore tests cover context refresh, name/command limits,
cron ranges and steps, pending dismissal, acknowledgement before closing, and
request failure/retry. Restore requests are awaited by the dialog; callers must
propagate failures so the dialog can retain its input and display the error.

Backup detail DOM tests cover refresh preservation, retention upper/integer
limits, database dump rows, pending controls and failed-save retry. Request
errors focus a form-level message; shared schema errors focus their input.

Backup action tests cover run/pause failure and retry, shared mutation locks,
list/detail deletion confirmation and pending dismissal. Authentication tests
also dispatch repeated form submissions to check handler-level duplicate guards.

Search/filter DOM coverage verifies rapid filter composition, reset, failed
navigation and retry, repository search clearing, and keyword debounce cleanup
on reset/unmount. Project creation also tests retrying repository loading and
canceling its pending dialog before data finishes loading.

Caching regression tests cover team-scoped invalidation, canceled pre-mutation
reads, stale shared-project refresh, runtime-log polling and final deployment-log
snapshots. Router tests verify selective SSR and pending defaults. Worker smoke
checks that authenticated route documents return skeletons without waiting for
session data; this does not replace authenticated browser navigation/load tests.

Team cache tests verify direct metadata updates across navigation snapshots while
preserving unrelated data and timestamps. Deployment polling tests use query
observers with fake timers to verify scoped refresh, hidden-tab pause, and stopping
on completion. Team settings DOM tests ensure a successful general save does not
invalidate the router.

## Workspace WebSockets

Normal `pnpm dev` uses Nitro’s WebSocket support, matching the browser notification
flow used on Cloudflare. One Node process owns its workspace connections.
Authenticated agent mutations and deployment enqueues broadcast change hints;
queries refetch their authorized snapshots. Blocked sockets fall back to polling.
Cloudflare’s local simulator is still needed to test Durable Object hibernation.

The production Node build enables the same upgrade handler. Reverse proxies must
forward WebSocket upgrades for `/api/workspaces/updates`. Do not run multiple
Node instances expecting immediate cross-process broadcasts without adding a
shared pub/sub transport.

Use a separate Docker host for each control-plane test agent. Two agents on one
Docker daemon can reconcile each other's runtimes as orphans, even with separate
state directories. Keep staging enrollment tests isolated from local deployments.
