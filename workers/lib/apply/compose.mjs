// Joins what the rules decided with what the model answered. Pure: no env, no I/O.
//
// One bad answer never loses the rest: an answer that still carries a hard flag
// becomes "needs you", and every other answer is kept.

import { noLongDashes } from './chars.mjs';

export const COVER_MAX = 6000;

/**
 * No em or en dashes in anything we store. A digit range keeps a hyphen, an aside
 * becomes a comma, and the other dash and minus lookalikes become a hyphen.
 */
export function normAnswer(text) {
  return noLongDashes(text).replace(/[ 	]+/g, ' ').trim();
}

/** Normalises every piece of text in a validated model output. Pure copy. */
export function normalizeOutput(out) {
  return {
    ...out,
    answers: out.answers.map((a) => ({ ...a, text: normAnswer(a.text) })),
    cover_letter: { paragraphs: out.cover_letter.paragraphs.map((p) => ({ ...p, text: normAnswer(p.text) })) },
  };
}

export const coverText = (paragraphs) => paragraphs.map((p) => p.text).join('\n\n').slice(0, COVER_MAX);

/**
 * @param {{ form: any, rules: { items: any[] }, output: any | null, failed?: Map<string, string>, cover?: string }} input
 *   failed  question id to why code for answers that still had a hard flag
 *   cover   the finished cover letter text, or '' when none was made
 * @returns {{ answers: any[], counts: { fixed: number, drafted: number, need: number, blank: number, product: number } }}
 */
export function composeAnswers({ form, rules, output, failed = new Map(), cover = '' }) {
  const rule = new Map(rules.items.map((i) => [i.q, i]));
  const model = new Map((output?.answers || []).map((a) => [a.q, a]));
  const answers = [];
  for (const q of form.questions) {
    const r = rule.get(q.id);
    if (r) {
      if (r.source === 'cover') {
        answers.push(cover ? { q: q.id, cls: 'drafted', source: 'cover', text: cover } : { q: q.id, cls: 'needs_you', why: 'cover_failed' });
      } else answers.push({ ...r });
      continue;
    }
    const a = model.get(q.id);
    if (failed.has(q.id)) { answers.push({ q: q.id, cls: 'needs_you', why: failed.get(q.id) }); continue; }
    if (!a) { answers.push({ q: q.id, cls: 'needs_you', why: 'no_answer' }); continue; }
    if (a.cls === 'drafted') {
      if (!a.text && !a.option_ids.length) answers.push({ q: q.id, cls: 'needs_you', why: 'no_answer' });
      else answers.push({ q: q.id, cls: 'drafted', text: a.text, option_ids: a.option_ids, from: a.from });
    } else if (a.cls === 'product') {
      // General knowledge, no CV source. Never a select: option_ids stays empty.
      if (!a.text) answers.push({ q: q.id, cls: 'needs_you', why: 'no_answer' });
      else answers.push({ q: q.id, cls: 'product', text: a.text });
    } else if (a.cls === 'fixed') answers.push({ q: q.id, cls: 'fixed', bank_key: a.bank_key, by_model: true });
    else if (a.cls === 'blank') answers.push({ q: q.id, cls: 'blank' });
    else answers.push({ q: q.id, cls: 'needs_you', why: 'model' });
  }
  const count = (cls) => answers.filter((a) => a.cls === cls).length;
  return { answers, counts: { fixed: count('fixed'), drafted: count('drafted'), need: count('needs_you'), blank: count('blank'), product: count('product') } };
}
