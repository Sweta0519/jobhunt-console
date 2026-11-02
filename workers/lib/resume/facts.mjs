// Fact checks on a composed document. Pure: no imports, no env.
//
// Limit, stated plainly: this catches added numbers, dates, tools, links and
// employers. It cannot catch a rephrasing that overstates a fact using only
// words the master already has ("led" for "helped with"). Her review is the
// last gate, and the diff highlight on the review page exists for that reason.

const NUMBER_RE = /(?<![\p{L}\d.])\d+(?:[.,]\d+)*(?:%|\+|[kKmM](?!\p{L}))?(?![\p{L}\d])/gu;
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}+#]*/gu;
const TLDS = 'com|io|org|net|dev|app|ai|co|de|eu';
const NUMBER_WORDS = /\b(dozens?|hundreds?|thousands?|millions?|billions?|twice|doubled|tripled|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-\w+)?|\w+ percent|percent)\b/gi;
const MONTHS = /\b(January|February|March|April|June|July|August|September|October|November|December)\b|\b(May)\s+(?:19|20)\d{2}\b|\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\.?\s+(?:19|20)\d{2}/g;
const INJECTION = /ignore (all|any|previous|prior)|system prompt|as an ai|language model|llm|ai (screener|assistant|tool)|\bassistant:/i;
const MARKUP = /<[a-z!/]|\]\(|\{\{|javascript:|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/i;

const STOP = new Set(('about above across after again also always another any are around because been before being between both '
  + 'bring build built can come could does doing done down each either else even ever every from give given going good great have '
  + 'having help here high into just keep know large like long look made make many may more most much must need never next only '
  + 'other over part people place real same should since some such take than that their them then there these they thing this '
  + 'those through time under until upon used using very want well were what when where which while will with within without '
  + 'work working works would your yours you our ours role team teams company companies job jobs experience years year day days '
  + 'new strong ability skills skill plus including include includes ensure related variety wide range based able').split(' '));

const words = (s) => String(s ?? '').match(WORD_RE) || [];
export const stem = (w) => {
  const x = w.toLowerCase();
  const y = x.replace(/(ing|ed|es|s|ly)$/, '');
  return y.length >= 4 ? y : x;
};

export const numbers = (s) => String(s ?? '').match(NUMBER_RE) || [];

/** Links, addresses, handles and phone-like digit runs. */
export function urls(s) {
  const t = String(s ?? '');
  const out = [];
  const add = (re) => { for (const m of t.matchAll(re)) out.push(m[0]); };
  add(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi);
  add(/\bwww\.\S+/gi);
  add(new RegExp(`\\b[\\w-]+\\.(?:${TLDS})\\b`, 'gi'));
  add(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
  add(/(?<![\w])@\w{2,}/g);
  for (const m of t.matchAll(/\+?\d[\d\s().-]{5,}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 7) continue;
    if (/^(?:(?:19|20)\d{2}[\s-]+)+(?:19|20)\d{2}$/.test(m[0].trim())) continue; // year ranges
    out.push(m[0]);
  }
  return out;
}

/** Names of things: inner capital or digit (GraphQL, L2), ALLCAPS, or a capitalised word mid-sentence. */
export function properish(s) {
  const t = String(s ?? '');
  const out = [];
  for (const m of t.matchAll(WORD_RE)) {
    const w = m[0];
    const before = t.slice(0, m.index);
    const atStart = /(^|[.!?:;\n])\s*[-*]?\s*$/.test(before);
    if (/^\p{L}[\p{L}\p{N}+#]*\p{Lu}/u.test(w) || (/\p{L}/u.test(w) && /\d/.test(w) && !/^\d/.test(w))
        || /^\p{Lu}{2,}$/u.test(w)) out.push(w);
    else if (/^\p{Lu}\p{Ll}+$/u.test(w) && w !== 'I' && !atStart) out.push(w);
  }
  return out;
}

function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, acc);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, acc);
  return acc;
}

/** Text that counts toward length and is scanned: works on a master or a composed doc. */
export function cvText(d) {
  const parts = [d.tagline, d.summary];
  for (const g of d.skills || []) parts.push(...(g.items || []));
  for (const r of d.experience || []) for (const b of r.bullets || []) parts.push(b.text);
  for (const o of d.open_source || []) parts.push(o.text);
  for (const p of d.projects || []) for (const b of p.bullets || []) parts.push(b.text);
  return parts.filter(Boolean).join(' ');
}

/** Every model-written field with its location. */
function fields(doc) {
  const f = [{ ref: 'tagline', text: doc.tagline }, { ref: 'summary', text: doc.summary }];
  for (const g of doc.skills || []) (g.items || []).forEach((it, i) => f.push({ ref: `skills.${g.id}.${i}`, text: it }));
  for (const r of doc.experience || []) (r.bullets || []).forEach((b, i) => f.push({ ref: `experience.${r.id}.${i}`, text: b.text, from: b.from, scope: r.id }));
  (doc.open_source || []).forEach((b, i) => f.push({ ref: `open_source.${i}`, text: b.text, from: b.from, scope: 'o' }));
  for (const p of doc.projects || []) (p.bullets || []).forEach((b, i) => f.push({ ref: `projects.${p.id}.${i}`, text: b.text, from: b.from, scope: p.id }));
  return f.filter((x) => typeof x.text === 'string');
}

function masterIndex(master) {
  const src = new Map();   // id -> text
  const ids = new Set();
  for (const g of master.skills || []) { ids.add(g.id); src.set(g.id, (g.items || []).join(' ')); }
  for (const r of master.experience || []) {
    ids.add(r.id);
    src.set(r.id, (r.bullets || []).map((b) => b.text).join(' '));
    for (const b of r.bullets || []) { ids.add(b.id); src.set(b.id, b.text); }
  }
  for (const o of master.open_source || []) { ids.add(o.id); src.set(o.id, `${o.label || ''} ${o.text}`); }
  for (const p of master.projects || []) {
    ids.add(p.id);
    src.set(p.id, `${p.title || ''} ${p.meta || ''} ${(p.bullets || []).map((b) => b.text).join(' ')}`);
    for (const b of p.bullets || []) { ids.add(b.id); src.set(b.id, b.text); }
  }
  return { src, ids };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_OK = /^[\w.+%-]{1,40}$/;

/**
 * checkFacts({ doc, master, job, description, output?, requirements? })
 * `output` (the model's raw answer) adds reference checks that composing would
 * otherwise hide, such as an unknown role id. Edits by her pass no output.
 *
 * @param {{ doc: any, master: any, job?: any, description?: string, output?: any, requirements?: any[] | null }} input
 * @returns {{ hard: { code: string, ref: string, token: string }[], soft: { code: string, ref: string, token: string }[] }}
 */
export function checkFacts({ doc, master, job = {}, description = "", output = null, requirements = null }) {
  const hard = [];
  const soft = [];
  const H = (code, ref, token = '') => hard.push({ code, ref, token: TOKEN_OK.test(token) ? token : '' });
  const S = (code, ref, token = '') => soft.push({ code, ref, token: TOKEN_OK.test(token) ? token : '' });

  const corpus = strings(master).join('\n');
  const corpusLower = corpus.toLowerCase();
  const vocab = new Set(words(corpus).map((w) => w.toLowerCase()));
  const vocabStem = new Set([...vocab, ...[...vocab].map(stem)]);
  const MONTH_NAMES = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/;
  const masterMonths = new Set([...vocab].filter((w) => MONTH_NAMES.test(w)).map((w) => w.slice(0, 3)));
  const masterYears = new Set(corpus.match(/\b(?:19|20)\d{2}\b/g) || []);
  const postingWords = new Set(words(description).map((w) => w.toLowerCase()));
  const postingStems = new Set([...postingWords].map(stem));
  const { src, ids } = masterIndex(master);

  // A number passes when the pool holds it exactly, or holds it with a suffix
  // and the draft gives none. "5+" against a master "5" does not pass.
  const poolOf = (text) => {
    const set = new Set();
    for (const n of numbers(text)) { set.add(n); set.add(`core:${n.replace(/[%+kKmM]$/, '')}`); }
    return set;
  };
  const numberOk = (n, pool) => pool.has(n) || (!/[%+kKmM]$/.test(n) && pool.has(`core:${n}`));
  const masterPool = poolOf(corpus);

  const fs = fields(doc);

  // ----- structure
  const roles = new Map((doc.experience || []).map((r) => [r.id, r]));
  for (const m of master.experience || []) {
    const r = roles.get(m.id);
    if (!r || !r.bullets?.length) H('missing_role', `experience.${m.id}`);
    else if (r.bullets.length > (m.bullets || []).length) H('too_many_bullets', `experience.${m.id}`);
  }
  const mproj = new Map((master.projects || []).map((p) => [p.id, p]));
  for (const p of doc.projects || []) {
    const m = mproj.get(p.id);
    if (m && (p.bullets || []).length > (m.bullets || []).length) H('too_many_bullets', `projects.${p.id}`);
  }
  const mgroups = new Map((master.skills || []).map((g) => [g.id, g]));
  for (const g of doc.skills || []) {
    const m = mgroups.get(g.id);
    const have = new Set((m?.items || []).map((x) => x.toLowerCase()));
    (g.items || []).forEach((it, i) => { if (!have.has(String(it).toLowerCase())) H('skill_not_in_master', `skills.${g.id}.${i}`); });
  }

  // ----- references
  if (output) {
    const gids = new Set((master.skills || []).map((g) => g.id));
    const rids = new Set((master.experience || []).map((r) => r.id));
    const pids = new Set((master.projects || []).map((p) => p.id));
    for (const g of output.skills || []) if (!gids.has(g.group)) H('bad_ref', `skills.${g.group}`, g.group);
    for (const r of output.experience || []) if (!rids.has(r.role)) H('bad_ref', `experience.${r.role}`, r.role);
    for (const p of output.projects || []) if (!pids.has(p.project)) H('bad_ref', `projects.${p.project}`, p.project);
    (output.requirements || []).forEach((r, i) => {
      for (const e of r.evidence || []) if (!ids.has(e)) H('bad_ref', `requirements.${i}`, e);
    });
  }
  for (const f of fs) {
    if (!f.from) continue;
    for (const id of f.from) {
      const inScope = f.scope === 'o' ? /^o\d+$/.test(id) : id === f.scope || id.startsWith(`${f.scope}.`);
      if (!ids.has(id) || !inScope) H('bad_ref', f.ref, id);
    }
  }

  // ----- per-field scans
  const company = String(job.company || '').trim().toLowerCase();
  const companyRe = company.length >= 3
    ? new RegExp(`(^|[^\\p{L}\\p{N}])${esc(company)}($|[^\\p{L}\\p{N}])`, 'iu')
    : null;
  const termHits = [];
  for (const f of fs) {
    const t = f.text;
    if (MARKUP.test(t)) H('markup', f.ref);
    for (const u of urls(t)) if (!corpusLower.includes(u.toLowerCase())) H('contact_or_url', f.ref, u);

    // A bullet's numbers must sit in the bullets it cites; the rest anywhere in the master.
    const pool = f.from ? poolOf(f.from.map((id) => src.get(id) || '').join(' ')) : masterPool;
    for (const n of numbers(t)) if (!numberOk(n, pool)) H('number_not_in_source', f.ref, n);

    for (const m of t.matchAll(NUMBER_WORDS)) {
      if (!corpusLower.includes(m[0].toLowerCase())) H('number_word', f.ref, m[0].toLowerCase());
    }
    for (const y of t.match(/\b(?:19|20)\d{2}\b/g) || []) if (!masterYears.has(y)) H('date_not_in_master', f.ref, y);
    for (const m of t.matchAll(MONTHS)) {
      const name = (m[1] || m[2] || m[3]).toLowerCase();
      // "Aug" in the master allows "August" in the draft, and the other way round.
      if (!masterMonths.has(name.slice(0, 3))) H('date_not_in_master', f.ref, name);
    }
    if (companyRe && !corpusLower.includes(company) && companyRe.test(t)) H('target_employer', f.ref);

    for (const w of properish(t)) {
      if (vocab.has(w.toLowerCase())) continue;
      if (postingWords.has(w.toLowerCase())) H('posting_term_injected', f.ref, w);
      else S('proper_noun', f.ref, w);
    }
    for (const w of words(t)) {
      if (w !== w.toLowerCase() || !/^\p{L}{4,}$/u.test(w)) continue;
      const s = stem(w);
      if (STOP.has(w) || STOP.has(s) || vocabStem.has(w) || vocabStem.has(s)) continue;
      if (postingStems.has(s) || postingWords.has(w)) termHits.push([f.ref, w]);
    }
  }
  const seen = new Set();
  for (const [ref, w] of termHits) {
    if (!seen.has(ref + w)) { seen.add(ref + w); S('posting_term', ref, w); }
  }

  // ----- the model's other fields
  const reqs = requirements || output?.requirements || [];
  reqs.forEach((r, i) => {
    for (const t of [r.text, r.note]) {
      if (typeof t !== 'string') continue;
      if (MARKUP.test(t)) H('markup', `requirements.${i}`);
      for (const u of urls(t)) if (!corpusLower.includes(u.toLowerCase())) H('contact_or_url', `requirements.${i}`, u);
    }
    if ((r.status === 'met' || r.status === 'partial') && !(r.evidence || []).length) S('unsupported_requirement', `requirements.${i}`);
  });

  // ----- soft: length and the posting itself
  if (cvText(doc).length > cvText(master).length * 1.02) S('over_length', 'doc');
  if (output?.suspicious_instructions === true || INJECTION.test(description)) S('suspicious_posting', 'posting');

  return { hard, soft };
}
