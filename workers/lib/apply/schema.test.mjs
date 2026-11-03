import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, cleanLabel, cleanBlock, questionId, formSha, validateForm, ANSWER_SCHEMA, validateAnswers } from './schema.mjs';
import { BANK_KEYS } from './bank.mjs';

const q = (label, extra = {}) => ({ label, kind: 'short_text', ...extra });
const form = (questions, extra = {}) => ({ source: 'greenhouse', completeness: 'complete', questions, ...extra });
const cp = (n) => String.fromCodePoint(n);

test('cleanLabel removes control, bidi and invisible characters and collapses space', () => {
  const dirty = `Why${cp(0x202e)} us${cp(0x200b)}?\n\t  ${cp(0)}Tell${cp(0xfeff)}  me`;
  assert.equal(cleanLabel(dirty), 'Why us ? Tell me');
  assert.equal(cleanLabel('x'.repeat(900)).length, LIMITS.label);
  assert.equal(cleanLabel(null), '');
  assert.equal(cleanBlock(`a${cp(0x2028)}b${cp(0x200b)}c\n\n\n\nd`, 100), 'a\nbc\n\nd');
});

test('question ids are stable across re-reads and ignore case and punctuation', () => {
  assert.equal(questionId('Why do you want this job?'), questionId('  why do you want THIS job '));
  assert.notEqual(questionId('Why do you want this job?'), questionId('Why this team?'));
  assert.match(questionId('x'), /^q_[0-9a-f]{8}$/);
  assert.notEqual(questionId('Name', 'a'), questionId('Name', 'b'));
});

test('validateForm cleans labels, numbers option ids and keeps ids unique', () => {
  const v = validateForm(form([
    q('Pick one', { kind: 'single_select', options: [{ label: 'A' }, 'B', { label: '' }] }),
    q('Same'), q('Same'),
  ]));
  assert.ok(v.ok);
  assert.deepEqual(v.form.questions[0].options, [{ id: 'o0', label: 'A' }, { id: 'o1', label: 'B' }]);
  const ids = v.form.questions.map((x) => x.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(v.form.completeness, 'complete');
  assert.equal(v.form.questions[0].required, null, 'unknown stays unknown, never shown as optional');
});

test('validateForm rejects bad shapes', () => {
  for (const bad of [null, {}, form('x'), form([]), form([null]), form([{ label: '' }]), { questions: [q('a')] }, { source: 'nope', questions: [q('a')] }]) {
    assert.equal(validateForm(bad).ok, false);
  }
});

test('validateForm cuts oversize forms and marks them may_be_incomplete', () => {
  const many = Array.from({ length: 80 }, (_, i) => q(`Question number ${i}`));
  const v = validateForm(form(many));
  assert.equal(v.form.questions.length, LIMITS.questions);
  assert.equal(v.form.completeness, 'may_be_incomplete');
  assert.ok(v.form.partial_reasons.includes('too_many_questions'));

  const opts = Array.from({ length: 400 }, (_, i) => `Option ${i}`);
  const w = validateForm(form([q('Country', { kind: 'single_select', options: opts })]));
  assert.equal(w.form.questions[0].options.length, LIMITS.options);
  assert.equal(w.form.questions[0].options_known, false);
});

test('an unknown kind makes the form may_be_incomplete', () => {
  const v = validateForm(form([q('Odd', { kind: 'hologram' })]));
  assert.equal(v.form.questions[0].kind, 'unknown');
  assert.equal(v.form.completeness, 'may_be_incomplete');
  assert.ok(v.form.partial_reasons.length > 0);
});

test('formSha changes with the questions', () => {
  const a = validateForm(form([q('One'), q('Two')])).form;
  const b = validateForm(form([q('One'), q('Three')])).form;
  assert.equal(formSha(a), formSha(validateForm(form([q('One'), q('Two')])).form));
  assert.notEqual(formSha(a), formSha(b));
});

const answer = (o = {}) => ({ q: 'q_00000000', cls: 'drafted', bank_key: '', text: 'x', from: ['r1.b1'], option_ids: [], asked_terms: [], ...o });
const good = () => ({ answers: [answer()], cover_letter: { paragraphs: [{ text: 'Hello', from: ['r1'] }] }, suspicious_instructions: false });

test('ANSWER_SCHEMA accepts a good answer and rejects each bad one', () => {
  assert.equal(validateAnswers(good()).ok, true);
  const bads = [
    (o) => { o.answers[0].cls = 'maybe'; },
    (o) => { o.answers[0].bank_key = 'salary_amount'; },
    (o) => { o.answers[0].text = 'x'.repeat(3001); },
    (o) => { o.answers[0].extra = 1; },
    (o) => { delete o.answers[0].from; },
    (o) => { o.answers[0].from = Array(9).fill('r1'); },
    (o) => { o.answers[0].option_ids = Array(21).fill('o1'); },
    (o) => { o.cover_letter.paragraphs = Array(6).fill({ text: 'a', from: [] }); },
    (o) => { o.cover_letter.paragraphs[0].text = 'x'.repeat(901); },
    (o) => { delete o.suspicious_instructions; },
    (o) => { o.answers = null; },
  ];
  for (const mut of bads) {
    const o = good();
    mut(o);
    assert.equal(validateAnswers(o).ok, false);
  }
});

test('the bank_key enum is exactly the bank keys plus empty', () => {
  assert.deepEqual(ANSWER_SCHEMA.properties.answers.items.properties.bank_key.enum, ['', ...BANK_KEYS]);
});
