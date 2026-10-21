# devpush agent

The Go agent runs on Linux deployment servers. It owns Docker Compose, Traefik,
host monitoring, logs and backup execution, and connects outbound to the control
plane. The control plane does not execute Docker or SSH into servers.

From the repository root:

```sh
pnpm agent:build:linux
pnpm agent:test
```

- [Local development](../docs/local-setup.md): create and enroll a Lima VM.
- [Servers](../docs/servers.md): host requirements, networking and routing addresses.
- [Agent maintenance](../docs/agent-maintenance.md): upgrades, credential rotation, control-plane switching and recovery.
- [Agent protocol](../docs/agent-protocol.md): supported HTTP contracts and capabilities.
- [Architecture](../ARCHITECTURE.md): execution, persistence and authorization invariants.

Use the generated installer for enrollment. Keep host configuration and state as
credentials. Moving an agent to another control plane requires the maintenance
workflow; changing its URL alone does not migrate resource identities.


## Hub-issued certificates

The shared agent supports `ingress.certificates.v1`. A hub with a configured
certificate service advertises it in heartbeat responses; the default OSS hub does
not. The agent generates and retains its own ECDSA key/CSR, polls for the public
chain, validates it and acknowledges installation. DNS and ACME account credentials
are never sent to hosts. Renewal starts within 30 days of expiry, using one third of the lifetime for
shorter-lived certificates.

Certificate state lives in `ingress-certificates/` under the agent state directory,
with mode-0600 private files. Traefik receives a read-only mount and watches only
`dynamic/certificates.yaml`. Atomic YAML replacement loads new certificates without
a proxy restart. Existing custom-domain HTTPS retains its ACME resolver. Installing
this ingress configuration replaces an older managed Traefik container on the next
routed deployment; expect a brief ingress restart. See the
[agent protocol](../docs/agent-protocol.md) for the request and acknowledgement flow.
