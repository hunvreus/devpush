import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function fixture(t, owned) {
  const root = mkdtempSync(join(tmpdir(), 'devpush-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', '.tmp', 'app/scripts', 'app/node_modules/vite/bin', 'bin'])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'scripts/local-stop.sh'), readFileSync(new URL('./local-stop.sh', import.meta.url)));
  writeFileSync(join(root, 'app/scripts/fs-watch-error-guard.cjs'), '');
  writeFileSync(join(root, 'app/node_modules/vite/bin/vite.js'), 'setInterval(() => {}, 1000)');
  const args = owned
    ? ['-r', './scripts/fs-watch-error-guard.cjs', './node_modules/vite/bin/vite.js', 'dev', '--port', '7429', '--strictPort']
    : ['-e', 'setInterval(() => {}, 1000)'];
  const child = spawn(process.execPath, args, { cwd: join(root, 'app'), stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  writeFileSync(join(root, '.tmp/devpush-dev.pid'), String(child.pid));
  // Substitute only lsof, so these tests never inspect or stop real listeners.
  writeFileSync(join(root, 'bin/lsof'), `#!/bin/sh\ncase "$*" in\n  *cwd*) printf '%s\\n' 'n${root}/app' ;;\n  *) printf '%s\\n' '${child.pid}' ;;\nesac\n`, { mode: 0o755 });
  return { root, child, run: () => spawnSync('sh', [join(root, 'scripts/local-stop.sh')], {
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, encoding: 'utf8', timeout: 10000,
  }) };
}

test('stale PID and unrelated port listener are left running', async (t) => {
  const { child, run } = await fixture(t, false);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
});

test('stops the devpush Vite process belonging to this checkout', { timeout: 15000 }, async (t) => {
  const { child, run } = await fixture(t, true);
  const exited = once(child, 'exit');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  let deadline;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Devpush fixture was not stopped')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
  assert.equal(child.signalCode, 'SIGTERM');
});

test('a matching command from another checkout is left running', async (t) => {
  const { root, child, run } = await fixture(t, true);
  writeFileSync(join(root, 'bin/lsof'), `#!/bin/sh\nprintf '%s\\n' 'n/another-checkout/app'\n`, { mode: 0o755 });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
});
