import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChecks } from './ci-plan.mjs';
test('UI, docs and version-only releases do not rebuild unchanged agents or Docker packaging', () => {
  assert.deepEqual(planChecks(['app/src/features/users/mcp-consent.tsx','docs/mcp.md','app/package.json']), { agent:false,image:false });
});
test('agent inputs require agent checks and image validation', () => {
  for(const path of ['agent/internal/agent/jobs.go','agent/go.mod','go.work','scripts/build-agent.mjs','scripts/agent-release.mjs']) assert.deepEqual(planChecks([path]),{agent:true,image:true},path);
});
test('packaging and dependency changes still validate the image', () => {
  for(const path of ['deploy/control-plane.Dockerfile','pnpm-lock.yaml','app/src/package/vite.ts','app/scripts/build-maintenance.mjs']) assert.deepEqual(planChecks([path]),{agent:false,image:true},path);
  assert.deepEqual(planChecks(['app/package.json'],{packageChanged:true}),{agent:false,image:true});
});
