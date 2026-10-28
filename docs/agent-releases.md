---
description: Build, verify and distribute the agent through pinned GitHub Release assets.
---

# Agent releases

The app package does not contain agent executables. Its `agent-release.json` pin records:

- The agent version, Go compiler, protocol and capabilities.
- The URL, size and SHA-256 hash of the Linux amd64 and arm64 binaries.

`devpush-agent version --json` reports a running agent's version, protocol, capabilities and platform.

Published binaries, checksums and the app package are attached to the matching [GitHub Release](https://github.com/hunvreus/devpush/releases/tag/v1.0.0-beta.3).

## Download behavior

Installers and update timers call the dashboard's download endpoint. The endpoint redirects to the pinned GitHub Release asset, and the installer verifies the pinned checksum. Object storage is not involved. If the pinned release is unavailable, installation readiness fails.

On Node, `DEVPUSH_AGENT_BINARY_DIR` overrides release downloads with trusted custom or offline builds. Both Linux architectures must be present. Checksums are calculated from the local files, and these files are not treated as official releases. Docker sets this directory to `/repo/bin` and serves the binaries built into the image. Workers always use the release.

## Prepare a release

Set the application version in `app/package.json`. Use the compiler pinned in `agent/go.mod` and `app/agent-release.json`:

```sh
pnpm agent:release:prepare
pnpm agent:release:verify
pnpm agent:test
```

Preparation does the following:

- Builds both Linux binaries with CGO and VCS/build-path stamping disabled.
- Reads protocol and capability metadata from the real agent CLI.
- Writes the pin, `bin/agent-release.json` and `bin/SHA256SUMS`.

Verification requires matching artifacts for both architectures. The Docker agent builder uses the same compiler. Commit the source changes and the generated pin together.

## Publish

Pushing a `v{version}` tag runs the release workflow. The workflow:

1. Builds with the pinned compiler.
2. Runs both binaries, using QEMU for ARM64, and checks their metadata and hashes.
3. Runs the app and agent checks.
4. Attaches the binaries, manifest, checksums and app package tarball to a GitHub Release.
5. Downloads the public agent assets and verifies their published checksums.

Tags with a prerelease suffix (for example, `v1.0.0-beta.3`) produce prereleases and do not replace the latest stable release.

The workflow rejects mismatched tags or pins and never overwrites an existing release. It does not publish to npm or deploy the dashboard.

If an installation has no local binaries, publish the release before you enroll servers. Don't rename the manifest URLs unless you rebuild the release artifacts.
