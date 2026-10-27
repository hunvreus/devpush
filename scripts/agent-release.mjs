import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  agentReleasePlatforms,
  validateAgentRelease,
} from "../app/src/lib/agent-release.mjs";

const root = resolve(import.meta.dirname, "..");
export function manifestForBinaries({
  version,
  repository,
  goVersion,
  metadata,
  binaries,
}) {
  if (metadata.version !== version)
    throw new Error(
      "Agent build version does not match the application version.",
    );
  const assets = agentReleasePlatforms.map((platform) => {
    const body = binaries.get(platform.filename);
    // Verify the executable platform, not merely a filename supplied by a caller.
    if (
      !body ||
      body.length < 64 ||
      body.subarray(0, 4).toString("hex") !== "7f454c46" ||
      body[4] !== 2 ||
      body[5] !== 1 ||
      ![0, 3].includes(body[7]) ||
      body.readUInt16LE(16) !== 2 ||
      body.readUInt16LE(18) !== (platform.arch === "amd64" ? 62 : 183)
    )
      throw new Error(`Invalid ELF platform: ${platform.filename}`);
    return {
      ...platform,
      size: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      url: `https://github.com/${repository}/releases/download/v${version}/${platform.filename}`,
    };
  });
  return validateAgentRelease({
    schemaVersion: 1,
    version,
    repository,
    goVersion,
    protocolVersion: metadata.protocolVersion,
    capabilities: metadata.capabilities,
    assets,
  });
}
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
export function prepareAgentRelease({
  directory = resolve(root, "bin"),
  manifestPath = resolve(root, "app/agent-release.json"),
} = {}) {
  const { version, repository } = JSON.parse(
    readFileSync(resolve(root, "app/package.json"), "utf8"),
  );
  const repositoryUrl =
    typeof repository === "string" ? repository : repository?.url;
  const repositoryName = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(
    repositoryUrl ?? "",
  )?.[1];
  if (!repositoryName)
    throw new Error("Application package must identify its GitHub repository.");
  mkdirSync(directory, { recursive: true });
  for (const platform of agentReleasePlatforms)
    run(
      process.execPath,
      ["scripts/build-agent.mjs", resolve(directory, platform.filename)],
      { GOOS: platform.os, GOARCH: platform.arch },
    );
  const native = resolve(root, ".tmp/agent-release/native-agent");
  run(process.execPath, ["scripts/build-agent.mjs", native], {
    GOOS: process.platform === "darwin" ? "darwin" : process.platform,
    GOARCH: process.arch === "arm64" ? "arm64" : "amd64",
  });
  const metadata = JSON.parse(run(native, ["version", "--json"]));
  const goVersion = run("go", ["env", "GOVERSION"]).trim();
  const binaries = new Map(
    agentReleasePlatforms.map(({ filename }) => [
      filename,
      readFileSync(resolve(directory, filename)),
    ]),
  );
  const manifest = manifestForBinaries({
    version,
    repository: repositoryName,
    goVersion,
    metadata,
    binaries,
  });
  mkdirSync(dirname(manifestPath), { recursive: true });
  const json = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(manifestPath, json);
  writeFileSync(resolve(directory, "agent-release.json"), json);
  writeFileSync(
    resolve(directory, "SHA256SUMS"),
    manifest.assets
      .map((asset) => `${asset.sha256}  ${asset.filename}`)
      .join("\n") + "\n",
  );
  console.log(
    `Prepared agent ${version}: Linux amd64/arm64 and verified manifest.`,
  );
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length > 2)
    throw new Error(
      "Usage: node scripts/agent-release.mjs [output-directory] [manifest-path]",
    );
  prepareAgentRelease({
    ...(args[0] ? { directory: resolve(args[0]) } : {}),
    ...(args[1] ? { manifestPath: resolve(args[1]) } : {}),
  });
}
