import { parse } from 'jsonc-parser';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createProject, npmOverrides } from '../app/src/cli/project.mjs';
import { createCloudflareConfig } from './setup-config.mjs';

const metadata = JSON.parse(readFileSync(new URL('../app/package.json', import.meta.url), 'utf8'));
const template = readFileSync(new URL('../app/wrangler.template.jsonc', import.meta.url), 'utf8');

test('standalone projects use published dependencies and preserve package D1 paths', t => {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const target of ['docker', 'cloudflare']) {
    const root = createProject(join(directory, target), target, metadata, template);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    assert.equal(manifest.dependencies.devpush, metadata.version);
    assert.equal(manifest.dependencies.react, metadata.peerDependencies.react);
    assert.equal(manifest.scripts.configure, 'devpush configure');
    if (target === 'cloudflare') {
      const installedTemplate = JSON.parse(readFileSync(join(root, 'wrangler.template.jsonc')));
      const config = JSON.parse(createCloudflareConfig({ template: installedTemplate, databaseId: 'main', logDatabaseId: 'logs' }));
      assert.equal(config.main, 'node_modules/devpush/src/server.ts');
      assert.equal(config.d1_databases[1].migrations_dir, 'node_modules/devpush/src/server/db/migrations-logs');
      assert.deepEqual(config.durable_objects, parse(template).durable_objects);
    } else {
      assert.match(readFileSync(join(root, 'compose.yml'), 'utf8'), /127\.0\.0\.1:.*7429.*:3000/);
      assert.match(readFileSync(join(root, 'Dockerfile'), 'utf8'), /USER node/);
      assert.match(readFileSync(join(root, '.dockerignore'), 'utf8'), /\.env/);
    }
    writeFileSync(join(root, 'keep.txt'), 'keep');
    assert.throws(() => createProject(root, target, metadata, template), /not empty/);
    assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'keep');
  }
});

test('built CLI creates projects outside the checkout and rejects invalid input', t => {
  execFileSync('pnpm', ['--dir', 'app', 'build:package'], { cwd: resolve(import.meta.dirname, '..'), stdio: 'pipe' });
  const cli = resolve(import.meta.dirname, '../app/dist/package/cli.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'devpush-built-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.match(execFileSync(process.execPath, [cli, '--help'], { cwd: directory, encoding: 'utf8' }), /npx devpush/);
  execFileSync(process.execPath, [cli, 'init', 'installation', '--target', 'cloudflare', '--no-install'], { cwd: directory });
  assert.equal(JSON.parse(readFileSync(join(directory, 'installation/package.json'))).dependencies.devpush, metadata.version);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'installation/package.json'))).overrides, npmOverrides(policy));
  for (const args of [['init', 'installation', '--target', 'docker', '--no-install'], ['init', 'other', '--target', 'bad'], ['bogus']])
    assert.notEqual(spawnSync(process.execPath, [cli, ...args], { cwd: directory }).status, 0);
  assert.equal(statSync(join(directory, 'installation')).isDirectory(), true);
});

test('Docker migrations run in the generated container rather than writing host paths', t => {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-cli-docker-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = createProject(join(directory, 'installation'), 'docker', metadata, template);
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const log = join(directory, 'docker-call');
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$DEVPUSH_CLI_CALL_LOG"\n', { mode: 0o755 });
  execFileSync(process.execPath, [resolve(import.meta.dirname, '../app/dist/package/cli.mjs'), 'migrate'], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEVPUSH_CLI_CALL_LOG: log },
  });
  assert.equal(readFileSync(log, 'utf8'), 'compose\nrun\n--build\n--rm\nmigrate\n');
});

test('packaged backup helper snapshots both stores and rejects remote stores', async t => {
  const { createRequire } = await import('node:module');
  const Sqlite = createRequire(new URL('../app/package.json', import.meta.url))('better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'devpush-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = ['main.sqlite', 'logs.sqlite'].map(name => join(directory, name));
  for (const path of paths) {
    const db = new Sqlite(path);
    db.exec('CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES (\'saved\')');
    db.close();
  }
  const output = join(directory, 'snapshots');
  const helper = resolve(import.meta.dirname, '../app/dist/package/backup-sqlite.mjs');
  const env = { ...process.env, DEVPUSH_DATABASE_URL: '', DEVPUSH_LOG_DATABASE_URL: '', DEVPUSH_DATABASE_PATH: paths[0], DEVPUSH_LOG_DATABASE_PATH: paths[1], DEVPUSH_DB_BACKUP_DIR: output };
  execFileSync(process.execPath, [helper], { env });
  const { readdirSync } = await import('node:fs');
  const snapshots = readdirSync(output);
  assert.equal(snapshots.length, 2);
  for (const name of snapshots) {
    const db = new Sqlite(join(output, name), { readonly: true });
    assert.equal(db.prepare('SELECT value FROM proof').get().value, 'saved');
    db.close();
  }
  assert.notEqual(spawnSync(process.execPath, [helper], { env: { ...env, DEVPUSH_DATABASE_URL: 'libsql://remote.example.com' } }).status, 0);
});

const policy = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).pnpm.overrides;
test('generated installations retain the workspace dependency policy with npm selectors', () => {
  const npm = npmOverrides(policy);
  assert.equal(npm.undici, policy.undici);
  assert.equal(npm.minimatch['brace-expansion'], policy['minimatch>brace-expansion']);
  assert.equal(npm.xmlbuilder2['js-yaml'], policy['xmlbuilder2>js-yaml']);
  assert.deepEqual(npmOverrides({ parent: '1.0.0', 'parent>child': '2.0.0' }), { parent: { '.': '1.0.0', child: '2.0.0' } });
});
