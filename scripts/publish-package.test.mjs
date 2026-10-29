import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageIsPublished } from './publish-package.mjs';

test('publication gate waits for npm and rejects different package bytes', async () => {
  const version = '1.0.0', integrity = 'sha512-tested';
  const lookup = response => packageIsPublished({ version, integrity, request: async () => response });
  assert.equal(await lookup(new Response(null, { status: 404 })), false);
  assert.equal(await lookup(Response.json({ name: 'devpush', version, dist: { integrity } })), true);
  for (const pkg of [
    { name: 'other', version, dist: { integrity } },
    { name: 'devpush', version: '0.9.0', dist: { integrity } },
    { name: 'devpush', version, dist: { integrity: 'sha512-different' } },
  ]) await assert.rejects(lookup(Response.json(pkg)), /differs from the CI-tested archive/);
  await assert.rejects(lookup(new Response(null, { status: 503 })), /npm lookup failed/);
});
