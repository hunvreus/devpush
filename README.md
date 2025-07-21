# DevPush

A modern deployment platform built with FastAPI, Kubernetes, and Traefik. Deploy your applications with zero downtime and automatic scaling.

## Features

- **Zero-downtime deployments** with rolling updates
- **Automatic scaling** with KEDA (scale-to-zero for idle runners)
- **GitHub integration** for seamless deployments
- **Real-time logs** and monitoring
- **Multi-environment support** (dev/prod)
- **HTTPS support** with automatic SSL certificates
- **Container orchestration** with Kubernetes

## Architecture

- **Backend**: FastAPI with async/await
- **Database**: PostgreSQL with Alembic migrations
- **Cache**: Redis for job queues and sessions
- **Orchestration**: Kubernetes (K3s) with Traefik ingress
- **Container Runtime**: Docker with Kubernetes API
- **Monitoring**: Prometheus metrics integration

## Prerequisites

- **macOS** (for local development)
- **Docker Desktop** or **Colima**
- **kubectl** (Kubernetes CLI)
- **Helm** (Kubernetes package manager)
- **Python 3.12+**

## Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo>
cd devpush
```

### 2. Install Dependencies

```bash
# Install Python dependencies
pip install -r app/requirements.txt

# Install system dependencies
brew install kubectl helm
```

### 3. Environment Setup

```bash
# Copy environment template
    cp .env.example .env

# Edit environment variables
nano .env
```

### 4. Start Development Environment

```bash
# One-time setup (Colima + K3s + Traefik)
./scripts/local/setup.sh

# Daily development (build and deploy)
./scripts/local/start.sh
```

Your app will be available at: **http://localhost:30080**

## Development Workflow

### Daily Development

```bash
# Start development environment
./scripts/local/start.sh

# After code changes
./scripts/local/deploy.sh
```

### Clean Restart

```bash
# Stop everything and clean up
./scripts/local/clean.sh

# Fresh setup
./scripts/local/setup.sh
```

## Project Structure

```
devpush/
├── app/                    # FastAPI application
│   ├── main.py            # Application entry point
│   ├── models.py          # Database models
│   ├── routers/           # API routes
│   ├── services/          # Business logic
│   └── templates/         # HTML templates
├── k8s/                   # Kubernetes manifests
│   ├── app-deployment.yaml
│   ├── app-service.yaml
│   ├── app-ingress.yaml
│   ├── pgsql-deployment.yaml
│   └── redis-deployment.yaml
├── helm/                  # Helm configuration
│   ├── values-dev.yaml    # Development Traefik config
│   └── values-prod.yaml   # Production Traefik config
├── scripts/
│   ├── local/             # Local development scripts
│   │   ├── setup.sh       # Environment setup
│   │   ├── start.sh       # Daily development
│   │   └── deploy.sh      # App deployment
│   └── prod/              # Production deployment
└── Docker/                # Docker configurations
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `/dev/push` | Application name |
| `APP_DESCRIPTION` | `Build and deploy your Python app without touching a server.` | App description |
| `URL_SCHEME` | `http` | URL scheme (http/https) |
| `HOSTNAME` | `localhost` | Domain name for the application |
| `DEPLOY_DOMAIN` | `localhost` | Domain for deployments |
| `SECRET_KEY` | - | Application secret key |
| `ENCRYPTION_KEY` | - | Encryption key for sensitive data |
| `EMAIL_SENDER_NAME` | `/dev/push` | Email sender name |
| `EMAIL_SENDER_ADDRESS` | `mail@devpu.sh` | Email sender address |
| `RESEND_API_KEY` | - | Resend API key for emails |
| `GITHUB_APP_ID` | - | GitHub App ID |
| `GITHUB_APP_NAME` | - | GitHub App name |
| `GITHUB_APP_PRIVATE_KEY` | - | GitHub App private key |
| `GITHUB_APP_WEBHOOK_SECRET` | - | GitHub webhook secret |
| `GITHUB_APP_CLIENT_SECRET` | - | GitHub App client secret |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `POSTGRES_DB` | `devpush` | PostgreSQL database name |
| `POSTGRES_USER` | `devpush-app` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `devpush` | PostgreSQL password |
| `LOG_LEVEL` | `INFO` | Logging level |
| `DB_ECHO` | `false` | Echo SQL queries (debug) |

## Database Migrations

```bash
# Create new migration
uv run alembic revision --autogenerate -m "description"

# Apply migrations
uv run alembic upgrade head

# Rollback migration
uv run alembic downgrade -1
```

## Kubernetes Resources

### Core Services

- **App**: FastAPI application with workers
- **PostgreSQL**: Persistent database with StatefulSet
- **Redis**: Cache and job queue
- **Traefik**: Ingress controller with Helm

### Runner System

- **Dynamic runners**: Created per deployment
- **Scale-to-zero**: Idle runners scale down automatically
- **Resource isolation**: Each runner in separate namespace
- **Automatic cleanup**: Runners removed after deployment

## Production Deployment

### Infrastructure Setup

```bash
# Install K3s on Hetzner server
curl -sfL https://get.k3s.io | sh -s -- --disable traefik

# Install Traefik with production config
helm install traefik traefik/traefik \
  --namespace ingress-traefik --create-namespace \
  -f helm/values-prod.yaml
```

### Application Deployment

```bash
# Deploy application
kubectl apply -f k8s/

# Check status
kubectl get pods
kubectl get services
kubectl get ingress
```

## Monitoring

### Prometheus Integration

```bash
# Install Prometheus
helm install prometheus prometheus-community/kube-prometheus-stack

# Access Grafana
kubectl port-forward svc/prometheus-grafana 3000:80
```

### Application Metrics

- **Runner metrics**: CPU, memory, network usage
- **Deployment metrics**: Success rate, duration
- **Queue metrics**: Job count, processing time

## Troubleshooting

### Common Issues

**Colima not starting:**
```bash
colima stop
colima start --kubernetes --kubernetes-disable=traefik
```

**App not accessible:**
```bash
kubectl get pods
kubectl logs app-deployment-xxx
kubectl get ingress
```

**Database connection issues:**
```bash
kubectl logs pgsql-deployment-xxx
kubectl exec -it pgsql-deployment-xxx -- psql -U postgres
```

### Useful Commands

```bash
# Check all resources
kubectl get all

# View logs
kubectl logs -f deployment/app

# Access app shell
kubectl exec -it deployment/app -- bash

# Check Traefik status
kubectl get pods -n ingress-traefik
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `./scripts/local/start.sh`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.