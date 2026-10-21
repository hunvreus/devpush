---
description: Run the control plane and deploy to a local Lima VM.
---

# Local development

This guide runs the Node control plane on your laptop and, optionally, an agent
inside a Linux VM. For a hosted installation, use [Cloudflare](/docs/cloudflare-deployment/)
or [Docker Compose](/docs/production-operations/).

## Requirements

- Node.js 22 or newer and pnpm 10.17 or newer.
- Go 1.27 or newer to build or test the agent.
- macOS and Lima for the managed local VM workflow. Install Lima using its
  [official installation guide](https://lima-vm.io/docs/installation/).

## Start the control plane

```sh
pnpm install
pnpm configure
pnpm --dir app db:migrate
pnpm dev
```

Choose **Local development** in setup. It writes the ignored `app/.env`, generates
secrets and can configure a GitHub App. An existing installation should reuse its
credentials. Setup does not start the app or create a production deployment.

Open `http://localhost:7429`. The port is fixed; startup fails if it is occupied.
Configure sign-in using the [configuration reference](/docs/configuration/#authentication).
The first account becomes installation administrator unless `DEVPUSH_ADMIN_EMAIL`
selects another address.

SQLite files are created under `app/.data/`. Keep the encryption key when reusing
an existing database. Do not replace it with a newly generated key.

## Deploy to a local VM

```sh
pnpm vm:setup
pnpm agent:build:linux
```

`vm:setup` creates `devpush-test` if missing and starts it with Docker installed.
It uses 2 CPUs, 4 GiB memory, a 30 GiB disk and macOS VZ/vzNAT networking. Other
Lima and Colima instances are not part of this workflow.

Set these values in `app/.env`, then restart the control plane:

```env
DEVPUSH_BASE_URL=http://host.lima.internal:7429
BETTER_AUTH_URL=http://localhost:7429
DEVPUSH_MCP_URL=http://localhost:7429/mcp
DEVPUSH_AGENT_BINARY_DIR=/absolute/path/to/devpush/bin
```

The VM reaches the laptop through `host.lima.internal`; browser login and local
assistants keep using localhost. In devpush, add a server and copy the URL from
its generated install command:

```sh
pnpm vm:install 'http://host.lima.internal:7429/api/install/agent/INSTALL_TOKEN'
```

Use the actual generated URL. This runs the installer inside the VM and pins its
reachable private IP with `--address`. Wait for the server to connect, then create
a project. Generated Visit URLs use HTTP and nip.io, for example
`http://my-app-192-168-64-7.nip.io`. No proxy, hosts-file change, certificate setup
or manual host-port mapping is required.

If the VM's IP changes, update `DEVPUSH_ROUTING_ADDRESS` in
`/etc/devpush/agent.env` inside the VM, then restart `devpush-agent`. This changes
the existing agent's routing pin without reusing an expired enrollment URL.
Existing aliases are not rewritten automatically. Inspect generated URLs before using
them; editing a service route does not change an alias hostname. See
[Routing addresses](/docs/servers/#routing-addresses). A DNS resolver that blocks private-address answers may also block nip.io.

## Start and stop helpers

```sh
pnpm dev:start
pnpm dev:stop
pnpm dev:restart
pnpm vm:stop
```

`dev:start` starts an existing test VM, applies migrations and backgrounds the
control plane. Its log is `.tmp/devpush-dev.log`. Use `DEVPUSH_REQUIRE_LIMA=0` for
web-only work, or `DEVPUSH_LIMA_INSTANCE=NAME` for another existing VM.
`dev:stop` only stops the matching devpush Vite process from this checkout.
Stopping the app does not stop the VM or its application containers.

`pnpm vm:destroy` deletes the owned test VM and its data. Use it only when you
want a fresh VM. The automated `vm:test` flow uses this same fixed `devpush-test` name and refuses
an enrolled VM. To switch from manual deployments to those tests, preserve any
needed data, then run `pnpm vm:destroy` followed by `pnpm vm:test`. Destroying the
VM deletes its data; it does not remove its server record from the dashboard.
See [Testing](/docs/testing/#local-vm-tests).

## Documentation changes

Edit the flat Markdown pages under `docs/` alongside behavior changes and run
`pnpm docs:check`. Docs-only corrections do not need an app-code change or app
deployment. Website imports and maintainer secret setup are described in the
[repository README](https://github.com/hunvreus/devpush/blob/main/README.md#maintainer-workflows).

## Troubleshooting

- **Agent disconnected:** from the VM, request
  `http://host.lima.internal:7429/api/health`. Check the laptop listener and the
  persisted `/etc/devpush/agent.env` URL.
- **Visit fails:** confirm the VM IP and the configured route's service, port and
  exact hostname. DNS resolution alone does not configure Traefik.
- **OAuth fails:** check the registered origin and callback against
  [Configuration](/docs/configuration/#authentication).
- **Schema changed:** generate a migration and apply it; do not reset shared data.
  See [Testing and schema changes](/docs/testing/#schema-changes).
