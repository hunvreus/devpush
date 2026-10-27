# devpush

devpush is an open-source deployment platform for your own servers. Connect a GitHub repository, configure your Docker Compose app and push to deploy.

Run the dashboard on **Cloudflare Workers** or **Node**. A small Linux agent manages applications on your servers, including HTTPS, deployment logs, monitoring and backups. Teams, environments, encrypted variables, a REST API and MCP are included.

## Get started

- [Install devpush](docs/getting-started/self-hosting.md) on Cloudflare or with Docker Compose.
- [Deploy your first app](docs/getting-started/getting-started.md) once your dashboard is running.
- [Read the documentation](docs/index.md) for configuration and operations.

The guided installation currently uses a source checkout. Package installation is a preview until the first package and matching agent release are published.

Compose is required; Dockerfiles can be used within it. Updates happen in place and do not guarantee zero downtime. Only deploy trusted code: Docker workloads can access their host.

## Development

Requires Node.js 22.12+ and pnpm 10.17+:

```sh
pnpm install
pnpm configure
pnpm dev
```

Choose local development and open `http://localhost:7429`. See [Local development](docs/development/local-setup.md) for tests and the deployment VM, and [Contributing](docs/development/development.md) for code boundaries and plugins.

## License

[MIT](LICENSE.md). See [changes](CHANGELOG.md) and [planned work](TODO.md).
