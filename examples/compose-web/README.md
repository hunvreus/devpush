# devpush Compose web example

This is a minimal Docker Compose app for MVP validation.

It exposes one stateless `web` service on port `3000` and serves static files
through Python's built-in HTTP server. Use this when you need a known-good repo
to prove server enrollment, project creation, deployment, Traefik routing, and
public route checks.

Expected devpush settings:

- Compose file path: `compose.yml`
- Public route service: `web`
- Public route port: `3000`
- Readiness path: `/health`
- Release command: empty

Local check:

```bash
docker-compose -f compose.yml up -d
docker-compose -f compose.yml exec -T web wget -qO- http://127.0.0.1:3000/health
docker-compose -f compose.yml down
```
