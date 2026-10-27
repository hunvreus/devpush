import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateDirectories = new Set([
  '.git', '.tmp', '.data', '.wrangler', '.core', '.output', '.nitro',
  '.devpush', '.tanstack', '.pnpm-store', '.claude', '.vscode', 'node_modules',
]);

export function publicationProblem(path, { packageContents = false } = {}) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^package\//, '');
  const parts = normalized.split('/');
  const name = parts.at(-1);
  if (normalized.startsWith('/') || parts.includes('..')) return 'unsafe path';
  if (parts.some(part => privateDirectories.has(part))) return 'private/generated directory';
  if (name === '.env' || (name?.startsWith('.env.') && !name.endsWith('.example')))
    return 'environment credentials';
  if (/^(?:id_rsa|id_ed25519|id_ecdsa)(?:\.|$)/.test(name ?? '') && !name?.endsWith('.pub'))
    return 'private SSH key';
  if (/\.(?:pem|key|p12|pfx|sqlite(?:3)?(?:-wal|-shm)?|db(?:-wal|-shm)?|log|local)$/i.test(name ?? ''))
    return 'key, database or local output';
  if (/^\.cloudflare-(?:secrets.*\.json|database\.env)$/.test(name ?? '')) return 'Cloudflare credentials';
  if (normalized === 'app/wrangler.jsonc' || normalized === 'app/wrangler.pending.jsonc')
    return 'local installation config';
  if (/^(?:app\/)?public\/uploads(?:\/|$)/.test(normalized)) return 'user uploads';
  if (/^(?:data|logs|backups|bin|release)(?:\/|$)/.test(normalized)) return 'runtime/release artifacts';
  if (!packageContents && /(^|\/)(?:dist|coverage)(\/|$)/.test(normalized)) return 'generated output';
  if (packageContents && /(^|\/)(?:test|tests|scripts)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized))
    return 'development/test files in package';
  return null;
}

export function assertPublicPaths(paths, options) {
  const failures = paths.flatMap(path => {
    const problem = publicationProblem(path, options);
    return problem ? [`${path}: ${problem}`] : [];
  });
  if (failures.length) throw new Error(`Files unsuitable for publication:\n${failures.join('\n')}`);
}

export function validateRepository(root) {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(path => {
      try { lstatSync(resolve(root, path)); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    });
  assertPublicPaths(paths);
  for (const path of paths)
    if (lstatSync(resolve(root, path)).isSymbolicLink()) throw new Error(`Review publication symlink before release: ${path}`);
  return paths.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Publication paths checked: ${validateRepository(resolve(import.meta.dirname, '..'))} files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
