---
description: Run the control plane locally, deploy to a Lima VM and run tests.
---

# Local development

This guide runs the Node control plane on your machine and, optionally, an agent in a local Linux VM. For a remote installation, see [Cloudflare](/docs/cloudflare-deployment/) or [Docker Compose](/docs/production-operations/). For code structure and plugins, see [Development](/docs/development/).

## Requirements

- Node.js 22.12+ and pnpm 10.17+.
- Go 1.27.3, pinned in `agent/go.mod`, to build or test the agent.
- macOS and [Lima](https://lima-vm.io/docs/installation/) for the VM workflow.

## Start the control plane

```sh
pnpm install
pnpm configure
pnpm dev
```

Choose **Local development**. Setup writes `app/.env`, generates secrets and can create a GitHub App. `pnpm dev` applies pending migrations to the databases in `app/.data/`, and stops if a migration fails. If you reuse a database, keep its existing encryption key.

Open `http://localhost:7429`. Startup fails if the port is in use. Configure [sign-in](/docs/configuration/#authentication). The first account becomes administrator unless `DEVPUSH_ADMIN_EMAIL` is set. Node development does not start the background scheduler; see [Background work](/docs/production-operations/#background-work).

## Local deployment VM

```sh
pnpm vm:setup
pnpm agent:build:linux
```

`vm:setup` creates and starts the `devpush-test` VM with Docker. The VM has 2 CPUs, 4 GiB of memory, a 30 GiB disk and VZ/vzNAT networking. Set these values in `app/.env` and restart the app:

```env
DEVPUSH_BASE_URL=http://host.lima.internal:7429
BETTER_AUTH_URL=http://localhost:7429
DEVPUSH_MCP_URL=http://localhost:7429/mcp
DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
```

The VM reaches your machine through `host.lima.internal`, while the browser keeps using localhost. Add a server in devpush and pass the URL from its generated install command:

```sh
pnpm vm:install 'http://host.lima.internal:7429/api/install/agent/INSTALL_TOKEN'
```

This installs the agent and pins the VM's private IP with `--address`. When the server connects, create a project. Visit URLs use HTTP and nip.io, such as `http://my-app-192-168-64-7.nip.io`. DNS resolvers that block private-address answers may also block nip.io.

If the VM's IP changes, update `DEVPUSH_ROUTING_ADDRESS` in the VM's `/etc/devpush/agent.env` and restart `devpush-agent`. Existing aliases are not rewritten; see [Routing addresses](/docs/servers/#routing-addresses).

Helper commands:

- `pnpm dev:start`, `pnpm dev:stop` and `pnpm dev:restart` manage the app in the background. The log is `.tmp/devpush-dev.log`.
- `dev:start` also starts the VM, unless you set `DEVPUSH_REQUIRE_LIMA=0`. `DEVPUSH_LIMA_INSTANCE=NAME` selects another VM.
- `pnpm vm:stop` stops the VM.
- `pnpm vm:destroy` deletes the VM and its data. It does not remove the server record from the dashboard.

## Tests

Run tests from the repository root. Tests use temporary stores; never point them at live data. Start with the narrowest check for your change:

| Command | Coverage |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | TypeScript and lint rules |
| `pnpm test` | App unit/DOM, setup, VM and script tests |
| `pnpm test:integration` | Persistence against isolated SQLite/D1 |
| `pnpm --dir app test:integration:libsql` | Services through libSQL |
| `pnpm agent:test` | Go agent |
| `pnpm build` | Production Node build |
| `pnpm test:package` | Installed tarball on Node and Workers |
| `DEVPUSH_WRANGLER_CONFIG=wrangler.template.jsonc pnpm --dir app build:cloudflare` | Worker build from the template |
| `pnpm audit:dependencies` | Dependency vulnerabilities |
| `pnpm docs:check` | Documentation navigation and links |

CI workflows define the automated gates. A configured workflow does not prove that a given revision passed.

### Schema changes

```sh
pnpm --dir app db:generate
pnpm --dir app db:generate:logs
pnpm --dir app db:migrate
pnpm test:integration
```

`db:migrate` applies both main and log stores. Generate only the migration sets you changed, and commit the SQL with its Drizzle metadata. Never rewrite an applied migration. Use `db:push` only for disposable local experiments.

### VM and smoke tests

`pnpm vm:test` runs real Compose deployment, Traefik routing and HTTPS certificate tests against `devpush-test`. It refuses an enrolled VM. If you have used the VM manually, preserve any data you need and run `pnpm vm:destroy` first. `pnpm smoke:agent` runs the same tests against another isolated Docker host. Never use a host that serves other agents.

Other checks:

- `pnpm validate:local` runs the routine checks plus deployment and Docker routing smoke tests. Set `DEVPUSH_SKIP_DOCKER_SMOKE=1` only to deliberately skip the routing smoke test.
- `pnpm build && pnpm smoke:node`, `pnpm smoke:dev` and `pnpm --dir app smoke:worker d1` run isolated Node, development and Worker servers.
- `pnpm validate:production` builds and checks the Compose image and stack. It requires Docker.
- `pnpm smoke:deploy` creates fixture data in the **current** database configuration. Run it only against isolated stores.
- `pnpm validate:remote` and `pnpm validate:remote:proof` install and verify an agent on a dedicated test host. Read `pnpm validate:remote -- --help` first, and treat the install command as a credential.
- `pnpm setup:hetzner -- --list` lists server options. Only `--create` makes a billable server. `--destroy` removes tracked resources.

Local simulators do not prove real provider credentials, DNS or GitHub webhooks.

## Troubleshooting

- **Agent disconnected:** From the VM, request `http://host.lima.internal:7429/api/health`. Check the laptop listener and the URL in `/etc/devpush/agent.env`.
- **Visit fails:** Confirm the VM IP and the route's service, port and exact hostname. DNS resolution alone does not configure Traefik.
- **OAuth fails:** Check the registered origin and callback against [Authentication](/docs/configuration/#authentication).
