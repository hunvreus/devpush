# TODO

## Near-term

- Complete clean remote VPS validation by running `pnpm validate:remote:proof`
  with public HTTPS control-plane config, a valid GitHub App private key, server
  install, GitHub-backed Compose deploy, public route smoke, and the generated
  `.tmp/remote-mvp-validation-<timestamp>.md` summary artifact.

## Later

- Backups: implement agent artifact upload execution, agent retention object
  deletion execution, and restore execution from the documented backup model.
- Compose graph visualization.
- Raw Compose template editor.
- Hosted wildcard domain management.
- Notification rules.
- Billing.
