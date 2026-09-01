import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCloudflareConfig,
  getCloudflareWorkersSubdomain,
  readCloudflareConfig,
  readEnv,
  readJsonConfig,
  upsertEnv,
  validatePostgresUrl,
  validateUrl,
} from "./setup-config.mjs";

test("creates a deployment-specific Cloudflare config", () => {
  const config = JSON.parse(
    createCloudflareConfig({
      accountId: "account-123",
      bucketName: "devpush-assets",
      customDomain: "devpush.example.com",
      hyperdriveId: "abc123",
      template: {
        compatibility_date: "2026-08-29",
        main: "src/server.ts",
      },
      vars: { DEVPUSH_BASE_URL: "https://devpush.example.com" },
      workerName: "devpush-production",
    }),
  );

  assert.equal(config.name, "devpush-production");
  assert.equal(config.account_id, "account-123");
  assert.equal(config.main, "src/server.ts");
  assert.equal(config.compatibility_date, "2026-08-29");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [
    { pattern: "devpush.example.com", custom_domain: true },
  ]);
  assert.deepEqual(config.hyperdrive, [
    { binding: "DEVPUSH_DATABASE", id: "abc123" },
  ]);
  assert.deepEqual(config.r2_buckets, [
    { binding: "DEVPUSH_OBJECTS", bucket_name: "devpush-assets" },
  ]);
  assert.deepEqual(config.vars, {
    DEVPUSH_BASE_URL: "https://devpush.example.com",
  });
  assert.equal(JSON.stringify(config).includes("DATABASE_URL"), false);
});

test("reads deployment resources from a generated Cloudflare config", () => {
  const directory = mkdtempSync(join(tmpdir(), "devpush-setup-"));
  const path = join(directory, "wrangler.jsonc");
  writeFileSync(
    path,
    createCloudflareConfig({
      accountId: "account-123",
      bucketName: "devpush-assets",
      hyperdriveId: "abc123",
      workersDev: true,
      vars: {
        BETTER_AUTH_URL: "https://auth.example.com",
        DEVPUSH_ADMIN_EMAIL: "admin@example.com",
        DEVPUSH_BASE_URL: "https://devpush.example.com",
      },
      workerName: "devpush-production",
    }),
  );

  assert.deepEqual(readCloudflareConfig(path), {
    accountId: "account-123",
    bucketName: "devpush-assets",
    customDomain: "",
    hyperdriveId: "abc123",
    vars: {
      BETTER_AUTH_URL: "https://auth.example.com",
      DEVPUSH_ADMIN_EMAIL: "admin@example.com",
      DEVPUSH_BASE_URL: "https://devpush.example.com",
    },
    workerName: "devpush-production",
    workersDev: true,
  });
  assert.equal(readJsonConfig(path).name, "devpush-production");
});

test("discovers the workers.dev account subdomain", async () => {
  const requests = [];
  const subdomain = await getCloudflareWorkersSubdomain({
    accountId: "account-123",
    apiToken: "secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          result: { subdomain: "example-account" },
          success: true,
        }),
      };
    },
  });

  assert.equal(subdomain, "example-account");
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account-123/workers/subdomain",
  );
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer secret-token",
  );
});

test("explains when the Cloudflare account has no workers.dev subdomain", async () => {
  await assert.rejects(
    getCloudflareWorkersSubdomain({
      accountId: "account-123",
      apiToken: "secret-token",
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({
          errors: [{ code: 10007, message: "Subdomain not found" }],
          success: false,
        }),
      }),
    }),
    /has no workers\.dev subdomain/u,
  );
});

test("reads comments and trailing commas from a JSONC template", () => {
  const directory = mkdtempSync(join(tmpdir(), "devpush-setup-"));
  const path = join(directory, "wrangler.template.jsonc");
  writeFileSync(
    path,
    `{
      // Shared Worker defaults.
      "name": "devpush",
      "observability": {
        "enabled": true,
      },
    }`,
  );

  assert.deepEqual(readJsonConfig(path), {
    name: "devpush",
    observability: { enabled: true },
  });
});

test("upserts env values without discarding unrelated configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "devpush-setup-"));
  const path = join(directory, ".env");
  upsertEnv(path, { EXISTING: "first", MULTILINE: "line one\nline two" });
  upsertEnv(path, { EXISTING: "second", NEW_VALUE: "hello world" });

  assert.deepEqual(readEnv(path), {
    EXISTING: "second",
    MULTILINE: "line one\nline two",
    NEW_VALUE: "hello world",
  });
  assert.equal(readFileSync(path, "utf8").match(/^EXISTING=/gmu)?.length, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), [".env"]);
});

test("validates control-plane and PostgreSQL URLs", () => {
  assert.equal(validateUrl("https://devpush.example.com"), undefined);
  assert.equal(
    validateUrl("ftp://example.com"),
    "Use an http:// or https:// URL.",
  );
  assert.equal(
    validateUrl("https://example.com/path"),
    "Use an origin without a path, query, or fragment.",
  );
  assert.equal(
    validatePostgresUrl("postgresql://db.example.com/devpush"),
    undefined,
  );
  assert.equal(
    validatePostgresUrl("https://db.example.com"),
    "Use a postgres:// or postgresql:// URL.",
  );
});
