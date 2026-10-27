import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateRepository, assertPublicPaths, publicationProblem } from './validate-public-files.mjs';

test('publication guard rejects local secrets and generated state even if force-added', () => {
  for (const path of ['.env', 'app/.env.production', 'app/.cloudflare-secrets.json', '.wrangler/state/db.sqlite', 'keys/id_ed25519', 'cert.pem', 'private.key', 'dump.db', 'debug.log', 'app/public/uploads/avatar.png', '.tmp/review.md', 'app/dist/server/index.js', 'release/devpush.tgz'])
    assert.throws(() => assertPublicPaths([path]), /unsuitable for publication/, path);
});
test('public samples, key-handling source and intended package build outputs remain publishable', () => {
  for (const path of ['app/.env.example', 'deploy/.env.production.example', 'app/cloudflare-types.env', 'app/src/server/secrets/crypto.ts', 'app/public/logo-email.png', 'app/wrangler.template.jsonc', '.github/workflows/release.yml'])
    assert.equal(publicationProblem(path), null, path);
  assertPublicPaths(['package/dist/package/vite.mjs', 'package/src/server.ts'], { packageContents: true });
});
test('package contents reject test fixtures and local state', () => {
  for (const path of ['package/src/auth.test.ts', 'package/src/test/setup.ts', 'package/public/uploads/photo.png', 'package/.env', 'package/scripts/test.mjs'])
    assert.throws(() => assertPublicPaths([path], { packageContents: true }), /unsuitable for publication/, path);
});


test('Git inventory catches forced tracked secrets and broken symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'publication-guard-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, '.gitignore'), '.env\n');
    writeFileSync(join(root, '.env'), 'EXAMPLE=not-a-real-secret\n');
    execFileSync('git', ['add', '--force', '.env'], { cwd: root });
    assert.throws(() => validateRepository(root), /environment credentials/);
    execFileSync('git', ['rm', '--cached', '--force', '.env'], { cwd: root });
    symlinkSync('/missing/private/file', join(root, 'innocent-name'));
    assert.throws(() => validateRepository(root), /publication symlink/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unsafe archive paths cannot bypass publication checks', () => {
  assert.throws(() => assertPublicPaths(['package/../outside']), /unsafe path/);
  assert.throws(() => assertPublicPaths(['/absolute/file']), /unsafe path/);
});
