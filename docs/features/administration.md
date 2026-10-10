# Administration

devpush separates installation administration from team roles.

Set `DEVPUSH_ADMIN_EMAIL` to the email address that may access installation
settings, manage the global allowlist, and ban, unban, or delete users. Email
matching is case-insensitive. If the variable is unset, the earliest-created
user is the installation administrator. Set the variable explicitly in
production so the role does not depend on database history.

Installation-admin checks run in both server functions and underlying services.
The Admin link lives in the user menu. The Help modal shows the installed app
version and resource links. The Admin navigation is hidden from other users, and direct access redirects to
the normal application.

Allowlist rules support exact emails, domains, and regular-expression patterns.
Patterns are anchored to the full normalized email address, limited to 255
characters, and rejected when they are unsafe to evaluate. Existing unsafe
patterns are ignored during authentication.

Team roles are independent of installation administration. Team owners and team
admins manage team settings and servers. Team members may inspect those
resources but cannot mutate or enroll servers.

## Team invitation forms

Team names are required and limited to 100 characters. Invitation forms validate
all email addresses before submitting; bulk input accepts commas, spaces, or
new lines and deduplicates addresses without regard to case. Pending creation
and invitation requests prevent edits, duplicate submission, and dismissal.

Bulk invitations continue if an address is already a member or has a pending
invitation. The result distinguishes invitations created, email messages sent,
and addresses that failed. Failed addresses remain in the form for correction
or retry. An invitation whose email failed still exists; use its resend action
in the invitation list rather than creating it again.

Team role changes, ownership transfers, member removals, invitation revocation,
and team deletion require confirmation. Pending requests cannot be dismissed;
failed requests keep the dialog open for retry. Member removal requires the
member’s exact email address, and team deletion requires the team slug.
