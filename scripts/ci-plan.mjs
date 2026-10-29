import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function planChecks(paths, { packageChanged = false } = {}) {
  const agent = paths.some(path => /^(agent\/|go\.work(?:\.sum)?$|scripts\/(?:build-agent|agent-release)\.mjs$)/.test(path));
  const image = agent || packageChanged || paths.some(path => /^(deploy\/|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|package\.json$|app\/src\/package\/|app\/scripts\/|scripts\/validate-production-image\.sh$)/.test(path));
  const application = paths.some(path => !/^(?:docs\/|[^/]+\.md$|app\/README\.md$)/.test(path));
  return { agent, image, application };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.pull_request?.base.sha ?? event.before;
  let checks = { agent: true, image: true };
  if (base && !/^0+$/.test(base)) {
    const paths = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
    let packageChanged = false;
    if (paths.includes('app/package.json')) {
      const previous = JSON.parse(execFileSync('git', ['show', `${base}:app/package.json`], { encoding: 'utf8' }));
      const current = JSON.parse(readFileSync('app/package.json', 'utf8'));
      delete previous.version; delete current.version;
      packageChanged = JSON.stringify(previous) !== JSON.stringify(current);
    }
    checks = planChecks(paths, { packageChanged });
  }
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(checks).map(([key,value]) => `${key}=${value}`).join('\n')+'\n');
}
