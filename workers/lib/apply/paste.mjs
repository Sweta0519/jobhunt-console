// Questions she pasted from the real form. Pure: no env, no I/O. Used by the
// console's server action (to reject early) and again by the worker, which never
// trusts that the action ran.
//
// Format, one thing per line:
//   a non-empty line is a question
//   a following line starting with "- " or "* " is an option of that question
//   a trailing "*" or "(required)" marks it required
// Error codes are fixed strings. Pasted text is never echoed or logged.

import { LIMITS, cleanLabel, cleanBlock, validateForm, questionId } from './schema.mjs';

const LONG = /cover letter|anschreiben|why |tell us|describe|explain|warum|beschreib|motivation|about yourself|[uü]ber sich/i;
const UPLOAD = /\b(upload|attach|hochladen|anh[aä]ngen)\b/i;
const RESUME = /\b(resume|cv|lebenslauf)\b/i;

function kindOf(label, hasOptions) {
  if (hasOptions) return { kind: 'single_select', role: 'none' };
  const l = label.toLowerCase();
  if (/\bcover letter\b|anschreiben/.test(l) && UPLOAD.test(l)) return { kind: 'file', role: 'cover_letter' };
  if (RESUME.test(l) && (UPLOAD.test(l) || /^(resume|cv|lebenslauf)(\s*\/\s*(cv|resume))?$/.test(l))) return { kind: 'file', role: 'resume_file' };
  if (UPLOAD.test(l)) return { kind: 'file', role: 'none' };
  if (/\be-?mail\b/.test(l)) return { kind: 'email', role: 'none' };
  if (/\b(phone|telefon)/.test(l)) return { kind: 'phone', role: 'none' };
  if (/^(are|do|did|have|will|can|is|would|sind|haben|k[oö]nnen)\b.*\?$/.test(l) && l.length < 160) return { kind: 'yes_no', role: 'none' };
  if (LONG.test(l)) return { kind: 'long_text', role: LONG.test(l) && /cover letter|anschreiben/.test(l) ? 'cover_letter' : 'none' };
  return { kind: 'short_text', role: 'none' };
}

/**
 * @returns {{ ok: true, form: any } | { ok: false, code: 'empty' | 'too_long' | 'no_text' | 'no_questions' | 'invalid' }}
 */
export function parsePasted(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: false, code: 'empty' };
  if (raw.length > LIMITS.pasted) return { ok: false, code: 'too_long' };
  if (!/\p{L}/u.test(raw)) return { ok: false, code: 'no_text' };

  const blocks = [];
  for (const line of cleanBlock(raw, LIMITS.pasted).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const opt = /^[-*]\s+(.*)$/.exec(s);
    if (opt && blocks.length) {
      const label = cleanLabel(opt[1], LIMITS.optionLabel);
      if (label && blocks[blocks.length - 1].options.length < LIMITS.options) blocks[blocks.length - 1].options.push(label);
      continue;
    }
    let label = s.replace(/^[-*]\s+/, '');
    let required = null;
    const m = /(?:\s*\((?:required|pflichtfeld|erforderlich)\)|\s*\*)\s*$/i.exec(label);
    if (m) { required = true; label = label.slice(0, m.index); }
    label = cleanLabel(label);
    if (/\p{L}/u.test(label)) blocks.push({ label, required, options: [] });
  }
  if (!blocks.length) return { ok: false, code: 'no_questions' };

  const questions = blocks.slice(0, LIMITS.questions).map((b) => {
    const k = kindOf(b.label, b.options.length > 0);
    return {
      id: questionId(b.label), label: b.label, kind: k.kind, role: k.role, required: b.required,
      options: b.options, options_known: true, group: 'main',
    };
  });
  const v = validateForm({
    source: 'paste', completeness: 'may_be_incomplete',
    partial_reasons: blocks.length > LIMITS.questions ? ['pasted', 'too_many_questions'] : ['pasted'],
    questions,
  });
  return v.ok ? { ok: true, form: v.form } : { ok: false, code: 'invalid' };
}

/**
 * Merge pasted questions into a form already read. "add" keeps what is there and
 * adds or replaces by stable id (the way to paste the later pages of a multi-page
 * form); "replace" uses the pasted form alone. Either way the result stays
 * may_be_incomplete: she, not the reader, knows when the form is whole.
 */
export function mergeForms(base, added, mode) {
  if (mode !== 'add' || !base?.questions?.length) return added;
  const byId = new Map(base.questions.map((q) => [q.id, q]));
  for (const q of added.questions) byId.set(q.id, q);
  const v = validateForm({
    source: base.source, completeness: 'may_be_incomplete',
    partial_reasons: [...new Set([...(base.partial_reasons || []), 'pasted'])],
    questions: [...byId.values()],
  });
  return v.ok ? v.form : added;
}
