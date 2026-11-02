#!/usr/bin/env node
import { resolve } from 'node:path';
import { configure } from '../app/src/cli/setup.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Configure devpush\n\nUsage: pnpm configure\n\nConfigure local development, Cloudflare, or Docker Compose.');
} else {
  configure({ root: resolve(import.meta.dirname, '..') }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
