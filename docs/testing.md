---
description: Run focused checks, deployment tests and release validation.
---

# Testing

Run commands from the repository root. Start with the check relevant to your
change, then run the broader gates below. Tests use temporary databases and
fixtures; do not point them at an installation's live data.

## Routine checks

| Command | Coverage |
| --- | --- |
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | App lint rules |
| `pnpm test` | App unit/DOM tests and setup/VM/script tests |
| `pnpm test:integration` | Services and persistence against isolated SQLite/D1 fixtures |
| `pnpm --dir app test:integration:libsql` | Shared service suite through the libSQL adapter |
| `pnpm agent:test` | Go agent tests; real Docker tests are opt-in |
| `pnpm build` | Production Node build |
| `DEVPUSH_WRANGLER_CONFIG=wrangler.template.jsonc pnpm --dir app build:cloudflare` | Worker build against the non-deployable template |
| `pnpm audit:dependencies` | Dependency vulnerability audit |

For app-wide changes, run typecheck, lint, app tests and the production build.
For persistence changes, also run integration tests. For protocol changes, run
both app and agent checks and identify coordinated upgrade requirements.
The CI and security workflows define the automated gates; a configured workflow
is not evidence that a particular revision passed.

## Schema changes

```sh
pnpm --dir app db:generate
pnpm --dir app db:generate:logs
pnpm --dir app db:migrate
pnpm test:integration
```

Generate only the migration sets you changed. Commit SQL and matching Drizzle
metadata. Never rewrite an applied migration. `db:push` is available for
disposable local experiments, not production or production-compatible verification.
Main and log stores have independent migration histories. See
[Production operations](/docs/production-operations/#release-database-baseline).

## Local VM tests

```sh
pnpm vm:test
```

Requires macOS, Lima and Go. This creates/starts the owned `devpush-test` VM,
compiles the agent tests for Linux and runs real Compose deployment and Traefik
routing tests directly against its Docker daemon. Both tests must pass without
skipping. Test containers, networks and temporary files are cleaned up; cached
images and the VM remain for reuse.

The tests refuse an enrolled VM or existing devpush ingress. The helper uses the same fixed `devpush-test` name as manual VM setup, so those
flows cannot share it at the same time. To switch, preserve any needed data first;
`pnpm vm:destroy` deletes the VM and all its data, then `pnpm vm:test` creates a
fresh one. This reset does not remove the old server record from devpush. Other Lima and Colima
instances are not used.

If you already have an isolated Docker host, `pnpm smoke:agent` runs the same
opt-in agent smoke against that host. Do not run it on a Docker daemon serving
other devpush agents. Compose interpolation tests can use a standalone binary
through `DEVPUSH_COMPOSE_TEST_BINARY` without a running daemon.

## Control-plane smoke tests

- `pnpm build && pnpm smoke:node` exercises the freshly built production Node server with isolated
  stores and a fixture GitHub provider.
- `pnpm --dir app smoke:worker` builds and exercises the Worker locally with
  temporary D1/R2 bindings. Migrations and fixture setup complete before requests.
- `pnpm smoke:deploy` checks the queue/agent deployment lifecycle using the current
  database configuration. It creates fixture users, teams and deployments there.
  Supply an isolated configuration; the command does not select a safe test store
  for you. Never use a live installation's databases.
- `pnpm validate:production` validates production Compose, builds the image and
  checks bundled runtime/migration/agent artifacts, migrations, signed agent
  uploads, database snapshots and an isolated Compose stack with the sign-in
  notice. Requires Docker; its temporary containers and volumes are removed.
  `DEVPUSH_RUN_DOCKER_TESTS=1 node --test scripts/production-compose.test.mjs`
  also checks that local secrets and state are excluded from the build context.

`pnpm validate:local` combines typecheck, lint, app and integration tests, isolated
deployment smoke, agent tests, configuration checks and Docker routing smoke.
Set `DEVPUSH_SKIP_DOCKER_SMOKE=1` only when deliberately omitting that last check.
A local simulator does not prove real provider credentials, public DNS or a live
GitHub webhook.

## Remote deployment proof

Use a dedicated host and a publicly reachable control plane. Generate an install
command in devpush, enroll the host, create a Compose-backed project and verify
a successful deployment. The sample in `examples/compose-web` uses service `web`,
port `3000` and readiness path `/health`.

The remote scripts can install agents and mutate the named test host. Inspect
`pnpm validate:remote -- --help` before running them. Supply the installation
origin, SSH host, generated install command and deployed project URL through
`DEVPUSH_BASE_URL`, `DEVPUSH_REMOTE_HOST`, `DEVPUSH_INSTALL_COMMAND` and
`DEVPUSH_PROJECT_URL`. Treat the install command as a credential.

`pnpm validate:remote` verifies installation, recent agent contact, Docker and,
when requested, managed ingress and the deployed route. `DEVPUSH_FULL_PROOF=1`
requires both ingress and a project URL. It writes a timestamped summary under
`.tmp/` without the enrollment command.

`pnpm validate:remote:proof` first validates the production environment file and
image, then runs the full remote proof. Its environment file defaults to
`deploy/.env.production`; override with `DEVPUSH_PROOF_ENV`. The origin in that
file must match the requested proof origin. Use HTTPS; the insecure override is
only for isolated local/private tests.

## Optional Hetzner host

`pnpm setup:hetzner -- --list` lists live provider choices using
`HETZNER_API_TOKEN`. The helper previews a requested server and its current price;
only `--create` makes a billable resource. Pass a generated install-command file
with owner-only permissions through `--install-file`.

The helper records ownership in `.data/hetzner-test.json`; use its `--destroy`
flow to remove tracked resources and associated IPs. Keep the state until the
provider confirms deletion. Unknown creation outcomes require inspection before
retrying. There is no assumed shared Hetzner server or permanent local tunnel.

## Documentation

Run `pnpm docs:check` after changing pages or navigation. It validates flat-page
menu coverage and local links, including heading anchors. Keep setup instructions
short; detailed configuration belongs in the reference.

## Unused-code review

Run `pnpm dlx knip@6.41.0 --config knip.jsonc` for TypeScript dependencies, files and exports.
`knip.jsonc` includes the Worker entry, runtime-selected Cloudflare adapters,
the log migration config and the SQLite backup script. Go's equivalent is:

```sh
go run golang.org/x/tools/cmd/deadcode@v0.52.0 -test ./agent/...
```

Check findings against dynamic entrypoints, scripts, templates and assets before
removing anything. Keep `robots.txt`, runtime uploads, local databases and
installation credentials. Put temporary review reports under `.tmp/`, not docs.


## Private application composition

Core's versioned server contract is in `app/src/deployment/contract.ts` and
`app/deployment-api.json`. The default entry has no overrides. A private build
selects its entry using `DEVPUSH_DEPLOYMENT_SERVER` at build time; this is not a
runtime setting. See [Architecture](https://github.com/hunvreus/devpush/blob/main/ARCHITECTURE.md#build-time-application-composition)
for the service boundaries and credential rules.

Tests cover unchanged OSS hostname generation, invalid private output, agent
certificate authorization and response limits, routing-state reads without
credentials, and reconciliation before deletion pruning. Private repositories
must additionally typecheck their entry against the pinned contract and build
both Node and Workers targets before publishing a hosted release.


`pnpm vm:test` also checks managed HTTPS through real Traefik and verifies that an
atomic certificate replacement is served without restarting the proxy. It uses
an isolated test certificate, not live DNS/CA credentials. The shared agent unit
tests cover key persistence, certificate validation and per-route resolver choice.
