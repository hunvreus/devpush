import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { manifestForBinaries } from "./agent-release.mjs";
import {
  validateAgentRelease,
} from "../app/src/lib/agent-release.mjs";

function fixture() {
  const binaries = new Map(
    ["amd64", "arm64"].map((arch) => {
      const elf = Buffer.alloc(64);
      elf.write("7f454c46", 0, "hex");
      elf[4] = 2;
      elf[5] = 1;
      elf.writeUInt16LE(2, 16);
      elf.writeUInt16LE(arch === "amd64" ? 62 : 183, 18);
      return [`devpush-agent-linux-${arch}`, elf];
    }),
  );
  return {
    version: "1.2.3",
    repository: "example/devpush",
    goVersion: "go1.27.0",
    metadata: {
      version: "1.2.3",
      protocolVersion: 1,
      capabilities: ["ingress.certificates.v1"],
    },
    binaries,
  };
}
test("release metadata is derived from both executable bodies", () => {
  const input = fixture(),
    release = manifestForBinaries(input);
  for (const asset of release.assets) {
    assert.equal(
      asset.sha256,
      createHash("sha256")
        .update(input.binaries.get(asset.filename))
        .digest("hex"),
    );
    assert.equal(asset.size, 64);

  }
  assert(Object.isFrozen(release));
  assert(Object.isFrozen(release.assets));
  assert(Object.isFrozen(release.capabilities));
});
test("a mislabeled executable or wrong build version cannot produce a manifest", () => {
  const input = fixture();
  input.binaries.set(
    "devpush-agent-linux-arm64",
    input.binaries.get("devpush-agent-linux-amd64"),
  );
  assert.throws(() => manifestForBinaries(input), /ELF platform/);
  assert.throws(
    () => manifestForBinaries({ ...fixture(), metadata: { version: "other" } }),
    /version does not match/,
  );
});
test("manifest validation rejects ambiguous platforms, unsafe URLs and malformed integrity data", () => {
  const release = manifestForBinaries(fixture());
  for (const mutate of [
    (value) => {
      value.assets[0].url = "https://evil.example/agent";
    },
    (value) => {
      value.assets[0].sha256 = "0";
    },
    (value) => {
      value.assets[0].size = 0;
    },
    (value) => {
      value.assets[1] = value.assets[0];
    },
    (value) => {
      value.capabilities.push(value.capabilities[0]);
    },
    (value) => {
      value.version = "../../other";
    },
    (value) => {
      value.goVersion = "latest";
    },
    (value) => {
      value.protocolVersion = 0;
    },
  ]) {
    const value = structuredClone(release);
    mutate(value);
    assert.throws(() => validateAgentRelease(value), /Invalid agent release/);
  }
});
