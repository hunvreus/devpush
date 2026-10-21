import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileAtomic } from './setup-config.mjs';
import { encodeEnvValue } from './env-file.mjs';

export function renderLocalEnvironment(fields) {
  const settings = fields.filter(field => field.section?.id === 'local_environment');
  if (!settings.length) throw new Error('The vault item has no Local application fields.');
  const seen = new Set();
  const lines = settings.map(field => {
    const key = field.label;
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || seen.has(key))
      throw new Error('The vault item contains an invalid or duplicate environment field.');
    seen.add(key);
    const value = field.value ?? '';
    if (typeof value !== 'string') throw new Error('Environment values must be text.');
    return `${key}=${encodeEnvValue(value)}`;
  });
  return `${lines.join('\n')}\n`;
}

function pullLocalSecrets() {
  const env = { ...process.env };
  if (!env.OP_SERVICE_ACCOUNT_TOKEN) {
    if (process.platform !== 'darwin')
      throw new Error('Set OP_SERVICE_ACCOUNT_TOKEN to access the Development vault.');
    const key = spawnSync('security', [
      'find-generic-password', '-a', 'service-account', '-s', 'development-1password', '-w',
    ], { encoding: 'utf8' });
    if (key.status !== 0 || !key.stdout.trim())
      throw new Error('Could not read the development service-account token from Keychain.');
    env.OP_SERVICE_ACCOUNT_TOKEN = key.stdout.trim();
  }
  const result = spawnSync('op', [
    'item', 'get', 'devpush (local)', '--vault', 'Development', '--format', 'json',
  ], { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error('Could not read devpush (local). Check that op is installed and the service account has vault access.');
  let item;
  try { item = JSON.parse(result.stdout); }
  catch { throw new Error('1Password returned an invalid item.'); }
  if (!Array.isArray(item.fields)) throw new Error('1Password returned no item fields.');
  const content = renderLocalEnvironment(item.fields);
  writeFileAtomic(fileURLToPath(new URL('../app/.env', import.meta.url)), content, 0o600);
  console.log('Restored app/.env from Development / devpush (local), with owner-only permissions.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { pullLocalSecrets(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
