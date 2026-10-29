import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devpush-doc-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['scripts', 'docs', 'app', 'agent']) mkdirSync(join(root, path), { recursive: true });
  cpSync(new URL('./validate-docs.mjs', import.meta.url), join(root, 'scripts/validate-docs.mjs'));
  for (const name of ['README.md', 'AGENTS.md', 'app/README.md', 'agent/README.md']) writeFileSync(join(root, name), '');
  writeFileSync(join(root, 'docs/docs.json'), JSON.stringify({ menu: ['index', { type: 'group', label: 'Basics', items: [{ type: 'submenu', label: 'Guides', items: [{ slug: 'projects', label: 'Projects' }] }] }] }));
  writeFileSync(join(root, 'docs/index.md'), '---\ndescription: Start here.\n---\n# Intro\n[Projects](/docs/projects/#setup)\n');
  writeFileSync(join(root, 'docs/projects.md'), '---\ndescription: Project setup.\n---\n# Setup\n');
  return { root, run: () => spawnSync(process.execPath, ['scripts/validate-docs.mjs'], { cwd: root, encoding: 'utf8' }) };
}

test('labeled submenu pages and heading anchors resolve to documentation', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

test('nested folders and broken heading anchors fail validation', (t) => {
  const { root, run } = fixture(t);
  mkdirSync(join(root, 'docs/basics'));
  writeFileSync(join(root, 'docs/projects.md'), '---\ndescription: Changed.\n---\n# Other\n[Missing](/docs/projects/#missing)\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Documentation must be flat/);
  assert.match(result.stderr, /missing heading/);
});
