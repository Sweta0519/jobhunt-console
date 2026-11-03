import { test } from 'node:test';
import assert from 'node:assert/strict';
import { event, safeCode, setOutput, hashId } from './safelog.mjs';

function capture(fn) {
  const lines = [];
  setOutput((s) => lines.push(s));
  try { fn(); } finally { setOutput(process.stdout.write.bind(process.stdout)); }
  return lines.join('');
}

test('event keeps allow-listed keys with safe values', () => {
  const out = capture(() => event('plan', { todo: 3, queued: 4, job: 'a1b2c3d4e5', stopped: 'near_limit' }));
  assert.equal(out, 'plan todo=3 queued=4 job=a1b2c3d4e5 stopped=near_limit\n');
});

test('event redacts a raw job id, only the hashId tag is printed', () => {
  const out = capture(() => event('draft', { job: 'greenhouse:acme:12345', hard: 1 }));
  assert.equal(out, 'draft hard=1\n');
  const tagged = capture(() => event('draft', { job: hashId('greenhouse:acme:12345', 'k') }));
  assert.match(tagged, /^draft job=[0-9a-f]{10}\n$/);
});

test('event drops unknown keys and unsafe values', () => {
  const out = capture(() => event('draft', { cv: 'Jordan Examplesmith', code: 'has spaces and text', hard: 2, job: 'x y', n: 'a\nb' }));
  assert.equal(out, 'draft hard=2\n');
});

test('safeCode: a database error with row content yields only the status', () => {
  const e = new Error('POST resume_drafts -> 400: duplicate key | {"doc":"SECRET CV TEXT"}');
  assert.equal(safeCode(e), 'db_400');
});

test('safeCode: our own codes pass, everything else is internal', () => {
  assert.equal(safeCode(Object.assign(new Error('x SECRET'), { code: 'no_master' })), 'no_master');
  assert.equal(safeCode(Object.assign(new Error('x'), { code: 'Has Spaces' })), 'internal');
  assert.equal(safeCode(new Error('plain SECRET failure')), 'internal');
  assert.equal(safeCode(null), 'internal');
});
