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
- `src/lib`: browser-safe helpers.
- `src/server`: server-only config, persistence, queues, and services.
- `src/server/db`: Drizzle schemas and migrations.
