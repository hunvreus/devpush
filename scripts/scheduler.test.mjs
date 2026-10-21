import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(new URL("../app/package.json", import.meta.url));
const { parse } = require("yaml");

test("scheduler survives failures, retries maintenance and runs it once per successful hour", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devpush-scheduler-"));
  try {
    const compose = parse(
      await readFile(
        new URL("../deploy/compose.production.yml", import.meta.url),
        "utf8",
      ),
    );
    const script = compose.services.scheduler.command[2].replaceAll("$$", "$");
    for (const [name, source] of Object.entries({
      date: 'if [ "$1" = "+%s" ]; then echo 60; else echo 2026-10-14T10; fi',
      sleep:
        'n=$(cat "$SCHEDULER_FIXTURE/ticks" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$SCHEDULER_FIXTURE/ticks"; [ "$n" -le 3 ] || exit 99',
      curl: 'for arg do endpoint="$arg"; done; echo "$endpoint" >> "$SCHEDULER_FIXTURE/calls"; [ "$(cat "$SCHEDULER_FIXTURE/ticks")" != 1 ]',
    }))
      await writeFile(join(dir, name), `#!/bin/sh\n${source}\n`, {
        mode: 0o700,
      });
    const result = spawnSync("/bin/sh", ["-ec", script], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        SCHEDULER_FIXTURE: dir,
        DEVPUSH_BACKUPS_ENABLED: "true",
        DEVPUSH_CRON_SECRET: "fixture-secret",
      },
    });
    assert.equal(result.status, 99);
    const calls = (await readFile(join(dir, "calls"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(calls.filter((url) => url.endsWith("/backups")).length, 3);
    assert.equal(calls.filter((url) => url.endsWith("/maintenance")).length, 2);
    assert.match(result.stderr, /Backup scheduling failed/);
    assert.match(result.stderr, /Maintenance failed/);
    assert.match(script, /--connect-timeout 5 --max-time 45/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
