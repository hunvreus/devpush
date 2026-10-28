---
description: Understand code boundaries, extension hooks and contributor invariants.
---

# Contributing

Start with [Local development](/docs/local-setup/) for setup and checks. Follow the repository's [agent rules](https://github.com/hunvreus/devpush/blob/development/AGENTS.md) when changing code.

## Code boundaries

- `app/src/routes`: route loaders, validation and guards; render feature components.
- `app/src/features`: product UI and state by domain.
- `app/src/components/ui`: generic shadcn primitives.
- `app/src/lib`: runtime-independent schemas and client helpers.
- `app/src/server`: authorization, persistence and integrations.
- `agent/`: Go agent, Docker Compose, Traefik and host recovery.

The dashboard never runs Docker. Agents connect outbound, claim jobs and report results. Node and Workers share domain services; platform adapters isolate filesystem, database and runtime APIs.

## Persistence and authorization

Main state and logs use separate databases with independent migrations. There are no cross-store transactions. Use guarded SQL and atomic batches: permission, resource-state and settings-version checks must remain valid at the final write. D1 cannot run application callback transactions. Do not hold transactions open across provider calls.

Browser actions, REST, MCP, webhooks and scheduled work reuse domain services. Authentication, team membership, ownership and API scopes remain authoritative regardless of UI visibility. Installation administration is separate from team roles.

Secrets use the installation's stable encryption keys. External projections omit credential material and variable values; logs need separate permission. Never put credentials in clone URLs, process arguments or persisted job history.

## Deployments and agent durability

Queue admission records the commit, settings and encrypted variable snapshot. Claims supply current provider credentials. Each environment has one stable Compose runtime. Redeploy/rollback reuse recorded settings with current routing, not data snapshots.

Protocol compatibility uses `protocolVersion` and capabilities, not the release string. Update request schemas and Go types together; flag any required coordinated upgrade. Agent credentials are separate from user API keys. The canonical wire definitions live in the [control-plane protocol](https://github.com/hunvreus/devpush/blob/development/app/src/server/agents/protocol.ts) and [Go protocol types](https://github.com/hunvreus/devpush/blob/development/agent/internal/agent/protocol.go), rather than a second field catalog in docs.

Completion/log outboxes survive restarts. Pending completion delivery and interrupted volume-restore recovery run before new claims. Never discard an outbox, journal or recovery archive to unblock work. A failed or interrupted job may already have changed external state; it must not be silently replayed.

## Extensions

Consumers register trusted local/npm plugins through `devpush({ plugins })`. Declarations use `devpush/plugins`, server contracts `devpush/plugins/server`, and UI contracts `devpush/plugins/client`. Server entries must stay outside browser bundles. Plugins are application dependencies, not a sandbox.

Core supplies generic hooks, permission gates and UI slots. Extension-specific product rules, wording, persistence and recipient policies belong in the consumer. Plugin HTTP handlers must authenticate sessions or verify webhook signatures themselves; cookie mutations must validate Origin.

`workspaceAccess.run(input, action)` wraps an already authorized effect. Policies may restrict core access, never grant it. Invoke the action once and return its result. Queue admission and productive claims both check policy; completion, observations and cleanup remain independent. Keep coordination in durable storage, not provider-instance state.

The optional `runtimeLogLimits(teamId)` service supplies team-wide runtime-log budgets. Core authenticates uploads and enforces these limits without knowing extension-specific product rules.

Factories/providers must be bounded, retryable and cheap to initialize. Preserve generic fallbacks only when no provider is configured; provider failure must not silently change behavior. Pin compatible app/plugin versions and build them together. See the [server contracts](https://github.com/hunvreus/devpush/blob/development/app/src/plugins/server.ts) and [UI contracts](https://github.com/hunvreus/devpush/blob/development/app/src/plugins/client.ts) for supported hooks.

## Migrations and docs

Generate migrations for changed schemas, commit SQL and Drizzle metadata, and run integration tests. Never edit applied migrations or use schema push in production.

See [Background work](/docs/production-operations/#background-work) for scheduling on both targets.

Edit pages in `docs/`, update `docs/docs.json` and run `pnpm docs:check`. Temporary review notes belong in `.tmp/`, not documentation.

Keep files flat and organize the sidebar through `docs/docs.json`. Page filenames determine public URLs; renaming a file requires a website redirect. Documentation-only edits need no app release.

## Branches

Use `main` for integration and short-lived branches for changes. Publish releases from version tags; no permanent release branch is required. A maintenance branch is only needed when supporting an older release alongside newer development. See [Agent releases](/docs/agent-releases/) for the build and publication process.
