---
description: Choose email categories and mute individual teams or projects.
---

# Email notifications

In **Account → Email preferences**, choose deployment, backup/restore, domain and server alerts. Choose **Save** to apply changes or **Cancel** to discard them.

## Who receives alerts

| Category | Default recipients |
| --- | --- |
| Deployment failures | Team owners/admins and the identified initiating member. |
| Backup/restore failures | Team owners/admins. |
| Domain verification failures | Team owners/admins. |
| Disconnection or low disk space | Team owners/admins. |

Categories start enabled for eligible recipients; enabling one does not subscribe every member. GitHub attribution uses a linked provider identity with current membership, never a commit email address. Recovery notices go only to recipients of the failure notice.

Authentication and essential account emails are separate from these preferences.

## Mute a team or project

Use **Team settings → Notifications** or a project’s **Settings → Notifications** to mute that scope for yourself. The switch saves immediately and reverts if saving fails.

A team mute includes all its projects. A project mute leaves team-wide server alerts enabled. Mutes override your account's category settings and affect only you.

## Timing and delivery

Repeated failures in one incident do not repeatedly email the same recipient. Server alerts wait five minutes without contact. Disk alerts start at 90% usage and recover below 85%. A failure resolved before delivery is discarded.

Server and disk alerts, including recovery, are checked by the minute scheduler rather than on every heartbeat. Large installations are scanned in batches.

Email delivery requires [operator configuration](/docs/configuration/#authentication). Messages are retried after temporary failures, with membership and preferences rechecked before sending. Address changes discard pending messages to the old mailbox. Resend acceptance is tracked; downstream bounces are not.
