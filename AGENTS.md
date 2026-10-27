# Agent rules

## Structure

- `app/` is the TanStack Start TypeScript app (use `web/` if renamed); `agent/` is the separate Go host agent. Paths below are relative to `app/`.
- `src/routes`: route contract only (loaders, search validation, guards, pending/error states). Render a feature component; no large UI, state machines or business logic.
- `src/features/<domain>`: product code by domain.
- `src/components/ui`: generic primitives without product logic or product state; add via `pnpm dlx shadcn@latest add ...` where possible. Other `src/components` files need proven reuse across features or shared layout routes; otherwise keep them in the feature.
- `src/server`: validation, permissions, database behavior. Keep API handlers thin.
- `src/lib`: client API helpers and runtime-independent utilities/schemas; no server-only code. Data models live in Drizzle schemas/migrations.
- Shared server code stays runtime-neutral for Cloudflare and Node; isolate platform APIs in target-specific modules.
- Name by route/domain (`ProjectLayout`, `DeploymentList`), not structure (`shell`, `frame`, `surface`, `panel`, `container`). No catch-all dirs (`common`, `shared`, `core`).

## UI

- Compose vanilla shadcn primitives with Tailwind; no design-system wrappers until duplication is real. Adapt shadcn blocks to this structure; don't paste them.
- Compact dark UI, top team/project navigation, tabbed project areas, row-based lists (not data tables) for deployments/history.
- Loading: keep known labels, icons and disabled controls visible; skeletons match the loaded layout and replace only unknown values. Reuse cached data; show known empty states immediately.

## Changes

- No backward compatibility unless asked; prune dead code after removals.
- Flag breaking API/agent-protocol changes, required data migrations and coordinated agent/control-plane upgrades. Never rewrite applied migrations.
- Ask before removing intentional behavior unless already authorized.
- Derive provider options and binding/config controls from schemas, definitions or APIs; don't duplicate hardcoded values.

## Verification

- Add focused tests for behavior changes; run the narrowest useful checks first.
- From the repo root:
  - Documentation changes: `pnpm docs:check`.
  - Cross-cutting app changes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
  - Go agent changes: `pnpm agent:test`.
  - Schema, migration, query or persistence changes: `pnpm test:integration`.
  - App + agent changes: both sets.

## Docs

- Update `CHANGELOG.md` (Keep a Changelog) for user-visible changes, docs when documented behavior/config/API/architecture changes, and `TODO.md` when backlog items are added or completed. Sentence-case headings.
- `README.md`: short introduction and setup links. `docs/development/development.md`: contributor boundaries and invariants. `TODO.md`: the only backlog.
- `docs/index.md` is the entrypoint. Group documentation in matching folders under `docs/`; keep navigation in `docs/docs.json` and page filenames unique so published URLs stay stable. Plain Markdown keeps content portable to ReallySimpleDocs. No private route catalogs.
- No placeholder docs or unvalidated OpenAPI specs. Transient notes go in `.tmp/`.
- Keep docs task-first and concise: requirements, steps, result. Give each fact one home and link to it; omit implementation history and private maintainer details. Keep safety guidance beside the relevant action. References may be longer than guides.
