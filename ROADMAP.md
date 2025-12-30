## Now

- [ ] **Database**: Allow users to create SQLite databases and make them available to projects/environments.
- [ ] **Storage**: Persistent storage (volumes) per project/environment. Support 3rd party storage (S3, R2, Cloudinary).
- [ ] **Monitoring**: Add Prometheus to track I/O, network, memory, CPU, etc. Add dashboard.

## Next

- [ ] **Cancel and skip**: Allow users to cancel ongoing deployments, skip deployments on rapid commits.
- [ ] **Dependency caching**: Add caching for dependencies (i.e. volumes for .venv, node_modules, etc) per project.
- [ ] **Better error logging**: improve error logging for deployments (e.g., when errors aren't captured by Loki, like a worker-arq crash).
- [ ] **Remote nodes**: Ability to add multiple remote nodes to deploy apps.
- [ ] **Deployment settings**: Provide more granular rules for deployments (triggers, # concurrent events, commit author, etc).
- [ ] **Rate limiting**: Add Traefik protections for auth + sensitive endpoints (env-flagged).

## Later

- [ ] **API & CLI**: REST API for projects + deployments. Leverage it to create a CLI.
- [ ] **AI & MCP**: integrating an agent to actively audit and fix code/infra.
- [ ] **GitLab & BitBucket support**: 
- [ ] **Enterprise/self-hosted git provider support**: for example GitHub Enterprise.
- [ ] **Project webhook**
- [ ] **Cron**
- [ ] **Queue + Worker**
- [ ] **Java support**
- [ ] **Granular permissions**
- [ ] **Export**: Project export/import.
- [ ] **Deploy on /dev/push**: Button/link to deploy on /dev/push (w/ configurable values).
- [ ] **Notifications**: Send notifications on events (e.g., error/success)
- [ ] **Audit logs**: Implement basic audit logs (especially logins and deployments).
- [ ] **Redirects**: Redirect rules (incl. bulk import).
- [ ] **devpush.json**: Configuration file to override project settings.
- [ ] **Logs improvements**: Copy button, better out of logs errors handling, imrpove log type parsing (e.g. error/warning/success).
