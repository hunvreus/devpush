---
description: Build, verify and distribute the shared agent through pinned GitHub Release assets.
---

# Agent releases

OSS and hosted use the same Go agent. The npm application package contains
`agent-release.json`, not executable files. This pin records the version, Go
compiler, protocol, capabilities and Linux amd64/arm64 URLs, sizes and SHA-256
hashes. `devpush-agent version --json` reports the running agent’s version, protocol,
capabilities and platform.

## Download behavior

Installers and updater timers request the hub's download endpoint, which redirects
to the pinned GitHub Release asset. The installer verifies the bundled SHA-256
checksum. Object storage is not involved in agent distribution.

`DEVPUSH_AGENT_BINARY_DIR` explicitly overrides release downloads on Node. Use it
for trusted custom builds or offline installations. Both Linux architectures must
be present. Local checksums are calculated from those files; unpinned overrides
are not mirrored as official release assets. Docker always sets this directory
to `/repo/bin` and serves the agents built into the image, including offline use.

A manifest does not publish its assets. If the referenced release is unavailable,
installation readiness fails until it is published or overridden with a
local directory. Older unversioned object-storage keys are no longer read.

## Prepare a release

With the desired application version in `app/package.json`, use the exact Go
compiler pinned by `agent/go.mod` and `app/agent-release.json`:

```sh
pnpm agent:release:prepare
pnpm agent:release:verify
pnpm agent:test
```

Preparation builds both Linux executables, obtains protocol/capability metadata
from the real agent CLI and writes the pin, `bin/agent-release.json` and
`bin/SHA256SUMS`. Builds disable CGO and VCS/build-path stamping. The Go module/workspace and Docker
agent builder must use the same pinned compiler. Release verification requires matching artifacts for both architectures. Commit the source changes and generated pin
together.

The tag workflow for `v{version}` uses the pinned compiler, executes AMD64 and
ARM64 binaries (using QEMU for ARM64), checks their metadata and hashes, runs app
and agent checks, and attaches both binaries, the manifest, checksums and app
package tarball to GitHub Releases. It refuses mismatched tags or pins and does
not overwrite an existing release. It neither publishes to npm nor deploys a hub.

Agent download endpoints redirect to the pinned GitHub Release; R2 is not used
for agent distribution. Installers verify the pinned checksum. Trusted offline
Node installations may continue using `DEVPUSH_AGENT_BINARY_DIR`.
