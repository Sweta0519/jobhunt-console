import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANK, BANK_KEYS, YESNO_KEYS, cleanBankValue, resolveFixed } from './bank.mjs';

const opts = (...labels) => labels.map((label, i) => ({ id: `o${i}`, label }));
const sel = (...labels) => ({ kind: 'single_select', options: opts(...labels) });

test('the key list is the design list and nothing is seeded', () => {
  assert.equal(BANK_KEYS.length, 21);
  assert.ok(BANK.every((b) => !('value' in b) && !('default' in b)));
  assert.deepEqual(YESNO_KEYS.sort(), ['needs_sponsorship_de', 'willing_to_relocate', 'work_auth_de', 'work_auth_eu']);
});

test('an empty bank renders Needs you for every key and every question shape', () => {
  for (const key of BANK_KEYS) {
    for (const q of [{ kind: 'short_text', options: [] }, sel('Yes', 'No'), { kind: 'yes_no', options: [] }]) {
      assert.equal(resolveFixed({ bank_key: key }, q, {}).state, 'needs_you');
      assert.equal(resolveFixed({ bank_key: key }, q, { [key]: '   ' }).state, 'needs_you');
    }
  }
});

test('filling the bank resolves a draft with no worker call', () => {
  const item = { bank_key: 'notice_period' };
  const q = { kind: 'short_text', options: [] };
  assert.equal(resolveFixed(item, q, {}).state, 'needs_you');
  const r = resolveFixed(item, q, { notice_period: '3 months' });
  assert.deepEqual([r.state, r.text], ['ready', '3 months']);
});

test('salary is one free-text value and accepts a range with currency', () => {
  for (const v of ['65000', '60,000 - 70,000 EUR', 'EUR 60k to 70k gross, negotiable', '55.000 bis 65.000 Euro']) {
    assert.deepEqual(cleanBankValue('salary_expectation', v), { ok: true, value: v });
  }
  const q = { kind: 'short_text', options: [] };
  assert.equal(resolveFixed({ bank_key: 'salary_expectation' }, q, { salary_expectation: '60,000 - 70,000 EUR' }).text, '60,000 - 70,000 EUR');
});

test('a per-job edit wins over the saved value', () => {
  const r = resolveFixed({ bank_key: 'salary_expectation' }, { kind: 'short_text', options: [] }, { salary_expectation: 'saved' }, { text: 'for this job' });
  assert.deepEqual([r.state, r.text], ['edited', 'for this job']);
});

test('a select matches only an exact, unique option', () => {
  const item = { bank_key: 'city' };
  const hit = resolveFixed(item, sel('Berlin', 'Munich'), { city: ' berlin ' });
  assert.deepEqual([hit.state, hit.option_ids], ['ready', ['o0']]);
  const miss = resolveFixed(item, sel('Berlin, Germany', 'Munich'), { city: 'Berlin' });
  assert.equal(miss.state, 'needs_you');
  assert.equal(miss.hint, 'Berlin', 'her saved value is shown as a hint');
  assert.equal(miss.option_ids, undefined, 'never a guessed option');
  const dup = resolveFixed(item, sel('Berlin', 'berlin'), { city: 'Berlin' });
  assert.equal(dup.state, 'needs_you');
});

test('yes/no keys map to a unique Yes or No style option, else no selection', () => {
  const item = { bank_key: 'work_auth_de' };
  assert.deepEqual(resolveFixed(item, sel('Yes', 'No'), { work_auth_de: 'yes' }).option_ids, ['o0']);
  assert.deepEqual(resolveFixed(item, sel('Ja', 'Nein'), { work_auth_de: 'no' }).option_ids, ['o1']);
  assert.deepEqual(resolveFixed(item, sel('Yes, I am', 'No, I am not'), { work_auth_de: 'no' }).option_ids, ['o1']);
  const two = resolveFixed(item, sel('Yes, now', 'Yes, later', 'No'), { work_auth_de: 'yes' });
  assert.equal(two.state, 'needs_you');
  assert.equal(two.hint, 'yes');
  assert.equal(resolveFixed(item, sel('Maybe', 'Unsure'), { work_auth_de: 'yes' }).state, 'needs_you');
  assert.equal(resolveFixed(item, { kind: 'yes_no', options: [] }, { work_auth_de: 'no' }).text, 'No');
  assert.equal(resolveFixed(item, { kind: 'short_text', options: [] }, { work_auth_de: 'yes' }).text, 'Yes');
});

test('cleanBankValue: keys, length, yes/no, https only, empty removes', () => {
  assert.equal(cleanBankValue('nope', 'x').code, 'bad_key');
  assert.equal(cleanBankValue('city', 'x'.repeat(1001)).code, 'too_long');
  assert.deepEqual(cleanBankValue('city', 'x'.repeat(1000)).ok, true);
  assert.deepEqual(cleanBankValue('city', '   '), { ok: true, value: '' });
  assert.deepEqual(cleanBankValue('work_auth_de', ' YES '), { ok: true, value: 'yes' });
  assert.equal(cleanBankValue('work_auth_de', 'maybe').code, 'yes_or_no');
  assert.equal(cleanBankValue('linkedin_url', 'http://x.example').code, 'https_only');
  assert.equal(cleanBankValue('linkedin_url', 'javascript:alert(1)').code, 'https_only');
  assert.equal(cleanBankValue('linkedin_url', 'https://example.invalid/me').ok, true);
  assert.equal(cleanBankValue('city', `Ber${String.fromCodePoint(0x200b)}lin${String.fromCodePoint(0)}`).value, 'Berlin');
});
