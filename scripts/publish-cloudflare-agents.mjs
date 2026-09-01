#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { cloudflareConfigPath, readCloudflareConfig } from "./setup-config.mjs";

const root = resolve(import.meta.dirname, "..");
const config = readCloudflareConfig(resolve(root, cloudflareConfigPath));

if (!config?.bucketName) {
  throw new Error("Run `pnpm configure` and configure Cloudflare R2 first.");
}

const binaries = ["devpush-agent-linux-amd64", "devpush-agent-linux-arm64"].map(
  (filename) => ({
    filename,
    path: resolve(root, "bin", filename),
  }),
);

await Promise.all(
  binaries.map(async ({ path }) => {
    await access(path).catch(() => {
      throw new Error(
        `Missing ${path}. Run \`pnpm agent:build:linux\` before publishing.`,
      );
    });
  }),
);

for (const binary of binaries) {
  await run("pnpm", [
    "--dir",
    "app",
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${config.bucketName}/agents/${binary.filename}`,
    "--file",
    binary.path,
    "--content-type",
    "application/octet-stream",
    "--remote",
  ]);
  console.log(`Published agents/${binary.filename}.`);
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Wrangler exited with status ${code ?? 1}.`));
    });
  });
}
