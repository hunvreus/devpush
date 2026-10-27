---
description: Extend workspace access with generic, server-enforced mutation policies.
---

# Workspace permissions

Workspace mutations pass two independent checks: core authorization (identity,
role, resource ownership and API scope), followed by installed plugin policies.
A plugin can restrict an authorized action; it cannot grant core permissions.
The unextended application applies core authorization without additional product
restrictions. Reads remain governed by their normal access checks.

## Policy contract

Plugin API v3 uses a typed `WorkspaceOperation` registry and an explicit actor:
`{ kind: 'user', userId }` or `{ kind: 'system', source }`. System sources identify
agent claims, GitHub pushes, scheduled backups and maintenance. They do not bypass
policy. Credential callers also supply the actor’s optional `roleCeiling`; a policy
can require authority that a narrower credential does not carry. Build the application and plugins together when changing this contract.
There is no database migration or agent protocol change.

`workspaceAccess.run(input, action)` wraps the authorized effect. It must either
reject before invoking `action`, or invoke it exactly once and return its result.
Policies compose in configuration order. Provider failures are ordinary errors;
intentional refusals use `WorkspacePolicyError`. Only deliberate refusals can
supply bounded public text and a local recovery URL. Ordinary exception messages
are never copied into public responses.

Operations cover workspace settings, membership, project creation/configuration,
environments, variables, domains, server management/enrollment, credentials,
backup settings, deployment/backup/restore admission and productive job claims.
Cleanup operations such as deleting a project or disabling a server have distinct
operation names, allowing a plugin to preserve them while denying productive work.
Account operations, installation administration, credential revocation, invitation
decline and agent observation/completion keep their independent authorization.
Workspace creation and account bootstrap are also separate from using a workspace.

## Enforcement boundaries

Browser actions use the same domain services as other callers. Settings gates run
before avatar uploads or provider work. Deployment preparation receives an opaque
callback-scoped admission, so shared enqueue can verify its team/operation without
calling the policy twice. Forged, cross-workspace or completed admissions are rejected. REST/MCP mutation definitions must declare
an operation and whether its canonical boundary is the dispatcher or a domain
service. Idempotent replays return the previously admitted response, without
executing another effect. Live SQL authorization, scope and settings-version guards
remain in the write batch after provider reads.

Shared deployment and backup queues enforce admission for browser, API, webhook
and scheduled callers. A denied GitHub push records a failed attempt independently
for each project. A denied backup schedule skips that workspace without blocking
other due schedules. New deployment, backup and restore claims consult policy
again, so a policy change can hold queued work. Existing work can finish; progress,
logs, completion, retention cleanup and certificate maintenance are not gated as
new productive work. A policy denial leaves queued work available for a later
permitted claim and does not send repository or backup credentials to the agent.

Coverage tests inventory browser mutations and writable HTTP transports. Each
browser mutation is classified as a workspace operation or an explicit account,
admin, creation, security or read exception, and operation entries must reach the
declared gate through their domain calls. New actions/routes require classification.
These tests supplement behavioral denial, SQL race and permission tests; they are
not a substitute for keeping new effects inside the canonical gate.

## Policy recovery

`WORKSPACE_RESTRICTED` means the policy currently denies the action;
`WORKSPACE_LIMIT_REACHED` means an allowance would be exceeded. A deliberate policy
can attach public explanation and a relative recovery URL. Browser forms retain
these explanations, error toasts offer a recovery action when available, and API
responses expose the same stable code and optional policy details. `RESOURCE_BUSY`
means a concurrent change must finish before retrying.
