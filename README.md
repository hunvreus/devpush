# devpush

devpush deploys GitHub applications to your own servers using Docker Compose.
The control plane manages teams, projects, environments, deployments, logs and
backups. A Go agent on each server runs Docker Compose and Traefik, connecting
outbound to the control plane.

Run the control plane as a Node container or on Cloudflare Workers. Application
containers run on your Linux servers. The public management API and MCP server
are included.

## Get started

Requires Node.js 22+, pnpm 10.17+, and Go 1.27+ to build the agent.

```sh
pnpm install
pnpm configure
pnpm --dir app db:migrate
pnpm dev
```

Choose local development in the setup wizard, configure sign-in, then open
`http://localhost:7429`. Setup writes configuration; it does not deploy the app.
For existing maintainer credentials, use `pnpm secrets:pull` instead of generating
new secrets; see [local development](docs/local-setup.md).

To use an existing dashboard, follow [Getting started](docs/getting-started.md).
To install your own, start with [Self-host devpush](docs/self-hosting.md).
For production details, follow [Docker Compose operations](docs/production-operations.md)
or [Cloudflare deployment](docs/cloudflare-deployment.md). The
[configuration reference](docs/configuration.md) covers callback URLs, secrets,
databases and storage.

An optional `DEVPUSH_SIGN_IN_MESSAGE` displays a public login notice. Configure it
in the deployment environment and restart/redeploy; blank hides it. See
[Administration](docs/administration.md#sign-in-message).

## Test a deployment locally

On macOS, install [Lima](https://lima-vm.io/docs/installation/), then:

```sh
pnpm vm:setup
pnpm agent:build:linux
```

Before enrollment, set these values in `app/.env` and restart the app:

```env
DEVPUSH_BASE_URL=http://host.lima.internal:7429
BETTER_AUTH_URL=http://localhost:7429
DEVPUSH_MCP_URL=http://localhost:7429/mcp
DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
```

Add a server in devpush and pass its generated installer URL to:

```sh
pnpm vm:install 'http://host.lima.internal:7429/api/install/agent/INSTALL_TOKEN'
```

The [local VM guide](docs/local-setup.md#deploy-to-a-local-vm) explains the required
app origins and complete enrollment flow. The VM receives its reachable private
address automatically; Visit links use HTTP and nip.io. No local proxy, hosts-file
change or manual port mapping is required.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm configure` | Configure local, Node production or Cloudflare settings. |
| `pnpm secrets:pull` | Restore maintainer app settings from 1Password. |
| `pnpm dev` | Run the foreground development server on port 7429. |
| `pnpm dev:start` / `dev:stop` / `dev:restart` | Manage this checkout's background development process. |
| `pnpm vm:setup` / `vm:stop` / `vm:destroy` | Create/start, stop or delete the owned test VM. |
| `pnpm vm:install URL` | Enroll the VM using a generated installer URL. |
| `pnpm setup:github-app` | Configure an existing or new GitHub App. |
| `pnpm vm:test` | Run real Docker tests in a clean test VM. Refuses enrolled VMs. |
| `pnpm build` | Build the Node control plane. |
| `pnpm agent:build:linux` | Build agent binaries for Linux amd64 and arm64. |
| `pnpm typecheck` / `lint` / `test` | Check application code and script tests. |
| `pnpm test:integration` | Run database integration tests against isolated stores. |
| `pnpm agent:test` | Run Go agent tests. |
| `pnpm docs:check` | Check documentation navigation, local links and anchors. |
| `pnpm cleanup:recover --help` | Inspect and resolve blocked deletions as an installation operator. |

See [Testing](docs/testing.md) for targeted checks, schema changes, real Docker
validation and deployment proofs. Deployment commands publish infrastructure;
review the target configuration before running them.

## Repository

| Path | Contents |
| --- | --- |
| `app/` | TanStack Start application, database schemas and migrations. |
| `agent/` | Linux host agent, Compose execution and ingress. |
| `scripts/` | Setup, local development and validation commands. |
| `deploy/` | Production container configuration. |
| `docs/` | Flat Markdown pages and ReallySimpleDocs navigation. |
| `examples/compose-web/` | Small application for deployment validation. |

[Documentation](docs/index.md) is the entrypoint for product guides and operations.
[Architecture](ARCHITECTURE.md) records mechanics and invariants;
[TODO](TODO.md) is the only backlog, and [Changelog](CHANGELOG.md) records changes.

## Current limits

Compose is the supported application runtime. Dockerfiles work as Compose build
inputs; Dockerfile-only projects and Docker Swarm are not implemented. Default
Compose updates do not guarantee zero downtime. Deployed repositories are trusted
code with host-level Docker access; use separate servers for untrusted workloads.

Main and log databases each start at a `0000_initial` release baseline.
Pre-release migration histories are unsupported. Back up/export old data before
creating fresh databases; a source update never resets an existing database.
The clean remote deployment proof remains a release gate in TODO.

## Maintainer workflows

These helpers are for this project's maintainers, not requirements for self-hosting.

### Local secrets

Maintainers can restore individual settings from **Development → devpush (local)**
in 1Password, tagged `devpush`, using the API Credentials item category:

```sh
pnpm secrets:pull
```

Requires 1Password CLI (`op`). On macOS the command reads the service-account token
from Keychain service `development-1password`, account `service-account`.
Alternatively, supply `OP_SERVICE_ACCOUNT_TOKEN` through your secret manager.
To add the Keychain entry without putting the token in shell history:

```sh
security add-generic-password -a service-account -s development-1password -w
```

The pull replaces `app/.env` atomically with owner-only permissions. Save local
changes to the corresponding vault fields first; synchronization is manual.
Only **Local application** fields generate this file. **Local tooling** holds
separate credentials such as `HETZNER_API_TOKEN`. The current maintainer production
item is `devpush (production)` in Development, tagged `devpush` and `production`;
its individual production fields are separate from retained legacy settings.
`pnpm secrets:pull` loads only the local item. Vault permissions control access;
project/environment tags only organize items. Use a dedicated vault and service
account when production needs a separate access boundary.

### Publish documentation

The Markdown under this repository's `docs/` is the source of truth. Update it
alongside behavior changes; docs-only corrections need only a documentation commit,
not application-code changes or an app deployment. Run `pnpm docs:check`.

The marketing website in `hunvreus/devpush-website` imports these files using
ReallySimpleDocs, using its ReallySimpleDocs integration.
In the website checkout, run `pnpm sync:docs`, `pnpm test` and `pnpm build`, then
review and commit the imported content before publishing. The import records the
source revision and whether the docs/theme had uncommitted changes.

`app/src/styles/theme.css` is the source for the app and website's shadcn/ui Taupe
colors, with a slightly lifted dark page background below the card surface.
The website's docs import copies that stylesheet too. Keep the website's
imported docs/theme generated: edit the source here and publish a reviewed revision
separately. Production publication and automated deployment setup remain separate
release tasks.
