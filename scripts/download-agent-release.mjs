import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAgentRelease } from '../app/src/lib/agent-release.mjs';
import { verifyAgentRelease } from './verify-agent-release.mjs';

const root = resolve(import.meta.dirname, '..');
const pin = validateAgentRelease(JSON.parse(readFileSync(resolve(root, 'app/agent-release.json'))));
const directory = resolve(root, 'bin');
mkdirSync(directory, { recursive: true });
for (const filename of [...pin.assets.map(asset => asset.filename), 'agent-release.json', 'SHA256SUMS']) {
  const url = `https://github.com/${pin.repository}/releases/download/v${pin.version}/${filename}`;
  let bytes;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Agent download failed (${response.status}): ${filename}`);
      bytes = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      if (attempt === 7) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  writeFileSync(resolve(directory, filename), bytes);
}
verifyAgentRelease({ directory });
