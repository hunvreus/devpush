# Changelog

User-facing changes to devpush. Release dates are added when versions are published.

## [Unreleased]

## [1.0.0-beta.1] - 2026-10-27

### Changed

- Complete rewrite of the pre-1.0 application: a TypeScript dashboard on Node or Cloudflare Workers, with a Go agent on each deployment server.
- Docker Compose replaces the previous presets/runners deployment model. Updates happen in place; the previous zero-downtime swap model is not retained.
- Documentation shortened, with an overview explaining why devpush exists and visual groups for Getting started, Basics, Administration & Operations, Reference and Development.
- **Breaking:** This rewrite requires a fresh installation. The previous single-host installer and 0.x databases are not compatible; there is no automatic data conversion. Retired pre-release database histories are also unsupported. Preserve needed data before replacing an installation. New schema changes use forward migrations; updating code never resets a database.

### Added

- Multi-server projects, branch environments and encrypted variables.
- GitHub push deployments, deployment history, redeploy and rollback.
- Custom domains with automatic HTTPS, live logs and server monitoring.
- Scheduled database/volume backups and restore.
- Team roles, email, Google and GitHub sign-in, scoped API keys and remote MCP.
- Notification preferences with personal team/project mutes.
- Plugin hooks and UI slots for package consumers.

For the previous implementation and release history, see the [0.4.6 source](https://github.com/hunvreus/devpush/tree/0.4.6) and [GitHub tags](https://github.com/hunvreus/devpush/tags).
