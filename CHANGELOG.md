# Changelog

## [Unreleased]

## [1.0.3] - 2026-10-30

### Changed

- Return idle agent job checks immediately; agents poll every ten seconds with jitter and back off after errors. Upgrade agents with the dashboard to avoid increased polling from older agents.
- Add a database migration for indexed backup scheduling; existing applied migrations are unchanged.
- Schedule backups through an indexed, bounded due-policy scan. Existing policies initialize on their next scheduler pass; overdue policies run once rather than replaying missed intervals.
- Remove redundant runtime-log expiry cleanup during ingestion; hourly maintenance handles expiry.
- Repair project notification observations every five minutes while retaining immediate delivery and minute retries.

## [1.0.2] - 2026-10-30

### Changed

- Reduced agent polling and unchanged runtime reconciliation work, avoided unnecessary heartbeat metadata writes, and deferred scheduler imports until needed. Server alert checks now use the minute scheduler.
- Simplified package installation examples and removed outdated pre-release setup guidance.

### Fixed

- Added a static favicon for browsers requesting `/favicon.ico` and fixed static asset delivery when installed from npm on Node.

## [1.0.0] - 2026-10-29

A complete rewrite of devpush. This release replaces the previous architecture and requires a fresh installation.

### Added

- Docker Compose deployments from GitHub, with environments, preview URLs, custom domains and HTTPS.
- Backups and restores, logs, server monitoring and notifications.
- Teams, scoped API keys and MCP access.
- Self-hosting on Node.js or Cloudflare Workers.
