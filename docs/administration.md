---
description: Control installation access and manage user accounts.
---

# Administration

Installation administrators control who can use this devpush installation.
Team roles control access to an individual team's resources. These are separate
permission boundaries.

Set `DEVPUSH_ADMIN_EMAIL` explicitly in production. Matching is case-insensitive.
If unset, the earliest-created account is the installation administrator. The
administrator opens **Admin** from the user menu.

## Signup allowlist

In **Admin → Allowlist**, add rules for the people who may use this installation.
Search by email, domain or rule type to find existing rules. An empty search
result does not mean the allowlist itself is empty.

An empty allowlist permits everyone. Once at least one rule exists, only matching
email addresses can sign in or sign up. Rules can match an exact email address,
a domain or a pattern. Removing the last rule opens access again.

Prefer exact email or domain rules. A pattern is a case-insensitive regular
expression matching the **whole** email address, not a shell wildcard. For
example, `[^@]+@acme\.com` matches addresses at `acme.com`; a domain rule
`acme.com` is simpler for that case. Invalid or excessively complex expressions
are rejected.

`DEVPUSH_ADMIN_EMAIL` selects an administrator; it does not bypass the allowlist.
Keep an explicit matching rule for your own admin address before restricting access.

The server rejects a nonmatching email with “This email address is not allowed to
sign in.” Keep any public access notice aligned with these rules; a notice does
not enforce the policy.

## Sign-in message

Set the optional `DEVPUSH_SIGN_IN_MESSAGE` environment variable to display a
public notice below the login heading, for example:

```dotenv
DEVPUSH_SIGN_IN_MESSAGE="Acme’s deployment platform. Sign in with your @acme.com work email."
```

The message appears in an informational alert. Use plain text, up to 1,000
characters; explicit HTTP/HTTPS links are clickable. HTML and Markdown are not
interpreted. An unset, empty or whitespace-only value hides the notice. Changing
it requires restarting the Node app or redeploying the Worker. It explains access;
configure the allowlist separately to restrict sign-in. There is no message editor
in Admin and no database setting for the notice.

For the bundled Docker Compose deployment, set it in `deploy/.env.production`,
then recreate the app container with the normal Compose command. Custom container
deployments must also pass the variable into the app container.

For an upgrade from an older message stored in the database, follow the
[upgrade notes](/docs/production-operations/#deploy-and-upgrade) before migrating.

## Accounts

The Users section searches names, usernames, email addresses and account status,
with 25 accounts per page. Administrators can ban, unban or delete accounts.
Deleting an account removes its sessions and linked sign-in accounts immediately
and queues remaining cleanup. A ban or deletion does not delete shared resources
created by that user in a surviving team.

A user who is the only active owner of a team with other members must transfer
ownership before deletion. Teams where the user was the only member are cleaned
up asynchronously. Unbanning does not restore a deleted account.

For team invitations, ownership and account settings, see
[Accounts and teams](/docs/accounts-and-teams/).
