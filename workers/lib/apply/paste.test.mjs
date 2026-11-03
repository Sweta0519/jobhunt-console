import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePasted, mergeForms } from './paste.mjs';
import { LIMITS } from './schema.mjs';

test('lines are questions, bullets are options, a trailing mark is required', () => {
  const r = parsePasted([
    'Why do you want to work here? *',
    'Which team?',
    '- Platform',
    '* Support (required)',
    'Resume/CV',
    'Email address (required)',
    'Are you over 18?',
  ].join('\n'));
  assert.ok(r.ok);
  const [why, team, cv, email, yn] = r.form.questions;
  assert.deepEqual([why.label, why.required, why.kind], ['Why do you want to work here?', true, 'long_text']);
  assert.deepEqual(team.options.map((o) => o.label), ['Platform', 'Support (required)']);
  assert.equal(team.kind, 'single_select');
  assert.deepEqual([cv.kind, cv.role], ['file', 'resume_file']);
  assert.deepEqual([email.kind, email.required], ['email', true]);
  assert.equal(yn.kind, 'yes_no');
  assert.equal(r.form.source, 'paste');
  assert.equal(r.form.completeness, 'may_be_incomplete');
});

test('fixed error codes, never the text', () => {
  assert.equal(parsePasted('').code, 'empty');
  assert.equal(parsePasted('   \n  ').code, 'empty');
  assert.equal(parsePasted('x'.repeat(LIMITS.pasted + 1)).code, 'too_long');
  assert.equal(parsePasted('123 456 ---').code, 'no_text');
  assert.equal(parsePasted('(required)').code, 'no_questions');
  for (const bad of ['', 'x'.repeat(LIMITS.pasted + 1), '123']) {
    assert.ok(!JSON.stringify(parsePasted(bad)).includes('xxxx'));
  }
});

test('the limits hold: 60 questions, 500 character labels, 300 options', () => {
  const many = Array.from({ length: 90 }, (_, i) => `Question number ${i}`).join('\n');
  const r = parsePasted(many);
  assert.equal(r.form.questions.length, 60);
  assert.ok(r.form.partial_reasons.includes('too_many_questions'));

  const long = parsePasted(`${'w'.repeat(900)}\n- a`);
  assert.equal(long.form.questions[0].label.length, 500);

  const opts = parsePasted(`Pick one\n${Array.from({ length: 400 }, (_, i) => `- option ${i}`).join('\n')}`);
  assert.equal(opts.form.questions[0].options.length, 300);
});

test('invisible characters are removed and HTML is kept as plain text', () => {
  const r = parsePasted(`Why ${String.fromCodePoint(0x202e)}us${String.fromCodePoint(0x200b)}?\n<script>alert(1)</script> Tell us more`);
  assert.equal(r.form.questions[0].label, 'Why us?');
  assert.equal(r.form.questions[1].label, '<script>alert(1)</script> Tell us more');
});

test('ids are stable, so edits survive pasting the same question again', () => {
  const a = parsePasted('Why us?').form.questions[0].id;
  const b = parsePasted('  why us ?  ').form.questions[0].id;
  assert.equal(a, b);
});

test('add mode merges by id and stays may_be_incomplete; replace mode uses the paste alone', () => {
  const base = parsePasted('Page one question\nShared question').form;
  const more = parsePasted('Shared question *\nPage two question').form;
  const added = mergeForms(base, more, 'add');
  assert.deepEqual(added.questions.map((q) => q.label), ['Page one question', 'Shared question', 'Page two question']);
  assert.equal(added.questions[1].required, true, 'the later paste wins for a shared id');
  assert.equal(added.completeness, 'may_be_incomplete');
  assert.deepEqual(mergeForms(base, more, 'replace').questions.map((q) => q.label), ['Shared question', 'Page two question']);
  assert.equal(mergeForms(null, more, 'add'), more);
});
