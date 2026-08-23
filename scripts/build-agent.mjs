import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, process.argv[2] ?? "bin/devpush-agent");
const { version } = JSON.parse(
  readFileSync(resolve(root, "app/package.json"), "utf8"),
);

if (typeof version !== "string" || version.length === 0) {
  throw new Error("app/package.json must define a version.");
}

mkdirSync(dirname(output), { recursive: true });

const result = spawnSync(
  "go",
  [
    "build",
    "-ldflags",
    `-X github.com/devpush/devpush/agent/internal/agent.Version=${version}`,
    "-o",
    output,
    "./agent/cmd/devpush-agent",
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
