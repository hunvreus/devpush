import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { renderLocalEnvironment } from './local-secrets.mjs';

const field = (label, value) => ({ label, value, section: { id: 'local_environment' } });

test('local configuration preserves independent values, empty fields and multiline keys', () => {
  const values = {
    SIMPLE: 'http://localhost:7429',
    EMPTY: '',
    PRIVATE_KEY: '-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----',
    LITERAL: String.raw`a\nb\path`,
    QUOTES: `a 'single' and "double" quote`,
    DOLLARS: '$VALUE # keep literal',
  };
  const fields = Object.entries(values).map(([key, value]) => field(key, value));
  fields.push(field('OMITTED_EMPTY'));
  fields.push({ label: 'notesPlain', value: 'not an environment variable' });
  fields.push({ label: 'OTHER_CONFIG', value: 'not destined for .env', section: { id: 'other' } });
  assert.deepEqual(parseEnv(renderLocalEnvironment(fields)), { ...values, OMITTED_EMPTY: '' });
});

test('missing, invalid and duplicate environment fields are rejected', () => {
  assert.throws(() => renderLocalEnvironment([]), /no Local application fields/);
  assert.throws(() => renderLocalEnvironment([field('bad=value', 'x')]), /invalid or duplicate/);
  assert.throws(() => renderLocalEnvironment([field('KEY', 'x'), field('KEY', 'y')]), /invalid or duplicate/);
});
