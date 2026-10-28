---
description: Manage account access, invitations and team roles.
---

# Accounts and teams

Accounts identify people. Teams own projects, servers and backup storage. Removing a person does not delete shared resources belonging to a surviving team.

## Account settings

Open **Account** from the user menu to change your profile, email, sign-in methods and notification preferences, or manage [API keys and connected apps](/docs/api/).

Changing your email requires approval from your current verified mailbox and verification of the new address. It must satisfy the installation allowlist. Failed email delivery leaves the address unchanged.

## Roles and invitations

| Role | Access |
| --- | --- |
| Member | Deploy and edit ordinary project settings; inspect servers and team settings. |
| Admin | Also manage team settings, servers, backup storage, backup policies/restores and eligible members; delete projects. |
| Owner | Also manage ownership and delete the team. |

Only owners/admins may change host deploy/rollback commands. Only owners manage other owners. A team must retain an active owner; transfer ownership before its last owner leaves.

Owners/admins invite people in **Team settings → Members**. Accept using the verified email that received the invitation. Use **Resend** after delivery failure; expired, revoked or declined invitations cannot grant access.

Your default team is created during onboarding. Switching teams does not change it, and normal team actions cannot leave or delete it.

## Installation administration

Installation administration is separate from team roles. Set `DEVPUSH_ADMIN_EMAIL`; otherwise the earliest-created account becomes administrator. Open **Admin** from the user menu to manage accounts and the signup allowlist.

An empty allowlist permits everyone. Adding a rule restricts sign-in/signup to matches; removing the final rule opens access again. Prefer exact emails or domain rules. Patterns are case-insensitive regular expressions matching the whole address. Keep a rule for your admin address: admin status does not bypass restrictions.


## Settings and deletion

Stale saves preserve your draft instead of overwriting another person's edits. Reload discards unsaved edits after confirmation.

Account deletion revokes sign-in, keys and connected apps. Transfer sole ownership of teams with other members first. Project/team deletion can queue runtime cleanup; external backup archives remain. See [deletion recovery](/docs/deletion-recovery/) for blocked cleanup.
