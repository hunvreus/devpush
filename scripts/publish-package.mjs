import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export async function packageIsPublished({ version, integrity, request = fetch }) {
  const response = await request(`https://registry.npmjs.org/devpush/${version}`, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm lookup failed (${response.status}).`);
  const pkg = await response.json();
  if (pkg.name !== 'devpush' || pkg.version !== version || pkg.dist?.integrity !== integrity)
    throw new Error('Published npm package differs from the CI-tested archive.');
  return true;
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const { version } = JSON.parse(readFileSync(resolve(root, 'app/package.json')));
  if (process.env.RELEASE_TAG !== `v${version}`) throw new Error('Release tag does not match the package.');
  const archive = resolve(root, `release/devpush-${version}.tgz`);
  const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
  const published = () => packageIsPublished({ version, integrity });
  if (!await published()) {
    const result = spawnSync('npm', ['publish', archive, '--access', 'public', '--provenance', '--tag', version.includes('-') ? 'beta' : 'latest'], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('npm publication failed.');
  }
  for (let attempt = 0; ; attempt++) {
    if (await published()) break;
    if (attempt >= 40) throw new Error('npm has not finished processing the package; retry this release workflow after it becomes available.');
    await delay(15000);
  }
  console.log(`npm serves the verified devpush@${version} package.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
