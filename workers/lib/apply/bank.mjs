// Her saved answers: which keys exist, how a value is checked, and how a saved
// value is turned into an answer for one question. Pure and browser-safe.
//
// The worker imports the key list only. It never reads a value: the table has no
// grant for the service role, and a draft stores { cls: 'fixed', bank_key } while
// the value is joined in later, in her own browser session (resolveFixed).
// No value is seeded anywhere.

import { stripInvisible } from './chars.mjs';

export const BANK = [
  { key: 'full_name', label: 'Full name', section: 'Identity', type: 'text' },
  { key: 'first_name', label: 'First name', section: 'Identity', type: 'text' },
  { key: 'last_name', label: 'Last name', section: 'Identity', type: 'text' },
  { key: 'email', label: 'Email', section: 'Identity', type: 'text' },
  { key: 'phone', label: 'Phone', section: 'Identity', type: 'text' },
  { key: 'city', label: 'City', section: 'Identity', type: 'text' },
  { key: 'country', label: 'Country', section: 'Identity', type: 'text' },
  { key: 'current_location', label: 'Current location', section: 'Identity', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn', section: 'Links', type: 'url' },
  { key: 'github_url', label: 'GitHub', section: 'Links', type: 'url' },
  { key: 'portfolio_url', label: 'Portfolio', section: 'Links', type: 'url' },
  { key: 'website_url', label: 'Website', section: 'Links', type: 'url' },
  { key: 'visa_status', label: 'Visa or residence status', section: 'Work authorization', type: 'text' },
  { key: 'work_auth_de', label: 'Allowed to work in Germany', section: 'Work authorization', type: 'yesno' },
  { key: 'work_auth_eu', label: 'Allowed to work in the EU', section: 'Work authorization', type: 'yesno' },
  { key: 'needs_sponsorship_de', label: 'Needs sponsorship for Germany', section: 'Work authorization', type: 'yesno' },
  { key: 'notice_period', label: 'Notice period', section: 'Availability', type: 'text' },
  { key: 'earliest_start', label: 'Earliest start', section: 'Availability', type: 'text' },
  { key: 'willing_to_relocate', label: 'Willing to relocate', section: 'Availability', type: 'yesno' },
  { key: 'remote_preference', label: 'Remote preference', section: 'Availability', type: 'text' },
  // One free-text value: a number, or a range with currency. Editable per job.
  { key: 'salary_expectation', label: 'Salary expectation', section: 'Pay', type: 'text' },
];

export const BANK_KEYS = BANK.map((b) => b.key);
export const YESNO_KEYS = BANK.filter((b) => b.type === 'yesno').map((b) => b.key);
export const URL_KEYS = BANK.filter((b) => b.type === 'url').map((b) => b.key);
export const BANK_SECTIONS = ['Identity', 'Links', 'Work authorization', 'Availability', 'Pay'];
export const MAX_BANK_VALUE = 1000;


/**
 * Checks and cleans one saved value. An empty value is valid and means "remove".
 * Salary is free text on purpose (a range with currency is a normal value).
 * @returns {{ ok: true, value: string } | { ok: false, code: string }}
 */
export function cleanBankValue(key, raw) {
  if (!BANK_KEYS.includes(key)) return { ok: false, code: 'bad_key' };
  const value = stripInvisible(raw).replace(/[ \t]+/g, ' ').trim();
  if (value.length > MAX_BANK_VALUE) return { ok: false, code: 'too_long' };
  if (!value) return { ok: true, value: '' };
  if (YESNO_KEYS.includes(key)) {
    const v = value.toLowerCase();
    if (v !== 'yes' && v !== 'no') return { ok: false, code: 'yes_or_no' };
    return { ok: true, value: v };
  }
  if (URL_KEYS.includes(key) && !/^https:\/\/[^\s]+$/i.test(value)) return { ok: false, code: 'https_only' };
  return { ok: true, value };
}

const YES = /^(yes|ja)\b/i;
const NO = /^(no|nein)\b/i;

/**
 * The answer a fixed item gives for one question, from her saved values.
 *
 *   item      { bank_key }
 *   question  { kind, options: [{ id, label }] }
 *   bank      { key: value }, what she saved (may be empty)
 *   edit      { text?, option_ids? }, what she typed for this job, if anything
 *
 * Returns { state: 'ready' | 'edited' | 'needs_you', text?, option_ids?, hint? }.
 * A select is answered only on an exact, unique match. No match gives Needs you
 * with her saved value as a hint, never a guessed option.
 */
export function resolveFixed(item, question, bank, edit) {
  if (edit && (edit.text || edit.option_ids?.length)) {
    return { state: 'edited', text: edit.text ?? '', option_ids: edit.option_ids ?? [] };
  }
  const value = String((bank || {})[item?.bank_key] ?? '').trim();
  if (!value) return { state: 'needs_you' };
  const options = question?.options || [];
  const isSelect = question?.kind === 'single_select' || question?.kind === 'multi_select' || (question?.kind === 'yes_no' && options.length > 0);
  if (!isSelect) {
    if (YESNO_KEYS.includes(item.bank_key)) return { state: 'ready', text: value === 'yes' ? 'Yes' : 'No' };
    return { state: 'ready', text: value };
  }
  const exact = options.filter((o) => o.label.trim().toLowerCase() === value.toLowerCase());
  if (exact.length === 1) return { state: 'ready', option_ids: [exact[0].id], text: exact[0].label };
  if (!exact.length && YESNO_KEYS.includes(item.bank_key)) {
    const re = value.toLowerCase() === 'yes' ? YES : NO;
    const hits = options.filter((o) => re.test(o.label.trim()));
    if (hits.length === 1) return { state: 'ready', option_ids: [hits[0].id], text: hits[0].label };
  }
  return { state: 'needs_you', hint: value };
}
