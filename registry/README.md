This folder ships a default registry catalog with /dev/push so installs can run without
network access to the remote registry.

What this is:

- `catalog.json`: a bundled catalog snapshot (runners + presets + metadata).
- `overrides.json`: a default overrides file (enables common runners/presets).

What happens on an instance:

- The installer copies these files into `DATA_DIR/registry/` if the target files
  do not already exist.
- The app reads `DATA_DIR/registry/catalog.json` + `DATA_DIR/registry/overrides.json`
  and computes a resolved catalog (overrides win).

Notes:

- Do not edit `catalog.json` directly on the server. Update it via the sync flow.
- Edit `overrides.json` to enable/disable entries or override specific fields.
- `catalog.json` `meta.source` is `bundled` for the copy shipped with /dev/push and
  `registry` for catalogs fetched from the registry.
- Catalog format: see the registry repository README:
  https://github.com/devpushhq/registry/blob/main/README.md
