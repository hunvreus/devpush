# TODO

## Near-term

- Align route loading states with their final page layouts: update the stale
  project overview skeleton and add route-level pending states for deployment
  details, logs, server details, and settings so navigation never flashes blank
  content.
- Restore the deployment URL contract with revision-specific routed runtimes:
  immutable deployment URLs, moving branch URLs, and moving environment URLs
  (with the production project hostname as the environment special case).
- Complete clean remote VPS validation by running `pnpm validate:remote:proof`
  with public HTTPS control-plane config, a valid GitHub App private key, server
  install, GitHub-backed Compose deploy, public route smoke, and the generated
  `.tmp/remote-mvp-validation-<timestamp>.md` summary artifact.
- Add GitHub App provisioning to the deploy/install workflow: keep a manifest in
  the repository with the required callback URLs, permissions, and webhook
  events, and document updating existing apps separately.
- Make GitHub installation metadata resilient: persist the target account's
  stable GitHub ID, refresh display metadata on lifecycle/rename webhooks, and
  recover stale installation references on use without caching installation
  access tokens.

## Later

- Backups: add multi-artifact restore selection, restore-to-new-environment, and
  dedicated restore history.
- Backups: add an optional Cloudflare OAuth setup flow for R2 that can create or
  select a bucket and provision scoped S3-compatible credentials.
- Runtime logs: add external drain/export support for long-term retention beyond
  the 24-hour Postgres UI window.
- Compose graph visualization.
- Raw Compose template editor.
- Hosted wildcard domain management.
- Notification rules.
- Billing.
