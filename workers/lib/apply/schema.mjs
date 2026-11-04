// The normalised form and the only shape Claude may answer an application in.
// Pure: no env, no I/O. Imported by the worker and by the console's server actions.
//
// Every source (Greenhouse, Ashby, Lever, pasted text) ends up as a Form, and
// validateForm runs on all of them, so a hostile page cannot hand the rest of the
// system more than these limits allow.

import { walk } from '../resume/schema.mjs';
import { BANK_KEYS } from './bank.mjs';
import { stripInvisible, toPlainLines } from './chars.mjs';

export const LIMITS = { questions: 60, label: 500, help: 500, options: 300, optionLabel: 200, pasted: 20000 };
export const KINDS = ['short_text', 'long_text', 'single_select', 'multi_select', 'yes_no', 'file', 'date', 'number', 'url', 'email', 'phone', 'unknown'];
export const GROUPS = ['main', 'location', 'compliance', 'demographic'];
export const ROLES = ['none', 'resume_file', 'cover_letter'];
export const SOURCES = ['greenhouse', 'ashby', 'lever', 'browser', 'paste'];

/** Plain, single-line, no invisible or direction-changing characters. */
export function cleanLabel(s, max = LIMITS.label) {
  return stripInvisible(s, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Multi-line text (answers, pasted lines) with the same character removal. */
export function cleanBlock(s, max) {
  return toPlainLines(s)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** FNV-1a, 32 bit, as 8 hex characters. Not a security hash: ids only. */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Stable across re-reads, so a draft's edits survive a re-read of the same form. */
export const questionId = (label, field = '') => `q_${fnv1a(`${norm(label)}|${norm(field)}`)}`;

/** Hash of the question set. Same questions in the same order give the same sha. */
export const formSha = (form) =>
  fnv1a(JSON.stringify((form?.questions || []).map((q) => [q.id, q.kind, q.required, (q.options || []).map((o) => o.label)])))
  + fnv1a(String((form?.questions || []).length));

const pick = (v, list, d) => (list.includes(v) ? v : d);

/**
 * Cleans and checks a form from any source.
 * Returns { ok: true, form } with cleaned labels, ids made unique and limits
 * applied (extra questions or options are cut and the form is marked
 * may_be_incomplete), or { ok: false, ref } for something that is not a form.
 */
export function validateForm(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return { ok: false, ref: '$.questions' };
  const source = pick(raw.source, SOURCES, null);
  if (!source) return { ok: false, ref: '$.source' };
  const reasons = new Set((Array.isArray(raw.partial_reasons) ? raw.partial_reasons : []).map((r) => cleanLabel(r, 40)).filter((r) => /^[a-z_]{2,40}$/.test(r)));
  let complete = raw.completeness === 'complete';

  let list = raw.questions;
  if (list.length > LIMITS.questions) {
    list = list.slice(0, LIMITS.questions);
    reasons.add('too_many_questions');
    complete = false;
  }

  const seen = new Set();
  const questions = [];
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || typeof q !== 'object') return { ok: false, ref: `$.questions.${i}` };
    const label = cleanLabel(q.label);
    if (!label) return { ok: false, ref: `$.questions.${i}.label` };
    let id = typeof q.id === 'string' && /^q_[0-9a-f]{8}(_\d)?$/.test(q.id) ? q.id : questionId(label, q.field || '');
    for (let n = 2; seen.has(id); n++) id = `${id.replace(/_\d$/, '')}_${n}`;
    seen.add(id);

    let options = Array.isArray(q.options) ? q.options : [];
    let optionsKnown = q.options_known !== false;
    if (options.length > LIMITS.options) {
      options = options.slice(0, LIMITS.options);
      optionsKnown = false;
      reasons.add('options_cut');
      complete = false;
    }
    const cleaned = [];
    for (const o of options) {
      const l = cleanLabel(typeof o === 'string' ? o : o?.label, LIMITS.optionLabel);
      if (l) cleaned.push({ id: `o${cleaned.length}`, label: l });
    }
    const kind = pick(q.kind, KINDS, 'unknown');
    if (kind === 'unknown') complete = false;
    const limit = Number(q.char_limit);
    const out = {
      id, label,
      kind,
      required: q.required === true ? true : q.required === false ? false : null,
      options: cleaned,
      options_known: optionsKnown,
      group: pick(q.group, GROUPS, 'main'),
      role: pick(q.role, ROLES, 'none'),
    };
    const help = cleanLabel(q.help, LIMITS.help);
    if (help) out.help = help;
    if (Number.isFinite(limit) && limit > 0) out.char_limit = Math.min(Math.trunc(limit), 100000);
    questions.push(out);
  }
  if (!questions.length) return { ok: false, ref: '$.questions' };
  if (!complete && !reasons.size) reasons.add('unspecified');
  const form = {
    schema: 1, source,
    completeness: complete ? 'complete' : 'may_be_incomplete',
    partial_reasons: complete ? [] : [...reasons].slice(0, 10),
    questions,
  };
  return { ok: true, form };
}

// ---------------------------------------------------------------------------
// What Claude may answer. No nullable fields: walk() has none.
// ---------------------------------------------------------------------------
const str = (maxLength) => ({ type: 'string', minLength: 1, maxLength });

export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['answers', 'cover_letter', 'suspicious_instructions'],
  properties: {
    answers: { type: 'array', maxItems: LIMITS.questions, items: {
      type: 'object', additionalProperties: false,
      required: ['q', 'cls', 'bank_key', 'text', 'from', 'option_ids', 'asked_terms'],
      properties: {
        q: str(16),
        cls: { enum: ['drafted', 'needs_you', 'blank', 'fixed', 'product'] },
        bank_key: { enum: ['', ...BANK_KEYS] },
        text: { type: 'string', maxLength: 3000 },
        from: { type: 'array', maxItems: 8, items: str(12) },
        option_ids: { type: 'array', maxItems: 20, items: str(6) },
        asked_terms: { type: 'array', maxItems: 10, items: str(60) },
      },
    } },
    cover_letter: { type: 'object', additionalProperties: false, required: ['paragraphs'], properties: {
      paragraphs: { type: 'array', maxItems: 5, items: {
        type: 'object', additionalProperties: false, required: ['text', 'from'],
        properties: { text: { type: 'string', minLength: 1, maxLength: 900 }, from: { type: 'array', maxItems: 8, items: str(12) } },
      } },
    } },
    suspicious_instructions: { type: 'boolean' },
  },
};

/** Re-checks everything by hand, as validateDraft does. */
export function validateAnswers(obj) {
  const bad = walk(ANSWER_SCHEMA, obj, '$');
  return bad ? { ok: false, code: 'schema_invalid', ref: bad } : { ok: true, code: null };
}
