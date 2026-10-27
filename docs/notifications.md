---
description: Choose operational emails and mute workspaces or projects.
---

# Email notifications

Configure `EMAIL_FROM` and `RESEND_API_KEY` to deliver email through Resend. Operational emails use the same branded layout as sign-in and invitation emails. Without email configuration, deployment and agent operations continue normally.

## Preferences and recipients

Account → Email preferences controls your optional categories. Changes apply after Save; Cancel restores the saved values.

| Category | Events | Default recipients |
| --- | --- | --- |
| Deployment alerts | Failed deployment; recovery after failure | Workspace owners/admins and the identified initiating member |
| Backup and restore alerts | Failed backup or restore; recovery after a backup failure | Workspace owners/admins |
| Domain and certificate alerts | Failed domain verification or HTTPS configuration; recovery | Workspace owners/admins |
| Server alerts | Disconnection, low disk space and recovery | Workspace owners/admins |

All four categories are enabled by default for eligible recipients. Enabling a category does not grant access or subscribe every member to every resource. Manual deployment attribution uses the authenticated initiator. GitHub push attribution uses the webhook sender's numeric provider identity, matched to exactly one linked account with current workspace membership. Commit author names and email addresses are never used to identify recipients.

Authentication and essential account emails remain separate from optional operational preferences.

## Personal mutes

In workspace or project Settings → My notifications, use the mute switch to stop email notifications for that scope. The switch saves immediately; a failed save restores its previous value. This affects only you. A workspace mute includes every project in the workspace. A project mute does not silence workspace-wide server alerts. A mute takes precedence over enabled account categories.

## Timing and delivery

The agent reports job completion directly to the control plane. Completion, domain verification and heartbeat handlers start background notification delivery after saving their results, without delaying the response. A minute-based background pass also scans persisted resource state in bounded batches, repairing interruptions and retrying queued email delivery. Large installations rotate through resources rather than scanning them all in one request.

Server disconnection emails require at least five minutes without contact. Disk alerts start at 90% usage and recover below 85%, avoiding repeated alerts around one threshold. Repeated failures within the same incident do not resend to prior recipients; a newly identified deployment initiator can still be notified. Recovery emails go only to recipients whose failure email was delivered. A failure resolved before delivery is discarded.

Delivery rechecks account status, membership, resource availability, category preferences and mutes. A removed member cannot receive operational emails queued before removal. Retries retain the original recipient address and content; an address change discards the pending email rather than sending it to a different mailbox.

The database outbox tracks delivery, attempts, retry time and terminal failure. Retries use stable provider idempotency keys, increasing delays up to one hour, and stop after ten attempts or 24 hours. Logs identify pending delivery and terminal failures by notification ID, without logging recipients or message contents. There is no delivery-management screen. Failures and domains last changed more than 24 hours ago are not announced as new incidents on rollout.

Provider requests time out after ten seconds. Server diagnostics include HTTP status and sanitized source frames, without provider bodies or message content.

Resend acceptance is recorded as delivery; downstream bounces are not currently tracked by the app.

Maintenance removes old incident history after 30 days; current incident delivery records remain available to determine recovery recipients.

Operational outbox messages persist their sender, recipient and rendered content.
The 24-hour provider retry window begins at the first delivery attempt, so queued
but unsent messages do not expire early. Apply migration
`0002_notification_delivery_window.sql`; ambiguous legacy attempts are retained
for operator review rather than resent with reconstructed content.
