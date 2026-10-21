import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  rm,
  readdir,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(new URL("../app/package.json", import.meta.url));
const { parse } = require("yaml");
const root = new URL("../", import.meta.url);

const compose = parse(
  await readFile(new URL("deploy/compose.production.yml", root), "utf8"),
);
const production = parseEnv(
  await readFile(new URL("deploy/.env.production.example", root), "utf8"),
);
const local = parseEnv(
  await readFile(new URL("app/.env.example", root), "utf8"),
);

test("production Compose forwards documented app configuration, with explicit image/build exceptions", () => {
  const imageOrBuild = new Set([
    "DEVPUSH_AGENT_BINARY_DIR",
    "VITE_DEVPUSH_BACKUPS_ENABLED",
  ]);
  const composeOnly = new Set([
    "DEVPUSH_HTTP_PORT",
    "DEVPUSH_PRODUCTION_IMAGE",
    "DEVPUSH_DB_BACKUP_RETENTION_DAYS",
  ]);
  for (const key of new Set([
    ...Object.keys(local),
    ...Object.keys(production),
  ])) {
    if (imageOrBuild.has(key) || composeOnly.has(key)) continue;
    assert.ok(
      key in production,
      `${key} missing from production environment example`,
    );
    assert.ok(
      compose.services.app.environment[key]?.startsWith("${" + key + ":"),
      `${key} not forwarded to app`,
    );
  }
  assert.equal(
    compose.services.app.build.args.VITE_DEVPUSH_BACKUPS_ENABLED,
    "${DEVPUSH_BACKUPS_ENABLED:-false}",
  );
  for (const service of Object.values(compose.services)) {
    assert.equal(
      service.image,
      "${DEVPUSH_PRODUCTION_IMAGE:-devpush-app:local}",
    );
  }
  for (const key of Object.keys(compose.services.app.environment).filter(
    (key) => /DATABASE|STORAGE/.test(key),
  )) {
    assert.equal(
      compose.services.migrate.environment[key],
      compose.services.app.environment[key],
      `${key} differs between app and migrations`,
    );
  }
});

test(
  "Docker build context excludes local secrets and state but preserves source and examples",
  {
    skip: process.env.DEVPUSH_RUN_DOCKER_TESTS !== "1",
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "devpush-build-context-"));
    try {
      const context = join(dir, "context");
      const output = join(dir, "output");
      await mkdir(context);
      await copyFile(
        new URL(".dockerignore", root),
        join(context, ".dockerignore"),
      );
      const excluded = [
        ".env",
        "app/.env",
        "deploy/.env.production",
        "app/.env.local",
        "app/.cloudflare-secrets.json",
        "app/.cloudflare-database.env",
        "app/.data/devpush.sqlite",
        "app/.wrangler/state/database.sqlite",
        "app/wrangler.jsonc",
        "app/wrangler.pending.jsonc",
        "app/public/uploads/avatar.png",
        ".data/logs.sqlite",
        "data/devpush.sqlite",
        ".tmp/private-note",
        "app/node_modules/dependency.js",
        ".pnpm-store/package/index.js",
      ];
      const included = [
        "app/src/index.ts",
        "app/.env.example",
        "deploy/.env.production.example",
        "app/wrangler.example.jsonc",
        "app/src/server/backups/index.ts",
      ];
      for (const path of [...excluded, ...included]) {
        const target = join(context, path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, "fixture");
      }
      await writeFile(join(context, "Dockerfile"), "FROM scratch\nCOPY . /\n");
      const result = spawnSync(
        "docker",
        ["build", "--output", `type=local,dest=${output}`, context],
        { encoding: "utf8", timeout: 60000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const files = await readdir(output, { recursive: true });
      for (const path of excluded)
        assert.ok(!files.includes(path), `${path} leaked into build context`);
      for (const path of included)
        assert.ok(files.includes(path), `${path} excluded from build context`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
