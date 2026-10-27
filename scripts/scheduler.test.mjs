import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const {parse} = require('yaml');
test('production app owns scheduling without a scheduler container or required cron secret', async () => {
 const compose = parse(await readFile(new URL('../deploy/compose.production.yml', import.meta.url),'utf8'));
 assert.equal(compose.services.scheduler, undefined);
 assert.equal(compose.services.app.environment.DEVPUSH_CRON_SECRET, '${DEVPUSH_CRON_SECRET:-}');
});
