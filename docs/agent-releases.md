---
description: Build, verify and distribute the agent through pinned GitHub Release assets.
---

# Agent releases

The app package does not contain agent executables. Its `agent-release.json` pin records:

- The agent version, Go compiler, protocol and capabilities.
- The URL, size and SHA-256 hash of the Linux amd64 and arm64 binaries.

`devpush-agent version --json` reports a running agent's version, protocol, capabilities and platform.

Agent binaries and checksums belong to the release recorded in the pin. App-only releases reuse that agent release; their [GitHub Release](https://github.com/hunvreus/devpush/releases) contains the app package.

## Download behavior

Installers and update timers call the dashboard's download endpoint. The endpoint redirects to the pinned GitHub Release asset, and the installer verifies the pinned checksum. Object storage is not involved. If the pinned release is unavailable, installation readiness fails.

On Node, `DEVPUSH_AGENT_BINARY_DIR` overrides release downloads with trusted custom or offline builds. Both Linux architectures must be present. Checksums are calculated from the local files, and these files are not treated as official releases. Docker sets this directory to `/repo/bin` and serves the binaries built into the image. Workers always use the release.

## Prepare a release

Set the app version in `app/package.json` and update the changelog. For app-only
changes, leave `app/agent-release.json` unchanged.

If agent source or build inputs changed, use the compiler pinned in `agent/go.mod`
and regenerate the agent pin:

```sh
pnpm agent:release:prepare
pnpm agent:release:verify
pnpm agent:test
```

Preparation builds both Linux binaries, reads their protocol/capabilities and
writes the pin and checksums. Commit agent changes and the generated pin together.
The release workflow rejects changed agent source with an old pin.

## Publish

Push the release commit to `main`, then a matching `v{version}` tag. GitHub Actions:

1. Waits for successful CI on that exact commit and reuses the package CI tested.
2. Builds and verifies agent binaries only when the release introduces a new agent pin; otherwise verifies the existing pinned downloads.
3. Creates the GitHub Release and publishes the tested package to npm using OIDC.

CI runs unit and database suites in parallel. Documentation-only commits run
documentation checks; agent and image checks run when their inputs change. Publication does not repeat the full CI suite. Run focused
checks locally; CI owns the complete release gate.

Prereleases use npm's `beta` tag and do not replace the latest stable GitHub
release. Stable releases use `latest`. No manual `npm publish` is needed.

The workflow never overwrites a release. To retry npm publication after a partial failure, run **Release** manually with its existing tag.
Retries verify that npm serves the exact tested archive before continuing.

Consumer applications update their package pin and deploy separately. Publishing
a core release does not deploy a consumer.

Publish the pinned agent assets before enrolling servers. Installers verify their
checksums; changing manifest URLs without rebuilding is unsupported.
