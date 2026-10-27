import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
function validate(directory, overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      "scripts/validate-config.mjs",
      "--remote",
      "--env",
      join(directory, "absent.env"),
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        BETTER_AUTH_SECRET: "auth-test-secret-012345678901234567890123456789",
        DEVPUSH_SECRET_ENCRYPTION_KEY:
          "encryption-test-secret-012345678901234567890123456789",
        DEVPUSH_BASE_URL: "https://hub.example.com",
        GITHUB_APP_ID: "123",
        GITHUB_APP_NAME: "test-app",
        GITHUB_APP_PRIVATE_KEY: privateKey,
        GITHUB_APP_WEBHOOK_SECRET: "test-webhook-secret",
        EMAIL_FROM: "test@example.com",
        RESEND_API_KEY: "test-placeholder",
        ...overrides,
      },
    },
  );
}

test("remote validation accepts release downloads and checks explicit offline binaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "devpush-config-"));
  try {
    const release = validate(directory);
    assert.equal(release.status, 0, release.stderr);
    const missing = validate(directory, {
      DEVPUSH_AGENT_BINARY_DIR: directory,
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /entry is not readable/);
    for (const architecture of ["amd64", "arm64"]) {
      writeFileSync(
        join(directory, `devpush-agent-linux-${architecture}`),
        "offline-test-binary",
      );
    }
    const offline = validate(directory, {
      DEVPUSH_AGENT_BINARY_DIR: directory,
    });
    assert.equal(offline.status, 0, offline.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
