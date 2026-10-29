import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateAgentRelease } from '../app/src/lib/agent-release.mjs';

export function selectCiRun(runs, sha) {
  return runs.filter(run => run.head_sha === sha &&
    ['push', 'workflow_dispatch'].includes(run.event))
    .sort((a, b) => b.id - a.id)[0];
}

export function planAgentRelease({ applicationVersion, agentVersion, sourceChanged }) {
  if (applicationVersion === agentVersion) return { build: true };
  if (sourceChanged) throw new Error('Agent source changed: bump the app version and run pnpm agent:release:prepare before tagging.');
  return { build: false };
}

export async function waitForCi({ request, repository, sha, ref, pause = delay }) {
  let dispatched = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await request(`/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`);
    const run = selectCiRun(result.workflow_runs, sha);
    if (!run && !dispatched) {
      await request(`/repos/${repository}/actions/workflows/ci.yml/dispatches`, { ref });
      dispatched = true;
    }
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`CI did not pass for ${sha}: ${run.html_url}`);
      return run.id;
    }
    await pause(15000);
  }
  throw new Error('Timed out waiting for CI for the release commit.');
}

export async function githubRequest(path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: body ? 'POST' : 'GET',
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${path}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const pkg = JSON.parse(readFileSync(resolve(root, 'app/package.json'), 'utf8'));
  const pin = validateAgentRelease(JSON.parse(readFileSync(resolve(root, 'app/agent-release.json'), 'utf8')));
  const ref = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
  if (ref !== `v${pkg.version}`) throw new Error('Release tag must match the application package version.');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  let sourceChanged = false;
  if (pkg.version !== pin.version) {
    const previous = execFileSync('git', ['rev-parse', `refs/tags/v${pin.version}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    sourceChanged = Boolean(execFileSync('git', ['diff', '--name-only', previous, sha, '--', 'agent', 'go.work', 'go.work.sum', 'scripts/build-agent.mjs', 'scripts/agent-release.mjs'], { cwd: root, encoding: 'utf8' }).trim());
  }
  const plan = planAgentRelease({ applicationVersion: pkg.version, agentVersion: pin.version, sourceChanged });
  const run = await waitForCi({ request: githubRequest, repository: process.env.GITHUB_REPOSITORY, sha, ref });
  appendFileSync(process.env.GITHUB_OUTPUT, `ci_run_id=${run}\nbuild_agent=${plan.build}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
