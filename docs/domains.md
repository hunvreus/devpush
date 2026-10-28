---
description: Connect generated addresses or custom domains with automatic HTTPS.
---

# Domains and HTTPS

A route selects a service and port; a domain selects its hostname. Application DNS points to the deployment server, **not** the dashboard.

## Generated addresses

devpush generates nip.io addresses using the server's routing IP, such as `shop-203-0-113-10.nip.io`. Public IPs use HTTPS; private/local IPs use HTTP. No DNS setup is needed.

Environment and branch aliases follow successful deployments. Each environment runs one current revision: an old deployment URL does not preserve an older running app.

Inactive deployment URLs redirect to the dashboard, where signed-in workspace members can inspect the deployment and request a redeploy. Redeploying requires the usual permissions and confirmation. Only known deployment hostnames redirect; custom domains, unknown hosts and application-generated 404s are unaffected. The original path and query are discarded.

To disable redirects on a server, set `DEVPUSH_DISABLE_INACTIVE_REDIRECTS=true` in its agent configuration and restart the agent. Redirects expose the dashboard's public hostname. History is limited to the latest 1,000 recorded deployments per server; older URLs return a local 404. HTTPS still needs a valid certificate before any redirect can occur; retired hostnames do not request new certificates.

This feature needs an updated dashboard and agent. Registration restores recent successful deployment hostnames; future deployments record their own fallback routes. **Visit** is disabled for revisions that the dashboard knows have been replaced.

Renaming a project or changing a server IP does not rewrite saved hostnames. Use a custom domain for a stable address. Installation-owned wildcard domains are not available in the default installation, which uses nip.io.

## Add a domain

1. Deploy successfully using the generated address.
2. In **Settings → Domains**, add a hostname such as `shop.example.com`, its environment, base route and HTTPS setting.
3. Create the displayed A/AAAA records at your DNS provider. Use DNS-only records while verifying.
4. Wait for propagation, then choose **Verify**.
5. Deploy again to apply the verified domain, then open it.

Enter a hostname without a scheme, path or port. Wildcards are not accepted. DNS verification does not update a running deployment or immediately issue its certificate.

Traefik obtains and renews HTTPS certificates. DNS must resolve to the server and inbound ports 80/443 must be reachable. NAT needs port forwarding; the agent's outbound connection carries management traffic, not visitors.

## Changes and troubleshooting

Moving a domain to another environment requires verification and deployment again. To rename it, add and test the replacement before removing the old name. Routing changes require a deployment.

| Problem | Check |
| --- | --- |
| Wrong IP during verification | Assigned server's displayed records; disable DNS proxying. |
| Verified but app unavailable | Deploy again; check route service, port and listening address. |
| Timeout or certificate failure | DNS, server firewall, ports 80/443 and deployment logs. |
| Private nip.io address fails | VM IP and whether your resolver blocks private DNS answers. |

If you later enable a CDN proxy, preserve its origin HTTPS and certificate challenge path. `.app` domains require HTTPS in browsers.
