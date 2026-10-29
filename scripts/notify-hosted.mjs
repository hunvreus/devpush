import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../app/package.json', import.meta.url)));
if (!process.env.HOSTED_DEPLOY_TOKEN) throw new Error('Configure HOSTED_DEPLOY_TOKEN with Actions write access to hunvreus/devpush-hosted to enable the automatic release handoff.');
const response = await fetch('https://api.github.com/repos/hunvreus/devpush-hosted/actions/workflows/ci.yml/dispatches', {
  method: 'POST',
  signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${process.env.HOSTED_DEPLOY_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
  body: JSON.stringify({ ref: 'main', inputs: { core_version: version } }),
});
if (response.status !== 204) throw new Error(`Hosted workflow dispatch failed (${response.status}).`);
console.log(`Started hosted checks and deployment for devpush@${version}.`);
