import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCiRun, planAgentRelease, waitForCi } from './release-ci.mjs';

test('release gate never reuses a PR run or another commit', () => {
  const runs = [
    { id: 4, head_sha: 'sha', event: 'pull_request' },
    { id: 3, head_sha: 'different', event: 'push' },
    { id: 2, head_sha: 'sha', event: 'workflow_dispatch' },
    { id: 1, head_sha: 'sha', event: 'push' },
  ];
  assert.equal(selectCiRun(runs, 'sha').id, 2);
  assert.equal(selectCiRun(runs, 'missing'), undefined);
});
test('unchanged agents keep their pin; stale pins cannot hide changed source', () => {
  assert.deepEqual(planAgentRelease({ applicationVersion: '1.0.0', agentVersion: '1.0.0-beta.11', sourceChanged: false }), { build: false });
  assert.throws(() => planAgentRelease({ applicationVersion: '1.0.0', agentVersion: '1.0.0-beta.11', sourceChanged: true }), /Agent source changed/);
  assert.deepEqual(planAgentRelease({ applicationVersion: '1.0.0', agentVersion: '1.0.0', sourceChanged: true }), { build: true });
});
test('missing CI is dispatched once; publication waits for the successful exact commit', async () => {
  let gets=0, dispatches=0;
  const id = await waitForCi({ repository:'example/repo', sha:'sha', ref:'v1.0.0', pause:async()=>{}, request:async(path, body)=> {
    if(body) { dispatches++; assert.deepEqual(body,{ref:'v1.0.0'}); return null; }
    gets++;
    return { workflow_runs:gets<3?[]:[{id:5,head_sha:'sha',event:'workflow_dispatch',status:'completed',conclusion:'success'}] };
  }});
  assert.equal(id,5); assert.equal(dispatches,1);
});
test('failed or canceled CI blocks publication', async () => {
  for(const conclusion of ['failure','cancelled','timed_out']) await assert.rejects(waitForCi({ repository:'example/repo',sha:'sha',ref:'v1.0.0',request:async()=>({workflow_runs:[{id:1,head_sha:'sha',event:'push',status:'completed',conclusion}]}) }),/CI did not pass/);
});
