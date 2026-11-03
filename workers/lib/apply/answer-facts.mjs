// Fact check for drafted answers and cover letters. Pure: no env, no I/O. The
// console imports it too, to flag her own edits.
//
// Same limit as resume/facts.mjs, stated plainly: this catches added numbers,
// dates, tools, links, employers and claims lifted from the posting. It cannot
// catch a rephrasing that overstates a fact using only words the master already
// has. Her review is the last gate.

import {
  numbers, urls, properish, stem, words, masterIndex, MARKUP, NUMBER_WORDS, MONTHS, INJECTION, STOP,
} from '../resume/facts.mjs';
import { hasLongDash } from './chars.mjs';

export const LONG_DASH = { test: hasLongDash };
const PERSONAL = /\b(salary|salaries|gehalt\w*|notice period|k[uü]ndigungsfrist|visa|sponsorship|work permit|aufenthalts\w*)\b/i;
const TOOL_Q = /\b(experience (?:with|in)|familiar(?:ity)? with|worked with|proficien\w* (?:in|with)|knowledge of|erfahrung (?:mit|in)|kenntnisse (?:in|mit|von)|vertraut mit)\b(.*)$/i;
const FIRST_PERSON = /\b(i|my|i've|i'm|i'd|ich|mein\w*)\b/i;
const SECOND_PERSON = /\b(you|your|you're|du|dein\w*|ihr\w*|sie)\b/i;
const GENERIC = new Set(['tool', 'tools', 'technology', 'technologies', 'software', 'system', 'systems', 'platform', 'platforms',
  'language', 'languages', 'framework', 'frameworks', 'application', 'applications', 'development', 'engineering', 'similar',
  'related', 'other', 'others', 'such', 'etc', 'stack', 'workflow', 'workflows', 'tooling', 'environment', 'environments']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_OK = /^[\w.+%-]{1,40}$/;

function terms(label, asked) {
  const out = new Set();
  for (const w of properish(label)) out.add(w.toLowerCase());
  const m = TOOL_Q.exec(label);
  if (m) {
    for (const w of words(m[2])) {
      const lw = w.toLowerCase();
      if (lw.length >= 3 && !STOP.has(lw) && !GENERIC.has(lw) && !/^\d+$/.test(lw)) out.add(lw);
    }
  }
  for (const a of asked || []) for (const w of words(a)) out.add(w.toLowerCase());
  for (const g of GENERIC) out.delete(g);
  return [...out].filter((w) => !['do', 'have', 'you'].includes(w));
}

function context(master, job, description) {
  const flat = [];
  (function walkStrings(v) {
    if (typeof v === 'string') flat.push(v);
    else if (Array.isArray(v)) v.forEach(walkStrings);
    else if (v && typeof v === 'object') Object.values(v).forEach(walkStrings);
  })(master);
  const text = flat.join('\n');
  const vocab = new Set(words(text).map((w) => w.toLowerCase()));
  const vocabStem = new Set([...vocab, ...[...vocab].map(stem)]);
  const poolOf = (t) => {
    const set = new Set();
    for (const n of numbers(t)) { set.add(n); set.add(`core:${n.replace(/[%+kKmM]$/, '')}`); }
    return set;
  };
  const MONTH_NAMES = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/;
  const postingWords = new Set(words(description).map((w) => w.toLowerCase()));
  const own = new Set([...words(job.company), ...words(job.title)].map((w) => w.toLowerCase()));
  const { src, ids } = masterIndex(master);
  return {
    text, lower: text.toLowerCase(), vocab, vocabStem, poolOf, masterPool: poolOf(text), src, ids,
    masterMonths: new Set([...vocab].filter((w) => MONTH_NAMES.test(w)).map((w) => w.slice(0, 3))),
    masterYears: new Set(text.match(/\b(?:19|20)\d{2}\b/g) || []),
    postingWords, postingStems: new Set([...postingWords].map(stem)), own,
    company: String(job.company || '').trim().toLowerCase(),
  };
}

const numberOk = (n, pool) => pool.has(n) || (!/[%+kKmM]$/.test(n) && pool.has(`core:${n}`));

/** Every scan of one piece of text. H and S record hard and soft flags. */
function scan(ref, text, from, ctx, H, S, charLimit) {
  if (MARKUP.test(text)) H('markup', ref);
  if (LONG_DASH.test(text)) H('long_dash', ref);
  for (const u of urls(text)) H('contact_or_url', ref, u); // any link, even one in the master: links come only from her saved answers
  const pool = from ? ctx.poolOf(from.map((id) => ctx.src.get(id) || '').join(' ')) : ctx.masterPool;
  for (const n of numbers(text)) if (!numberOk(n, pool)) H('number_not_in_source', ref, n);
  for (const m of text.matchAll(NUMBER_WORDS)) if (!ctx.lower.includes(m[0].toLowerCase())) H('number_word', ref, m[0].toLowerCase());
  for (const y of text.match(/\b(?:19|20)\d{2}\b/g) || []) if (!ctx.masterYears.has(y)) H('date_not_in_master', ref, y);
  for (const m of text.matchAll(MONTHS)) {
    const name = (m[1] || m[2] || m[3]).toLowerCase();
    if (!ctx.masterMonths.has(name.slice(0, 3))) H('date_not_in_master', ref, name);
  }
  const personal = PERSONAL.exec(text);
  if (personal) H('personal_fact', ref, personal[1].toLowerCase());

  // A first-person claim about something only the posting names.
  const companyRe = ctx.company.length >= 3 ? new RegExp(`(^|[^\\p{L}\\p{N}])${esc(ctx.company)}($|[^\\p{L}\\p{N}])`, 'iu') : null;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!FIRST_PERSON.test(sentence)) continue;
    if (SECOND_PERSON.test(sentence) || (companyRe && companyRe.test(sentence))) continue;
    for (const w of properish(sentence)) {
      const lw = w.toLowerCase();
      if (!ctx.vocab.has(lw) && ctx.postingWords.has(lw) && !ctx.own.has(lw)) H('claim_from_posting', ref, w);
    }
  }

  for (const w of properish(text)) {
    const lw = w.toLowerCase();
    if (ctx.vocab.has(lw) || ctx.own.has(lw)) continue;
    S(ctx.postingWords.has(lw) ? 'posting_term' : 'proper_noun', ref, w);
  }
  const seen = new Set();
  for (const w of words(text)) {
    if (w !== w.toLowerCase() || !/^\p{L}{4,}$/u.test(w)) continue;
    const s = stem(w);
    if (STOP.has(w) || STOP.has(s) || ctx.vocabStem.has(w) || ctx.vocabStem.has(s) || ctx.own.has(w)) continue;
    if ((ctx.postingStems.has(s) || ctx.postingWords.has(w)) && !seen.has(w)) { seen.add(w); S('posting_term', ref, w); }
  }
  if (charLimit && text.length > charLimit) S('over_char_limit', ref);
}

/**
 * checkAnswers({ answers, cover, form, master, job, description, sent })
 *   answers  the model's answers after dash normalisation
 *   cover    the model's cover letter paragraphs, [] when none
 *   sent     ids of the questions that were sent to the model (rule-decided ones were not)
 *
 * @returns {{ hard: { code: string, ref: string, token: string }[], soft: { code: string, ref: string, token: string }[] }}
 */
export function checkAnswers({ answers = [], cover = [], form, master, job = {}, description = '', sent = null }) {
  const hard = [];
  const soft = [];
  const tok = (t) => (TOKEN_OK.test(t) ? t : '');
  const H = (code, ref, token = '') => hard.push({ code, ref, token: tok(token) });
  const S = (code, ref, token = '') => soft.push({ code, ref, token: tok(token) });
  const ctx = context(master, job, description);
  const byId = new Map(form.questions.map((q) => [q.id, q]));
  const allowed = sent ? new Set(sent) : new Set(byId.keys());
  const seen = new Set();

  const evidence = (ref, from) => {
    if (!from?.length) { H('no_evidence', ref); return false; }
    let ok = true;
    for (const id of from) if (!ctx.ids.has(id)) { H('bad_ref', ref, id); ok = false; }
    return ok;
  };
  const sourceText = (from) => from.map((id) => ctx.src.get(id) || '').join(' ');

  for (const a of answers) {
    const ref = `a.${a.q}`;
    const q = byId.get(a.q);
    if (!q || !allowed.has(a.q) || seen.has(a.q)) { H('bad_question', ref); continue; }
    seen.add(a.q);
    if (a.cls === 'fixed') {
      if (!a.bank_key) H('schema_invalid', ref);
      else S('fixed_by_model', ref, a.bank_key);
      continue;
    }
    if (a.cls !== 'drafted') continue;

    const optioned = q.kind === 'single_select' || q.kind === 'multi_select';
    if (optioned || a.option_ids.length) {
      const have = new Set(q.options.map((o) => o.id));
      if (!optioned || !a.option_ids.length || a.option_ids.some((o) => !have.has(o))) H('bad_option', ref);
      else if (q.kind === 'single_select' && a.option_ids.length !== 1) H('bad_option', ref);
    }
    const good = evidence(ref, a.from);
    if (a.text) scan(ref, a.text, good ? a.from : null, ctx, H, S, q.char_limit);

    if (TOOL_Q.test(q.label) || (a.asked_terms || []).length) {
      const cited = good ? sourceText(a.from) : '';
      const citedVocab = new Set(words(cited).flatMap((w) => [w.toLowerCase(), stem(w)]));
      for (const term of terms(q.label, a.asked_terms)) {
        const inMaster = ctx.vocabStem.has(term) || ctx.vocabStem.has(stem(term));
        const inCited = citedVocab.has(term) || citedVocab.has(stem(term));
        if (!inMaster || !inCited) { H('tool_unsupported', ref, term); break; }
      }
    }
  }
  cover.forEach((p, i) => {
    const ref = `cover.${i}`;
    const good = evidence(ref, p.from);
    scan(ref, p.text, good ? p.from : null, ctx, H, S, 0);
  });
  if (INJECTION.test(description)) S('suspicious_posting', 'posting');
  return { hard, soft };
}

/**
 * Her own edit: the same scans, but nothing is hard. She is the source of her
 * own facts, so the flags only point at what to double check.
 */
export function checkEditedText({ text, label = '', master, job = {}, description = '', charLimit = 0 }) {
  const soft = [];
  const ctx = context(master, job, description);
  const tok = (t) => (TOKEN_OK.test(t) ? t : '');
  const S = (code, ref, token = '') => soft.push({ code, ref, token: tok(token) });
  scan('edit', String(text ?? ''), null, ctx, S, S, charLimit);
  void label;
  return soft;
}
