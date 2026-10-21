---
description: Manage your account, team membership, invitations and shared settings.
---

# Accounts and teams

Your account is your sign-in identity. Teams own projects, servers and backup
storage. Leaving a team or deleting a member's account does not delete settings
that belong to a surviving team or project.

## Sign-in and profile

Open **Account** from the user menu to update your name, username, avatar or email,
manage sign-in providers, create API keys and revoke connected apps.

Changing your email requires approval from your current verified mailbox and
verification of the new address. The new address must satisfy the installation's
signup allowlist when verification completes. Failed verification-email delivery
leaves your account email unchanged.

See [API keys and connected apps](/docs/api-and-mcp/) for integration access.
Installation administration is separate from team membership; see
[Administration](/docs/administration/).

## Team roles

| Role | Access |
| --- | --- |
| Member | Use projects and manage ordinary project settings and deployments; inspect servers and team settings. |
| Admin | Also delete projects and manage team settings, servers, backup storage and members, subject to ownership restrictions. |
| Owner | Manage ownership and delete the team, in addition to administrator access. |

Deploy and rollback commands execute on the host with Docker access, so only
owners and admins may change them. Repository code is trusted on its target
server; roles do not provide isolation between hostile applications.

A team must retain an active owner. Transfer ownership before the last owner
leaves or deletes their account. Your account's default team is created during account setup and serves as its
home team, distinct from the team currently selected in navigation. It cannot
be left or deleted through normal team actions. Switching teams does not change
that designation.

## Invitations

Owners and admins can invite multiple email addresses from team settings. Existing
members, duplicates and pending invitations are skipped. If an invitation exists
but its email failed, use **Resend** on that invitation.

Open an invitation from Notifications or its email link. Sign in with the verified
email address it was sent to, then choose **Accept invitation** or **Decline
invitation**. Declining invalidates the invitation link; the team can invite you
again. Dismissing the dialog leaves the invitation pending.

Team managers can revoke pending invitations. Expired, revoked and declined
invitations cannot grant membership.

## Manage members and ownership

Open **Team settings → Members**. Owners and admins can change eligible members'
roles using the role selector or choose **Remove member** and confirm. Admins
cannot manage owners; only an owner can grant or remove ownership. The last
active owner cannot be removed or demoted.

To hand over a team, an owner chooses **Transfer ownership** beside an eligible
member and confirms. Review the recipient carefully before transferring. Transfer
ownership before leaving when other members would otherwise have no active owner.

## Concurrent settings changes

Settings forms reject a stale save rather than overwrite another person's changes.
Your draft stays visible and a persistent notification says **Your changes weren’t
saved.** Choose **Dismiss** to keep editing, or **Reload** to load current settings.
Reload requires confirmation because it discards all unsaved edits on the page.
Copy any changes you want to keep before reloading.

Project settings sections share a save version: an environment edit can conflict
with an open Build & deploy form, even if a different field changed. Accounts,
teams, servers, backup policies and storage connections are checked separately.
Background status updates do not invalidate a settings draft. There is no automatic merge or
force-overwrite action.

## Deletion

Account deletion immediately ends sign-in access and revokes keys and connected
apps. Background cleanup removes memberships and eligible teams where you were
the only member. Teams with other members need another active owner first.

Project and team deletion cancel affected work and can queue container cleanup.
Volume cleanup has a seven-day delay. Containers deliberately retained during
project deletion continue using their existing routes. External backup archives
are not automatically erased when their project or server is deleted.

See [Production operations](/docs/production-operations/) for control-plane backups
and [Architecture](https://github.com/hunvreus/devpush/blob/main/ARCHITECTURE.md#deletion-and-retention) for retained records.
