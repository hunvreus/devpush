import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestForBinaries } from "./agent-release.mjs";
import { validateAgentRelease } from "../app/src/lib/agent-release.mjs";

const root = resolve(import.meta.dirname, "..");
export function verifyAgentRelease({
  directory = resolve(root, "bin"),
  tag,
  runtime = false,
} = {}) {
  const release = validateAgentRelease(
    JSON.parse(readFileSync(resolve(root, "app/agent-release.json"), "utf8")),
  );
  const pkg = JSON.parse(
    readFileSync(resolve(root, "app/package.json"), "utf8"),
  );
  if (tag && tag !== `v${pkg.version}`)
    throw new Error(
      "Release tag must match the application version.",
    );
  if (
    process.env.GITHUB_REPOSITORY &&
    release.repository !== process.env.GITHUB_REPOSITORY
  )
    throw new Error("Agent release repository does not match this workflow.");
  const bodies = new Map(
    release.assets.map((asset) => [
      asset.filename,
      readFileSync(resolve(directory, asset.filename)),
    ]),
  );
  const actual = manifestForBinaries({
    ...release,
    metadata: release,
    binaries: bodies,
  });
  if (JSON.stringify(actual) !== JSON.stringify(release))
    throw new Error("Agent binaries do not match the committed pin.");
  const emitted = validateAgentRelease(
    JSON.parse(readFileSync(resolve(directory, "agent-release.json"), "utf8")),
  );
  if (JSON.stringify(emitted) !== JSON.stringify(release))
    throw new Error("Emitted agent manifest does not match the committed pin.");
  const checksums =
    release.assets
      .map((asset) => `${asset.sha256}  ${asset.filename}`)
      .join("\n") + "\n";
  if (readFileSync(resolve(directory, "SHA256SUMS"), "utf8") !== checksums)
    throw new Error("Agent checksum file does not match the committed pin.");
  if (runtime)
    for (const asset of release.assets) {
      const metadata = JSON.parse(
        readFileSync(
          resolve(directory, `metadata-${asset.os}-${asset.arch}.json`),
          "utf8",
        ),
      );
      if (
        metadata.version !== release.version ||
        metadata.protocolVersion !== release.protocolVersion ||
        metadata.os !== asset.os ||
        metadata.arch !== asset.arch ||
        JSON.stringify(metadata.capabilities) !==
          JSON.stringify(release.capabilities)
      )
        throw new Error(
          `Executed agent metadata does not match its pin: ${asset.filename}`,
        );
    }
  console.log(
    `Verified agent ${release.version}: platform headers, hashes, sizes, manifest${runtime ? " and executed runtime metadata" : ""}.`,
  );
  return release;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  let runtime = false,
    tag;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--runtime") runtime = true;
    else if (flag === "--tag" && args[0]) tag = args.shift();
    else
      throw new Error(
        "Usage: node scripts/verify-agent-release.mjs [--tag vVERSION] [--runtime]",
      );
  }
  verifyAgentRelease({ runtime, tag });
}
