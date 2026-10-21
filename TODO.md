# TODO

Outstanding work only. Completed changes belong in CHANGELOG.md; supported
behavior and contracts belong in the documentation.

## Before release

1. Complete the Cloudflare production migration in the separate devpush account,
   using the existing GitHub/Google apps and app.devpu.sh. Production credentials
   are verified in Development / `devpush (production)`, tagged `devpush` and
   `production`; retain the legacy `.env.prod` copy until cutover is verified.
   Activate Workers/R2 and prepare the domain transfer while preserving existing
   services. Do not assume a staging deployment exists.
2. Complete remote release verification:
   - Run `pnpm validate:remote:proof` against a clean VPS and public HTTPS control
     plane: enrollment, GitHub-backed Compose deployment and public routing.
     Retain its `.tmp/remote-validation-<timestamp>.md` report.
   - Verify agent upgrade/drain, managed ingress replacement and empty-host
     control-plane switching. Rebuild legacy images containing checkout tokens;
     verify checkout pruning with retained bind mounts and signed pushes after
     repository renames and during server outages.
   - Verify deployed Cloudflare workspace notifications with an idle browser and
     a real GitHub push, automatic backup cron, backup/restore log uploads and
     interrupted R2 transfers.
   - Verify real Claude OAuth and a second third-party MCP client on Node and
     Workers. SDK tests alone do not establish client compatibility.
   - Verify hosted Turso credentials, TLS and recovery, including Worker access
     to remote libSQL. Exercise hosted D1/libSQL concurrency and recovery.
   - Run authenticated Worker load tests under concurrent deployments and log
     ingestion; record p50/p95/p99 latency and query counts for document loads,
     navigation, settings saves and scoped polling.
3. Confirm the supported API operation matrix and version/deprecation policy.
   Publish the rebuilt marketing site in `hunvreus/devpush-website`, which imports
   this repository's docs and Taupe theme using ReallySimpleDocs. Update the
   existing host to use `pnpm build` and `dist/`; verify production examples,
   links, search, Markdown exports, LLM files and legacy redirects before cutover.
   Complete and fact-check the Coolify, Dokploy, Vercel and Render comparison
   placeholders, and replace the legacy demo recording.

## Reliability and operations

- Handle server IP changes for existing generated routes. Preserve historical
  deployment URLs and publish replacement aliases only after routing is applied.
- Provide operator inspection/export/recovery for corrupt or permanently rejected
  completion-outbox entries and runtime-log captures with missing ownership.
  Keep completion delivery blocking new claims until acknowledged or explicitly
  resolved; do not discard evidence solely on a 404. Preserve captures until
  recovered or explicitly discarded.
- Detect runtime-log gaps caused by Docker rotation before collection. Durable
  delivery protects captured batches, not source logs already removed by Docker.
- Reproduce intermittent local Nitro `POST /api/agents/jobs/next` transport resets
  before changing behavior. Monitor Worker/D1 smoke reliability: asynchronous
  fixture seeding passes, but the earlier synchronous-seeding reset is unexplained.
- Add agent-to-control-plane connectivity preflight to optional remote-agent tests.
  The local Lima workflow needs no public tunnel.
- Add versioned encryption-key rotation, multi-key reads and an audited rewrite
  command before rotating `DEVPUSH_SECRET_ENCRYPTION_KEY` in a deployed installation.
- Add a GitHub Actions setup flow for automatic Cloudflare deployments with secure
  provisioning of bindings, application secrets and scoped Cloudflare credentials.
- Inventory and retire obsolete remote Cloudflare test Workers, storage, tunnels,
  DNS records and third-party apps after checking live consumers. Removing local
  configuration did not remove remote resources.
- Design explicit ownership migration before supporting control-plane switches
  for servers that already have deployments.

## API and MCP expansion

- Complete REST project/server coverage: custom-domain writes and verification,
  repository settings, project avatars and server enrollment with explicit
  lost-response recovery. Preserve final atomic authorization and admitted IDs;
  enrollment rotation is not automatically safe to retry.
- Define separate personal/admin grants before exposing team membership,
  invitations, ownership transfers, account/profile verification, administration,
  credential management and team/account avatars. These remain browser-only;
  security, admin, enrollment and ownership actions are not MCP tools.
- Add Worker client-ID metadata discovery only when a maintained transport can
  pin validated DNS. Do not fall back to an unsafe metadata fetch.
- Consider service accounts separately. Add a stdio package only if a required
  client cannot use remote HTTP.

## Product backlog

### Runtimes and routing

- Add Dockerfile-only projects by generating a single-service Compose runtime,
  keeping build context, Dockerfile path, arguments, port, command and named-volume
  settings explicit. Reuse deployment snapshots, readiness, logs, cleanup and
  rollback; validate backup/restore ownership. Do not infer a complete application
  topology from a Dockerfile or promise universal compatibility.
- Defer Docker Swarm until after the initial release; evaluate afterward: cluster ownership, manager failover, immutable
  registry images, compatibility checks, updates/rollback, ingress, task logs and
  persistent data/backups. Compose commands alone are insufficient.
- Publish and pin deployment API v4 and the shared `ingress.certificates.v1`
  agent capability in the private hosted release. Private Cloudflare DNS and
  configurable ACME/ZeroSSL services, SQL state, polling, renewal and installation
  acknowledgements are implemented. Verify the product implementation in an
  isolated live rollout before production; Node/workerd tests use fake providers,
  and the VM verifies real Traefik HTTPS/reload. Hosted readiness UI and production
  setup are tracked in the private repository.
- Add managed fallback pages for starting deployments and removed historical
  aliases, with authenticated historical redeployment.
- Add Compose graph visualization and a raw Compose template editor.
- Add external runtime-log drains/export beyond the 24-hour UI window.

### Backups

- Add multi-artifact restore selection and restore to a new environment.
- Consider downloads through signed storage URLs or authenticated agent streaming;
  do not add manual backup-file deletion.
- Add optional quiesced-volume backups; live tar archives are not atomic snapshots.
- Test saved storage from the deployment server through upload/read/delete of a
  dedicated test object. Syntax validation does not prove connectivity.
- Consider Cloudflare OAuth for R2 bucket selection/creation and scoped credentials.
- Extend engine support to SQLite, ClickHouse and libSQL; validate full-cluster
  recovery across existing roles, credentials and engine versions.

### Onboarding and platform

- Validate deployment on a physical Raspberry Pi with 64-bit Linux and Docker
  Compose: ARM64 installer/images, builds, logs, metrics, routing and backup/restore.
  Document outbound agent management separately from LAN/VPN/public application
  access, private address configuration and resource requirements. Do not advertise
  verified Pi support before completing this check.

- Add product cloud provisioning after release, starting with Hetzner. The
  `pnpm setup:hetzner` test helper already exists. Store credentials at workspace
  scope, restrict paid creation to owners, derive choices/prices/availability from
  provider APIs and preserve manual installation/recovery and background progress.
- Explore server creation within project creation; preserve project drafts when
  switching flows and settle the interaction before implementation.
- Design reusable project templates and deploy buttons, including sharing/import
  and deployment URLs, without introducing repository-owned project settings.
- Add notification rules.
- Hosted release: publish/pin deployment API v4, configure and validate Stripe test-mode checkout/portal/webhooks, and confirm log allowances and trial-abuse controls before opening paid signup. Detailed commercial backlog lives in the private hosted repository.
