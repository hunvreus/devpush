import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function invoke(command, initial, owned = true, network = true) {
  const dir = mkdtempSync(join(tmpdir(), "devpush-vm-cli-"));
  try {
    const state = join(dir, "state"),
      calls = join(dir, "calls");
    writeFileSync(state, initial);
    writeFileSync(
      join(dir, "limactl"),
      `#!${process.execPath}
const fs = require('node:fs'); const a = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(a)+'\\n');
if(a[0]==='list') {
 const s=fs.readFileSync(process.env.STATE,'utf8');
 if(s) console.log(a.includes('--json') ? JSON.stringify({name:'devpush-test',vmType:'vz',config:{networks:process.env.NETWORK==='1'?[{vzNAT:true}]:[]}}) : 'devpush-test '+s);
}
if(a[0]==='create') fs.writeFileSync(process.env.STATE,'Stopped');
if(a[0]==='start') fs.writeFileSync(process.env.STATE,'Running');
if(a[0]==='shell' && a.includes('/etc/devpush-test-vm') && process.env.OWNED==='0') process.exit(1);
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      "bash",
      [resolve("scripts/local-vm.sh"), command],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          STATE: state,
          CALLS: calls,
          OWNED: owned ? "1" : "0",
          NETWORK: network ? "1" : "0",
        },
      },
    );
    return {
      status: result.status,
      calls: readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("setup creates a missing VM; reuses an already running VM", () => {
  const first = invoke("setup", "");
  assert.equal(first.status, 0);
  assert.deepEqual(
    first.calls
      .filter((a) => ["create", "start"].includes(a[0]))
      .map((a) => a[0]),
    ["create", "start"],
  );
  const repeat = invoke("setup", "Running");
  assert.equal(repeat.status, 0);
  assert.equal(
    repeat.calls.some((a) => ["create", "start", "delete"].includes(a[0])),
    false,
  );
});

test("destroy verifies ownership before stopping or deleting the dedicated VM", () => {
  const refused = invoke("destroy", "Running", false);
  assert.notEqual(refused.status, 0);
  assert.equal(
    refused.calls.some((a) => ["stop", "delete"].includes(a[0])),
    false,
  );
  const allowed = invoke("destroy", "Running");
  assert.equal(allowed.status, 0);
  assert.deepEqual(
    allowed.calls
      .filter((a) => ["stop", "delete"].includes(a[0]))
      .map((a) => a[0]),
    ["stop", "delete"],
  );
  assert.deepEqual(allowed.calls.at(-1), [
    "delete",
    "--tty=false",
    "devpush-test",
  ]);
});

test("stopping preserves the disk; destroying an absent VM creates nothing", () => {
  const stopped = invoke("stop", "Running");
  assert.equal(stopped.status, 0);
  assert.deepEqual(stopped.calls.at(-1), ["stop", "devpush-test"]);
  const absent = invoke("destroy", "");
  assert.equal(absent.status, 0);
  assert.equal(
    absent.calls.some((a) => ["create", "start", "delete"].includes(a[0])),
    false,
  );
});

test("setup upgrades owned VM networking; never edits an unowned VM", () => {
  const upgrade = invoke("setup", "Running", true, false);
  assert.equal(upgrade.status, 0);
  assert.deepEqual(
    upgrade.calls.filter((a) => ["stop", "edit", "start"].includes(a[0])),
    [
      ["stop", "devpush-test"],
      ["edit", "--tty=false", "--network=vzNAT", "devpush-test"],
      ["start", "--tty=false", "devpush-test"],
    ],
  );
  const refused = invoke("setup", "Running", false, false);
  assert.notEqual(refused.status, 0);
  assert.equal(
    refused.calls.some((a) => ["stop", "edit", "delete"].includes(a[0])),
    false,
  );
});
