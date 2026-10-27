---
description: Secure the control plane, agents, credentials and operational data.
---

# Security and trust boundaries

## Hosts and access

Use a currently patched Node.js release; the package's minimum version is an API
compatibility floor, not a recommendation to run an old security patch. Production
images pin their Node and Go base images by digest. Rebuild and update the agent
when its Go toolchain receives security fixes.

Expose the dashboard through HTTPS and keep its direct listener private. Enable
proxy trust only behind a proxy that overwrites forwarded headers and blocks
untrusted direct access. Workers use Cloudflare's connecting address instead.

The control plane checks active accounts, current workspace membership, roles,
resource scope and live credentials. API key/OAuth grants cannot increase their
creator's authority; revocation and membership changes are rechecked at mutation
admission. Workspace policy extensions can impose additional restrictions without
replacing these checks.

## Deployment trust

Treat deployment servers and project configuration as privileged infrastructure.
Compose files, host lifecycle commands, release commands and backup/restore
commands execute on agent-managed machines. Docker group access is effectively
root access. This is not an isolation boundary for hostile tenants or arbitrary
unreviewed repositories. Separate trust domains onto separate hosts.

Agents use distinct enrollment/operational credentials and verify the control-plane
TLS connection. Private certificate keys stay on the agent. Installer downloads
verify the pinned release checksum. A checksum pin protects integrity relative to
that published manifest; it is not an independent release signature.

## Secrets and notifications

Keep authentication and encryption secrets separate and stable. Application
secrets use authenticated encryption. Store configuration in protected environment
files, Worker secrets or a secret manager, never public source control. A deleted
file or rewritten commit does not revoke a leaked credential: rotate any real
credential committed in history and invalidate its affected sessions/grants.

Notifications recheck current eligibility and mailbox ownership before sending.
Persistent retry snapshots retain the exact provider payload. Access recovery and
transactional security messages must not be implemented as user-mutable
operational preferences.

Provider/API/agent failure diagnostics omit raw request bodies, SQL parameters
and exception messages that might contain credentials. Application output can
still contain anything a deployed application prints; restrict log access and do
not deliberately print secrets. Runtime logs expire after 24 hours. Deployment
logs have configurable row/line bounds; retention alone does not cap ingestion.
Agent subprocess output is bounded. Failed or canceled commands clean up their
process groups; hooks should run finite work rather than start background daemons.

## Verification

Run `pnpm audit:dependencies`, `pnpm test:integration`, `pnpm agent:test` and
`go vet ./agent/...`. From `agent/`, run
`go run golang.org/x/vuln/cmd/govulncheck@latest ./...`. CI also runs secret scanning
and CodeQL. Audit both dependency graphs when composing private extensions:
consumer repositories do not inherit pnpm overrides automatically.

These checks cover known advisories and regression tests; they do not replace
release-candidate verification against actual identity, payment, DNS and server
providers. See [Testing](/docs/testing/) and
[Production operations](/docs/production-operations/).

## Publication checks

Run `pnpm release:check` before staging a release. It checks tracked and new files
for credential paths, local state, uploaded images and generated artifacts. CI
and the tag workflow run the same guard. The package-consumer proof inspects the
actual npm archive and rejects credentials, user uploads and test/development
files. `.gitignore` does not protect files already tracked or copied under an
innocent filename; use secret scanning and review the complete staged diff too.
