# Administration

devpush separates installation administration from team roles.

Set `DEVPUSH_ADMIN_EMAIL` to the email address that may access installation
settings, manage the global allowlist, and ban, unban, or delete users. Email
matching is case-insensitive. If the variable is unset, the earliest-created
user is the installation administrator. Set the variable explicitly in
production so the role does not depend on database history.

Installation-admin checks run in both server functions and underlying services.
The Admin navigation is hidden from other users, and direct access redirects to
the normal application.

Allowlist rules support exact emails, domains, and regular-expression patterns.
Patterns are anchored to the full normalized email address, limited to 255
characters, and rejected when they are unsafe to evaluate. Existing unsafe
patterns are ignored during authentication.

Team roles are independent of installation administration. Team owners and team
admins manage team settings and servers. Team members may inspect those
resources but cannot mutate or enroll servers.
