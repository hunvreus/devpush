# /dev/push

An open-source and self-hostable alternative to Vercel, Render, Netlify and the likes. It allows you to build and deploy any app (Python, Node.js, PHP, ...) with zero-downtime updates, real-time logs, team management, customizable environments and domains, etc.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://devpu.sh/assets/images/screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://devpu.sh/assets/images/screenshot-light.png">
  <img alt="A screenshot of a deployment in /dev/push." src="https://devpu.sh/assets/images/screenshot-dark.png">
</picture>

## Key features

- **Git-based deployments**: Push to deploy from GitHub with zero-downtime rollouts and instant rollback.
- **Multi-language support**: Python, Node.js, PHP... basically anything that can run on Docker.
- **Environment management**: Multiple environments with branch mapping and encrypted environment variables.
- **Real-time monitoring**: Live and searchable build and runtime logs.
- **Team collaboration**: Role-based access control with team invitations and permissions.
- **Custom domains**: Support for custom domain and automatic Let's Encrypt SSL certificates.
- **Self-hosted and open source**: Run on your own servers, MIT licensed.

## Support the project 

- [Contribute code](/CONTRIBUTING.md)
- [Report issues](https://github.com/hunvreus/devpush/issues)
- [Sponsor me](https://github.com/sponsors/hunvreus)
- [Star the project on GitHub](https://github.com/hunvreus/devpush)
- [Join the Discord chat](https://devpu.sh/chat)

## Documentation

- [User documentation](https://devpu.sh/docs)
- [Technical documentation](ARCHITECTURE.md)

## Quickstart

> ⚠️ Supported on Ubuntu/Debian. Other distros may work but aren't officially supported (yet).

Log in your server and run the following command:

```bash
curl -fsSL https://install.devpu.sh | sudo bash
```

Once installed you will be directed to open the setup wizard in your browser at `http://<server_ip_address>`. After completing this step you can restart the app with `sudo systemctl restart devpush.service` and visit the app `https://<app_hostname>`.

You will need a fresh Ubuntu/Debian server you can SSH into with sudo privileges. We recommend a CPX31 from [Hetzner](https://www.hetzner.com).

We also recommend you use [Cloudflare](https://cloudflare.com):

- Set SSL/TLS to "Full (strict)" and leave records proxied for the app hostname and deploy domain, unless you are using subdomains.
- Select "Cloudflare DNS" as "SSL Provider" (you'll need an API)

For more information, including manual installation or updates, refer to [the documentation](https://devpu.sh/docs)

## Development

Install the dependencies (i.e. Docker, Colima) and start the setup wizard: `./scripts/start.sh`. Once completed, start the app: `./scripts/restart.sh`.

## Scripts

| Script | What it does |
|---|---|
| `scripts/backup.sh` | Create backup of data directory, database, and code metadata (`--output <file>`, `--verbose`) |
| `scripts/build-runners.sh` | Build runner images (`--no-cache`, `--image <name>`) |
| `scripts/clean.sh` | Stop stack and clean dev data (`--remove-all`, `--remove-data`, `--remove-containers`, `--remove-images`, `--yes`) |
| `scripts/compose.sh` | Docker compose wrapper with correct files/env (`--setup`, `--`) |
| `scripts/db-generate.sh` | Generate Alembic migration (prompts for message) |
| `scripts/db-migrate.sh` | Apply Alembic migrations (`--timeout <sec>`) |
| `scripts/install.sh` | Server setup: Docker, user, clone repo, systemd unit (`--repo <url>`, `--ref <ref>`, `--yes`, `--no-telemetry`, `--ssl-provider <name>`, `--verbose`) |
| `scripts/restart.sh` | Restart services (`--setup`, `--no-migrate`) |
| `scripts/restore.sh` | Restore from backup archive; requires `--archive <file>` (`--no-db`, `--no-data`, `--no-code`, `--no-restart`, `--no-backup`, `--timeout <sec>`, `--yes`, `--verbose`) |
| `scripts/start.sh` | Start stack (setup auto-detected) (`--setup`, `--no-migrate`, `--timeout-docker <sec>`, `--timeout-app <sec>`, `--ssl-provider <value>`, `--verbose`) |
| `scripts/status.sh` | Show stack status |
| `scripts/stop.sh` | Stop services (auto-detects run/setup) (`--hard`) |
| `scripts/uninstall.sh` | Uninstall from server (`--yes`, `--no-telemetry`, `--verbose`) |
| `scripts/update.sh` | Update by tag (`--ref <tag>`, `--all`, `--full`, `--components <csv>`, `--no-migrate`, `--no-telemetry`, `--yes`, `--ssl-provider <name>`, `--verbose`) |

## Environment variables

| Variable | Description |
|---|---|
| `APP_NAME` | App name. Default: `/dev/push`. |
| `APP_DESCRIPTION` | App description. Default: `Deploy your Python app without touching a server.`. |
| `LE_EMAIL` | Email used to register the Let's Encrypt (ACME) account in Traefik; receives certificate issuance/renewal/expiry notifications. |
| `APP_HOSTNAME` | Domain for the app (e.g. `app.devpu.sh`). |
| `DEPLOY_DOMAIN` | Domain used for deployments (e.g. `devpush.app` if you want your deployments available at `*.devpush.app`). Default: `APP_HOSTNAME`. |
| `SERVER_IP` | Public IP of the server. Default: `127.0.0.1`. |
| `SECRET_KEY` | App secret for sessions/CSRF. Generate: `openssl rand -hex 32`. |
| `ENCRYPTION_KEY` | Used to encrypt secrets in the DB (e.g. environment variables). Must be a Fernet key (urlsafe base64, 32 bytes). Generate: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n'`. |
| `EMAIL_LOGO` | URL for email logo image. Only helpful for testing, as the app will use `app/logo-email.png` if left empty. |
| `EMAIL_SENDER_NAME` | Name displayed as email sender for invites/login. Default: `/dev/push`. |
| `EMAIL_SENDER_ADDRESS` | Email sender used for invites/login. |
| `RESEND_API_KEY` | API key for [Resend](https://resend.com). |
| `GITHUB_APP_ID` | GitHub App ID. |
| `GITHUB_APP_NAME` | GitHub App name. |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM format). |
| `GITHUB_APP_WEBHOOK_SECRET` | GitHub webhook secret for verifying webhook payloads. |
| `GITHUB_APP_CLIENT_ID` | GitHub OAuth app client ID. |
| `GITHUB_APP_CLIENT_SECRET` | GitHub OAuth app client secret. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `POSTGRES_DB` | PostgreSQL database name. Default: `devpush`. |
| `POSTGRES_USER` | PostgreSQL username. Default: `devpush-app`. |
| `POSTGRES_PASSWORD` | PostgreSQL password. Generate: `openssl rand -base64 24 | tr -d '\n'`. |
| `REDIS_URL` | Redis connection URL. Default: `redis://redis:6379`. |
| `DOCKER_HOST` | Docker daemon host address. Default: `tcp://docker-proxy:2375`. |
| `DATA_DIR` | Persistent data directory. Default: `/var/lib/devpush`. |
| `APP_DIR` | Directory where the application code is stored. Default: `/opt/devpush`. |
| `UPLOAD_DIR` | Directory for file uploads. Default: `${DATA_DIR}/upload`. |
| `TRAEFIK_DIR` | Traefik configuration directory. Default: `${DATA_DIR}/traefik`. |
| `SERVICE_UID` | Numeric UID used inside containers; auto-set to match the host `devpush` user (or your local user in development). |
| `SERVICE_GID` | Numeric GID used inside containers; auto-set alongside `SERVICE_UID`. |
| `DEFAULT_MEMORY_MB` | Default memory limit for containers (MB). Default: `2048`. |
| `JOB_TIMEOUT` | Job timeout in seconds. Default: `320`. |
| `JOB_COMPLETION_WAIT` | Job completion wait time in seconds. Default: `300`. |
| `DEPLOYMENT_TIMEOUT` | Deployment timeout in seconds. Default: `300`. |
| `LOG_LEVEL` | Logging level. Default: `WARNING`. |
| `DB_ECHO` | Enable SQL query logging. Default: `false`. |
| `ENV` | Environment (development/production). Default: `production`. |
| `ACCESS_DENIED_MESSAGE` | Message shown to users who are denied access based on [sign-in access control](#sign-in-access-control). Default: `Sign-in not allowed for this email.`. |
| `ACCESS_DENIED_WEBHOOK` | Optional webhook to receive denied events (read more about [Sign-in access control](#sign-in-access-control)). |
| `LOGIN_HEADER` | HTML snippet displayed above the login form. |
| `TOASTER_HEADER` | HTML snippet displayed at the top of the toaster (useful to display a permanent toast on all pages). |

## License

[MIT](/LICENSE.md)
