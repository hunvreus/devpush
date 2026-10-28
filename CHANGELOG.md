# Changelog

User-facing changes to devpush. Release dates are added when versions are published.

## [Unreleased]

## [1.0.0-beta.5] - 2026-10-28

### Fixed

- Keep the sign-out label stable and navigate home directly to the known default team. Reuse cached user context for home redirects.

- Remove unsupported new-tab attributes from both README demo links.

## [1.0.0-beta.4] - 2026-10-28

### Changed

- Use the dark homepage screenshot and play overlay for both README demo links.

- Add the demo and setup guidance to the repository and npm READMEs; document npm installation and automated publishing.

## [1.0.0-beta.3] - 2026-10-28

### Changed

- Remove redundant installation metadata and update checks from Admin; use About devpush for version information.

- Remove the configurable sign-in notice.

### Added

- Optional inactive-deployment redirects to the dashboard, with membership checks and confirmed redeployment. Requires an updated agent and dashboard; no database migration.

### Fixed

- Remove the icon from the deployment console’s empty state.
- Match the deployment Visit button group while loading or disabled.
- Label deployment log limit notices as devpush messages.
- Show deployment failure reasons without adding hub events to the agent console.
- Expire queued deployments after 24 hours by default; the limit is configurable.
- Remove the control stream from the deployment logs API; it now returns agent output only.
- Keep actionable error notifications visible until dismissed and show deployment errors consistently.
- Show loaded pages as soon as they are ready and avoid fetching deployment aliases for project navigation.
- Reuse the onboarding check across navigation and link prefetches.
- Reduce database reads for deployment lists, details and project views.
- Avoid an extra database read when loading the last page of deployment logs.
- Add database indexes for agent authentication, deployments and runtime log retention; existing installations must apply the new migrations.
- Cache fingerprinted assets on Cloudflare for faster repeat visits.
- Avoid caching missing assets in Node deployments.
- Load infrequently used settings and backup screens on demand.
- Avoid loading the service picker on the initial app load.
- Keep the selected navigation tab in sync with the page during transitions.
- Keep the current onboarding step visible until the next step is ready.
- Keep the correct page layout visible while navigating between teams, projects and deployments.
- Refresh deployment lists immediately after GitHub pushes.
- Show all project environments and their links on the overview.
- Show project and deployment loading states promptly and restore deployment alias links.
- Disable Visit for replaced deployment revisions.
- Separate deployment Visit and action-menu buttons.
- Clarify notification settings and keep the mute switch disabled while saving.
- Describe domain alerts accurately in email preferences.
- Keep profile pictures circular and retain remove/undo controls when image uploads are unavailable.

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
