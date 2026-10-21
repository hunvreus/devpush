---
description: Open your app with a generated address or connect a custom domain with HTTPS.
---

# Domains and HTTPS

A **route** chooses a Compose service and its internal HTTP port. A **domain**
chooses the hostname people use to reach that route. You need both for public access.

Application DNS points to the deployment server, not the devpush dashboard.
For example, `dashboard.example.com` can serve devpush while `shop.example.com`
points to a separate server running your shop.

## Generated addresses

devpush generates nip.io addresses from the project's name and the server's
routing IP, such as `shop-203-0-113-10.nip.io`. You do not create these DNS records.

- Public addresses use HTTPS; private and loopback addresses use HTTP.
- The environment address follows its successful deployments.
- Branch and deployment addresses are also generated. **Visit** on a deployment
  opens its deployment address.

An environment runs one current revision. An old deployment URL does not keep an
older app version running after you replace it. Generated names contain an IP;
changing the server's address does not automatically update all existing names.
See [Routing addresses](/docs/servers/#routing-addresses). Renaming a project does
not retroactively rename already saved generated hostnames.

Automatic addresses under an installation-owned domain, such as `shop.devpush.app`,
are not currently supported. Adding your own domain manually is supported.

## Add a custom domain

Enter a hostname only, without `https://`, a path or a port. Wildcard custom
domains such as `*.example.com` are not accepted.

First, deploy the environment successfully using its generated address.
Then:

1. Open **Project settings → Domains** and add the hostname, such as `shop.example.com`.
2. Select its environment, base route and whether to use HTTPS, then save.
3. At your DNS provider, add the A and/or AAAA records shown in devpush. They
   identify the server assigned to that environment.
4. Disable CDN/proxy mode while verifying. Wait for DNS to propagate, then choose
   **Verify** in devpush. Resolve any displayed error before continuing.
5. Deploy the environment again to apply the verified domain and current routes.
6. Open the hostname and check the application.

Only verified domains are included in new deployment routing. Verification checks
DNS against the assigned server; it does not update running containers, issue a
certificate immediately or prove that the application itself is healthy.

For a domain's **Base route**, choose all routes or a specific configured path.
[Project routes](/docs/compose-deployments/#public-route) determine the service,
port and optional path-prefix stripping.

## HTTPS

The agent's Traefik proxy obtains and renews certificates for HTTPS routes.
For a publicly reachable server, point DNS to it and allow inbound ports 80 and
443. The first HTTPS deployment may take longer while a certificate is issued.
Deployment readiness checks validate the public hostname's certificate.
These instructions use DNS-only records. If you enable a CDN/proxy later,
you must preserve the certificate challenge path and a working origin HTTPS
configuration; devpush does not configure that proxy for you.
Domains ending in `.app` require HTTPS in browsers; leave HTTPS enabled for them.
See [Google Registry's .app explanation](https://www.registry.google/domains/app/).

A DNS record alone does not expose a server behind a home router. Use suitable
port forwarding or a separately configured tunnel/VPN for application traffic.
The agent's outbound management connection does not carry browser traffic.

## Change or remove a domain

Saved hostnames are read-only. To change a name, add and verify the replacement,
deploy it, and check that it works before removing the old domain. Environment,
base route and HTTPS settings remain editable. Moving a domain to another
environment resets verification; repeat verification and deployment.

Routing changes take effect on a new deployment. Deleting a project while keeping
its running containers also retains their hostname reservations; those names cannot
be claimed by a new project while the retained runtime remains managed as such.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| DNS lookup fails | The hostname spelling, records at your DNS provider and propagation. |
| Verification reports a wrong IP | Use the records shown for the environment's assigned server, including any server override. Disable proxy mode. |
| Domain verifies but does not serve the app | Deploy again after verification; check that the selected base route exists. |
| Connection times out | Server firewall, ports 80/443 and router/NAT rules. |
| Certificate is not ready | DNS and public reachability, then certificate-related messages in deployment logs. |
| Generated local URL fails | The VM's current routing IP and whether your DNS resolver blocks private nip.io answers. |
| App returns an error | Its internal HTTP port, listening address, health check and runtime logs. |
