# Devpush Helm Chart (Local First)

This chart currently runs an app-first subset on Kubernetes:

- `app`
- `pgsql`
- `redis`
- `worker-jobs`
- `worker-monitor`

## Local (Mac M1) with Colima Kubernetes (recommended)

Ensure your current context is `colima`:

```bash
kubectl config current-context
```

Then run:

```bash
./scripts/start.sh
```

The script:

- builds local image `devpush-app:dev` from `docker/Dockerfile.app.dev`
- uses `data/.env` to create/update Kubernetes secret `devpush-env`
- deploys the Helm chart
- prints browser URL based on Traefik exposure mode

Optional script overrides:

- `DEVPUSH_ENV_FILE` (default: `data/.env`)
- `DEVPUSH_KUBE_CONTEXT` (default: current `kubectl` context)
- `DEVPUSH_NAMESPACE` (default: `devpush`)
- `DEVPUSH_RELEASE_NAME` (default: `devpush`)

## Alternative: k3d

```bash
k3d cluster create devpush --agents 1 -p "8080:80@loadbalancer"
```

Build and load your app image:

```bash
docker build -t devpush-app:local -f docker/Dockerfile.app .
k3d image import devpush-app:local -c devpush
```

Install chart:

```bash
helm upgrade --install devpush ./helm/devpush \
  --namespace devpush --create-namespace \
  --set image.repository=devpush-app \
  --set image.tag=local \
  --set app.ingress.enabled=true \
  --set app.ingress.host=devpush.local
```

Check workloads:

```bash
kubectl -n devpush get pods,svc,ingress
```

or use helpers:

```bash
DEVPUSH_KUBE_CONTEXT=k3d-devpush ./scripts/start.sh
./scripts/status.sh
./scripts/db-migrate.sh
./scripts/stop.sh
./scripts/clean.sh
```

## Notes

- This chart is local-first and does not yet include TLS/cert-manager.
- Redirect domain parity relies on Traefik middleware support from app routing sync.
- Migrations are disabled by default for first local bring-up (`migration.enabled=false`).
- `.env` takes precedence in runtime because scripts create/update `${RELEASE_NAME}-env` from `data/.env` and set `env.existingSecretName`.
