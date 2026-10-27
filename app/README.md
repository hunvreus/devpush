# devpush control plane

TanStack Start application for the devpush control plane.

This app owns product workflows, durable state, auth, team/project/server
management, deployment history, and the UI. It does not run Docker directly.
Docker, Compose, Traefik, and runtime logs are owned by server agents.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
```

## Structure

- `src/components`: reusable UI components.
- `src/routes`: TanStack Router routes.
- `src/features`: product UI and state grouped by domain.
- `src/lib`: runtime-independent helpers and schemas.
- `src/plugins`: static server and UI plugin contracts.
- `src/package`: consumer build preset and package helpers.
- `src/server/plugins`: plugin context and service dispatch.
- `src/server/install`: installer generation and verified agent delivery.
- `src/server`: server-only config, persistence, queues, and services.
- `src/server/db`: Drizzle schemas and migrations.

## Package verification

`pnpm test:package` packs the app, installs it in a temporary consumer and checks
Node and local Workers in development and production. Use `--node-only` while debugging Node packaging.
The preset is exported as `devpush/vite`; Node migrations as `devpush/migrate`.
Consumers register static local or npm plugins through the preset. Server and
UI contracts are exported as `devpush/plugins/server` and `devpush/plugins/client`;
shadcn primitives as `devpush/ui/*`. Plugin declarations use `devpush/plugins`;
SQLite migration support, environment encoding, styles and the development watch
guard are exported as `devpush/sqlite`, `devpush/env`, `devpush/styles.css` and
`devpush/dev/watch-guard`. Private logic stays in the consumer.

Run `pnpm build:package` before installing a `file:` dependency. Packing runs it
automatically through `prepack`.
