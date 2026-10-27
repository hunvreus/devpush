import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devpush-doc-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['scripts', 'docs/basics', 'app', 'agent']) mkdirSync(join(root, path), { recursive: true });
  cpSync(new URL('./validate-docs.mjs', import.meta.url), join(root, 'scripts/validate-docs.mjs'));
  for (const name of ['README.md', 'AGENTS.md', 'app/README.md', 'agent/README.md']) writeFileSync(join(root, name), '');
  writeFileSync(join(root, 'docs/docs.json'), JSON.stringify({ menu: ['index', { label: 'Basics', items: ['projects'] }] }));
  writeFileSync(join(root, 'docs/index.md'), '---\ndescription: Start here.\n---\n# Intro\n[Projects](/docs/projects/#setup)\n');
  writeFileSync(join(root, 'docs/basics/projects.md'), '---\ndescription: Project setup.\n---\n# Setup\n');
  return { root, run: () => spawnSync(process.execPath, ['scripts/validate-docs.mjs'], { cwd: root, encoding: 'utf8' }) };
}

test('stable URLs and heading anchors resolve to nested documentation', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

test('duplicate filenames and broken nested-page anchors fail validation', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'docs/projects.md'), '---\ndescription: Duplicate.\n---\n# Other\n[Missing](/docs/projects/#missing)\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate documentation filename/);
  assert.match(result.stderr, /missing heading/);
});
