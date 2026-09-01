# TODO

## Near-term

- Add a first-class GitHub Actions setup flow for automatic Cloudflare
  deployments, including secure provisioning of generated Wrangler bindings,
  application secrets, the migration database URL, and scoped Cloudflare
  credentials.
- Complete clean remote VPS validation by running `pnpm validate:remote:proof`
  with public HTTPS control-plane config, a valid GitHub App private key, server
  install, GitHub-backed Compose deploy, public route smoke, and the generated
  `.tmp/remote-validation-<timestamp>.md` summary artifact.
- Add a single-Dockerfile application runtime with image build, managed
  ingress, health/readiness, logs, and rolling replacement semantics that do
  not require a Compose file.

## Later

- Design deploy-button and reusable project-template configuration, including
  how templates are created, shared, imported, and passed through deployment
  URLs. Do not introduce repository-owned project settings as part of this work.
- Backups: add multi-artifact restore selection, restore-to-new-environment, and
  dedicated restore history.
- Backups: add an optional Cloudflare OAuth setup flow for R2 that can create or
  select a bucket and provision scoped S3-compatible credentials.
- Runtime logs: add external drain/export support for long-term retention beyond
  the 24-hour Postgres UI window.
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
