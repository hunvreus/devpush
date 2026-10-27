# TODO

Outstanding work only. Private extension work belongs in its own repository.

## Before beta release

- Revoke or confirm revocation of the historical infrastructure credential found by secret scanning.

- Run remote upgrade/drain and backup/restore proofs against the release candidate.
- Verify real Claude OAuth and a second MCP client on Node and Workers.
- Publish the updated website/docs; replace comparison placeholders and the old demo.

## Reliability and operations

- Load-test concurrent deployments, log ingestion and database recovery on D1/libSQL.
- Preserve generated deployment URLs safely across server IP changes.
- Provide operator recovery for rejected completion records and orphaned log captures.
- Detect source-log gaps caused by Docker rotation.
- Reproduce intermittent local agent-poll transport resets before changing transport behavior.
- Add connectivity preflight to remote-agent tests.
- Support encryption-key rotation with multi-key reads and an audited rewrite.
- Package an init/migrate CLI; add GitHub Actions setup for Cloudflare bindings and secrets.
- Retire obsolete remote test resources after checking consumers.
- Support control-plane ownership transfer for servers with deployments.

## API and MCP

- Complete REST custom-domain, repository, avatar and enrollment operations with safe retry semantics.
- Define grants for membership, account, administration and credential operations before exposing them through APIs.
- Support Worker client metadata discovery only with validated, pinned DNS.
- Define API compatibility/version policy; add service accounts or stdio transport only for demonstrated needs.

## Product

- Add Dockerfile projects through explicit generated Compose settings.
- Evaluate Swarm after beta; do not equate Compose support with clustering.
- Add managed fallback pages and historical redeployment.
- Add Compose graph/template editing and external log drains.
- Add multi-artifact restore selection and restore into another environment.
- Add backup downloads and optional quiesced-volume backups.
- Test saved backup storage with a dedicated upload/read/delete probe.
- Evaluate R2 OAuth setup and additional database backup engines.
- Verify Raspberry Pi ARM64 installation, deployment, routing and recovery before advertising support.
- Add workspace-scoped cloud provisioning, starting with Hetzner.
- Improve server setup during project creation without losing drafts.
- Add reusable templates and deploy buttons.
