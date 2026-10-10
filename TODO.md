# TODO

- Validate workspace WebSocket notifications on deployed Cloudflare staging,
  including an idle browser receiving a real GitHub webhook deployment.

## Near-term

- Add a remote-connectivity health check to the local development workflow so
  a running app with an unavailable tunnel is reported before testing agents.

- Validate agent update/drain and empty-host control-plane switch on a live VPS
  after publishing the new agent and source switch endpoint. Design explicit
  ownership migration before supporting switches of servers with deployments.

- Give server business errors explicit public codes/messages, so UI error handling
  can default to hiding all unknown errors instead of recognizing technical messages.

- Address the remaining moderate dependency advisories; the high-severity
  audit gate passes after the tooling updates.

- Verify hosted Turso credentials, TLS connectivity, and recovery procedures on a real configured account; local libSQL adapter and HTTP server checks pass. Verify the deployed Worker with remote libSQL as well.

- Detect and report runtime-log gaps caused by Docker rotation before collection.
  Bounded time-window collection and durable delivery retain captured batches,
  but cannot recover source logs Docker has already removed.

- Run authenticated production Worker load tests, including cold documents,
  client navigation, direct team-save updates and scoped polling, against representative team,
  project, deployment, and log routes; record p50, p95, and p99 latency plus
  query counts under concurrent deployment and log ingestion.
- Add versioned encryption-key rotation with a multi-key read window and an
  audited re-encryption command before changing
  `DEVPUSH_SECRET_ENCRYPTION_KEY` in a deployed installation.
- Add a first-class GitHub Actions setup flow for automatic Cloudflare
  deployments, including secure provisioning of generated Wrangler bindings,
  application secrets and scoped Cloudflare
  credentials.
- Complete clean remote VPS validation by running `pnpm validate:remote:proof`
  with public HTTPS control-plane config, a valid GitHub App private key, server
  install, GitHub-backed Compose deploy, public route smoke, and the generated
  `.tmp/remote-validation-<timestamp>.md` summary artifact.
- Add a single-Dockerfile application runtime with image build, managed
  ingress, health/readiness, logs, and rolling replacement semantics that do
  not require a Compose file.

## Later

- Revisit cloud server provisioning after the first release, starting with Hetzner.
  A standalone test helper is available through `pnpm setup:hetzner`; the product
  UI and workspace credential storage remain deferred.
  Store provider credentials at workspace scope and restrict paid creation to
  owners. Keep server naming on the first setup screen; on the second, offer
  manual installation (default) or Hetzner creation with all provider fields
  together. Fetch current regions, server types, compatible images, availability,
  and prices from the provider API; revalidate before creation and handle capacity
  failures. Run the install command through startup provisioning, retain it for
  manual recovery, and allow provisioning progress to continue after dismissal.

- Explore server creation within project creation, including manual enrollment
  and cloud provisioning with workspace provider credentials. Decide the UI
  interaction before implementation; preserve project inputs when switching flows.

- Design deploy-button and reusable project-template configuration, including
  how templates are created, shared, imported, and passed through deployment
  URLs. Do not introduce repository-owned project settings as part of this work.
- Backups deployment validation: verify automatic Cloudflare cron invocation on
  staging. Local cron enqueueing/deduplication, PostgreSQL local/R2 recovery,
  count retention, failed uploads/restores and restore feedback passed live
  tests on the Hetzner test server. Age/size retention and member restrictions
  have integration coverage.
- Backups: add multi-artifact restore selection, restore-to-new-environment, and
  dedicated restore history.
- Backups: consider download of stored files (signed S3 links or authenticated
  streaming from the agent). Do not add manual backup-file deletion.
- Backups: add an optional quiesced-volume backup mode; live tar archives are not guaranteed to be
  consistent or recoverable.
- Backups: add a connection test from the deployment server for saved workspace
  storage; verify upload/read access and clean up only the test object. Connection
  syntax validation does not prove a bucket is reachable or writable.
- Backups: add an optional Cloudflare OAuth setup flow for R2 that can create or
  select a bucket and provision scoped S3-compatible credentials.
- Runtime logs: add external drain/export support for long-term retention beyond
  the 24-hour runtime-log UI window.
- Compose graph visualization.
- Raw Compose template editor.
- Evaluate a Docker Swarm runtime driver after the single-Dockerfile runtime,
  including manager/worker topology, registry-backed images, stack
  compatibility preflight, rolling updates, and rollback behavior.
- Hosted wildcard domain management.
- Add managed fallback pages for first deployments that are still starting and
  removed immutable deployment aliases, including an authenticated redeploy
  action for historical deployments.
- Notification rules.
- Billing.

- Extend engine-specific backup/restore support to SQLite, ClickHouse and libSQL.
- Validate full-cluster database recovery across existing roles, credentials and engine versions.
