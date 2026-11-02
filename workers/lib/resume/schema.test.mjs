import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from './schema.mjs';
import { goodOutput } from './fixtures/load.mjs';

test('a good answer is valid', () => {
  assert.deepEqual(validateDraft(goodOutput()), { ok: true, code: null });
});

test('an unknown key is rejected, top level and nested', () => {
  const a = goodOutput(); a.extra = 1;
  assert.equal(validateDraft(a).ok, false);
  const b = goodOutput(); b.experience[0].company = 'Someone Else Ltd';
  assert.equal(validateDraft(b).ok, false);
});

test('over-length text is rejected', () => {
  const a = goodOutput(); a.tagline = 'x'.repeat(141);
  assert.equal(validateDraft(a).ok, false);
  const b = goodOutput(); b.experience[0].bullets[0].text = 'y'.repeat(261);
  assert.equal(validateDraft(b).ok, false);
});

test('a wrong enum value is rejected', () => {
  const a = goodOutput(); a.requirements[0].status = 'excellent';
  assert.equal(validateDraft(a).ok, false);
});

test('missing required fields, wrong types and empty lists are rejected', () => {
  const a = goodOutput(); delete a.summary;
  assert.equal(validateDraft(a).ok, false);
  const b = goodOutput(); b.suspicious_instructions = 'no';
  assert.equal(validateDraft(b).ok, false);
  const c = goodOutput(); c.experience[0].bullets[0].from = [];
  assert.equal(validateDraft(c).ok, false);
  assert.equal(validateDraft(null).ok, false);
  assert.equal(validateDraft([]).ok, false);
});
