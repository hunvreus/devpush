---
description: Create scoped API keys and connect assistants through MCP.
---

# API keys and AI assistants

devpush provides a REST API and an MCP server for integrations and AI assistants. Both use your
installation's permissions; they do not grant access to another team or expose
saved environment-variable values. Logs have a separate permission because
application output can contain secrets.

## API keys

Open **Account → API keys → Create API key**. Choose a name, team, optional project,
access level, log permission and expiry.

- **Read only** inspects authorized resources.
- **Deploy** also queues deployment operations.
- **Manage** offers additional changes permitted by your team role.

Access never exceeds your current role or the role held when the key was issued.
Expiration options are 1, 7, 30, 90 or 180 days, 1 year and Never expires; the default
is 30 days. Each account can hold 100 active keys. History is paginated.

Copy the generated value once and store it in your integration's secret manager.
devpush stores a hash and cannot show the value again. Use a separate key per
integration. If the creation response is lost, create a replacement and revoke
the unusable key.

**Revoke** stops access immediately. **Rotate** displays a replacement once and
invalidates the old key immediately; there is no overlap period. The original
lifetime restarts, or remains unlimited for a permanent key. Expired keys cannot
be rotated. Leaving a team, account bans and inactive teams prevent access;
rejoining or unbanning does not revive old credentials.

## Use the REST API

Send an API key in the Bearer header to your installation's `/api/v1` endpoint:

```sh
curl "$DEVPUSH_URL/api/v1/projects?limit=25" \
  -H "Authorization: Bearer $DEVPUSH_API_KEY"
```

Set these shell variables through your own configuration/secret manager.
Browser login cookies and agent credentials do not authenticate management API
requests. Reads are paginated; writes require an `Idempotency-Key` so a retried
request cannot queue the action twice. Read the [API contract](/docs/api/) and
[operation reference](/docs/api-operations/) before automating changes.

## Connect an assistant

Open **Account → Connected apps** and copy the MCP URL by clicking it or its copy
icon. Add that URL to a client supporting remote HTTP MCP:

```text
https://YOUR-DEVPUSH-HOST/mcp
```

There are two authentication options:

| Option | How it works | Where to manage access |
| --- | --- | --- |
| Browser sign-in (OAuth) | The assistant opens devpush login and permission approval. No API key is needed. | Connected apps |
| API key | Configure `Authorization: Bearer YOUR-KEY` in a client that supports custom headers. The same scoped key works with REST and MCP. | API keys |

Check the callback host shown on the consent screen; app names are supplied by
their developers. For browser sign-in, choose the team, optional project, requested access level and
optional logs permission on the consent screen. Each connection receives its own
credentials, expires after 30 days and can be revoked independently. Accounts may
hold 100 active browser-authorized connections.

API-key use does not create a Connected apps entry. That table lists browser grants
with their status, app, resource scope, access and expiry. **Unavailable** means the
connection's current access cannot be validated. Expired and revoked connections
remain in history. The MCP URL stays available above the list for another connection.

## Compatibility and reachability

MCP exposes a subset of the public API, not account security or enrollment secrets.
See the MCP column in the [operation reference](/docs/api-operations/).

Both targets support OAuth dynamic client registration (DCR). Node additionally
supports OAuth client metadata discovery (CIMD); CIMD-only OAuth clients are not
supported on Workers. API-key
connections are available on both targets. Client support varies; use the client's
remote MCP instructions rather than assuming every assistant accepts custom headers.

A cloud-hosted assistant cannot reach your laptop's localhost URL. Local assistants
can use it directly. Installation operators can override the canonical endpoint
with `DEVPUSH_MCP_URL`; changing it requires OAuth clients to reconnect.
See [Configuration](/docs/configuration/) and [Local development](/docs/local-setup/).
