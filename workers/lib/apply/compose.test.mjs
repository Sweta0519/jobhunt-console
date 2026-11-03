import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normAnswer, normalizeOutput, composeAnswers, coverText, COVER_MAX } from './compose.mjs';
import { classifyForm } from './classify.mjs';
import { validateForm } from './schema.mjs';
import { hasLongDash } from './chars.mjs';

const cp = (n) => String.fromCodePoint(n);

test('normAnswer leaves no long dash: ranges keep a hyphen, asides become commas', () => {
  const all = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d];
  for (const n of all) assert.equal(hasLongDash(normAnswer(`a${cp(n)}b`)), false, n.toString(16));
  assert.equal(normAnswer(`2019${cp(0x2013)}2021`), '2019-2021');
  assert.equal(normAnswer(`I fixed it ${cp(0x2014)} fast`), 'I fixed it, fast');
  assert.equal(normAnswer(`well${cp(0x2011)}known`), 'well-known');
  assert.equal(normAnswer('  a   b  '), 'a b');
});

test('normalizeOutput normalises every answer and every cover paragraph', () => {
  const out = normalizeOutput({
    answers: [{ q: 'q_1', text: `a${cp(0x2014)}b` }], suspicious_instructions: false,
    cover_letter: { paragraphs: [{ text: `c${cp(0x2013)}d`, from: [] }] },
  });
  assert.ok(!hasLongDash(JSON.stringify(out)));
});

function world() {
  const { form } = validateForm({ source: 'greenhouse', completeness: 'complete', questions: [
    { label: 'Email', kind: 'email' },
    { label: 'Why us?', kind: 'long_text' },
    { label: 'Describe a project', kind: 'long_text' },
    { label: 'Gender', kind: 'short_text' },
    { label: 'Resume', kind: 'file' },
    { label: 'Anything else?', kind: 'long_text' },
    { label: 'Phone number please', kind: 'short_text', group: 'main' },
  ] });
  const rules = classifyForm(form, {});
  return { form, rules, id: (i) => form.questions[i].id };
}
const ma = (q, o = {}) => ({ q, cls: 'drafted', bank_key: '', text: 'text', from: ['r1'], option_ids: [], asked_terms: [], ...o });

test('rules and model answers are joined in form order', () => {
  const { form, rules, id } = world();
  const output = { answers: [ma(id(1)), ma(id(2), { cls: 'needs_you', text: '' }), ma(id(5), { cls: 'fixed', bank_key: 'city', text: '' })] };
  const r = composeAnswers({ form, rules, output });
  assert.deepEqual(r.answers.map((a) => a.q), form.questions.map((q) => q.id));
  const by = (i) => r.answers.find((a) => a.q === id(i));
  assert.deepEqual([by(0).cls, by(0).bank_key], ['fixed', 'email']);
  assert.equal(by(1).cls, 'drafted');
  assert.equal(by(2).cls, 'needs_you');
  assert.equal(by(3).cls, 'blank');
  assert.equal(by(4).cls, 'upload');
  assert.deepEqual([by(5).cls, by(5).bank_key, by(5).by_model], ['fixed', 'city', true]);
  assert.deepEqual(r.counts, { fixed: 3, drafted: 1, need: 1, blank: 1 });
});

test('one bad answer never loses the rest', () => {
  const { form, rules, id } = world();
  const output = { answers: [ma(id(1)), ma(id(2)), ma(id(5))] };
  const r = composeAnswers({ form, rules, output, failed: new Map([[id(2), 'facts_failed']]) });
  const by = (i) => r.answers.find((a) => a.q === id(i));
  assert.deepEqual([by(2).cls, by(2).why], ['needs_you', 'facts_failed']);
  assert.equal(by(1).cls, 'drafted');
  assert.equal(by(5).cls, 'drafted');
});

test('a missing, empty or unknown answer becomes needs_you, never a blank text', () => {
  const { form, rules, id } = world();
  const r = composeAnswers({ form, rules, output: { answers: [ma(id(1), { text: '' })] } });
  const by = (i) => r.answers.find((a) => a.q === id(i));
  assert.equal(by(1).why, 'no_answer');
  assert.equal(by(2).why, 'no_answer');
  assert.equal(composeAnswers({ form, rules, output: null }).answers.length, form.questions.length);
});

test('a cover letter question gets the finished letter, or needs you when there is none', () => {
  const { form } = validateForm({ source: 'greenhouse', completeness: 'complete', questions: [{ label: 'Cover letter', kind: 'long_text' }] });
  const rules = classifyForm(form, {});
  const ok = composeAnswers({ form, rules, output: null, cover: 'Dear team' });
  assert.deepEqual([ok.answers[0].cls, ok.answers[0].source, ok.answers[0].text], ['drafted', 'cover', 'Dear team']);
  assert.equal(composeAnswers({ form, rules, output: null, cover: '' }).answers[0].why, 'cover_failed');
});

test('coverText joins paragraphs and caps the length', () => {
  assert.equal(coverText([{ text: 'a' }, { text: 'b' }]), 'a\n\nb');
  assert.equal(coverText([{ text: 'x'.repeat(COVER_MAX + 50) }]).length, COVER_MAX);
});
