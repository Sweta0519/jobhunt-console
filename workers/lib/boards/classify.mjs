// Is this board really that company's? Pure: no I/O, no database.
//
// A name match alone never enables a board. Free empty accounts squat on big
// names, and a same-named company elsewhere is common. Auto-confirm needs name
// plus domain evidence, or a job URL that proves the link.

const LEGAL = new Set(['gmbh', 'ag', 'se', 'inc', 'ltd', 'llc', 'bv', 'nv', 'plc', 'corp', 'corporation', 'co', 'company', 'kg', 'ug', 'sarl', 'sas', 'ab', 'oy', 'as', 'limited', 'srl', 'spa', 'pty', 'mbh', 'pvt', 'private', 'lp', 'llp']);
const GENERIC = new Set(['group', 'holding', 'holdings', 'technologies', 'technology', 'tech', 'labs', 'lab', 'software', 'systems', 'solutions', 'hq', 'io', 'ai', 'app', 'global', 'international', 'germany', 'deutschland', 'europe', 'emea', 'the', 'db', 'com']);
// Links that say nothing about who the employer is.
const NOT_EMPLOYER = new Set(['linkedin.com', 'youtube.com', 'youtu.be', 'github.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'glassdoor.com', 'greenhouse.io', 'ashbyhq.com', 'lever.co', 'workable.com', 'recruitee.com', 'personio.de', 'personio.com', 'teamtailor.com', 'google.com', 'notion.so', 'notion.site', 'medium.com', 'eeoc.gov', 'dol.gov', 'europa.eu', 'gdpr.eu', 'wikipedia.org']);
const TWO_PART_TLD = new Set(['co.uk', 'com.au', 'co.in', 'co.nz', 'com.br', 'co.jp']);
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const words = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

export const core = (s) => words(s).filter((w) => !LEGAL.has(w) && !GENERIC.has(w)).join(' ');

/** Token guesses for a name, at most 3: core compact, core hyphenated, strict compact. */
export function tokensFor(name) {
  const c = words(name).filter((w) => !LEGAL.has(w) && !GENERIC.has(w));
  const strict = words(name).filter((w) => !LEGAL.has(w));
  const out = [c.join(''), c.join('-'), strict.join('')];
  return [...new Set(out)].filter((t) => t.length >= 2 && TOKEN_RE.test(t)).slice(0, 3);
}

/** Registrable root of a host: example.com, or example.co.uk. */
export function rootOf(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const two = parts.slice(-2).join('.');
  return TWO_PART_TLD.has(two) && parts.length >= 3 ? parts.slice(-3).join('.') : two;
}

const textOf = (p) =>
  String(p?.html || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const nameRe = (name) => {
  const esc = name.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i');
};

/** Registrable roots most linked or mailed from posting HTML, top 3 by count. */
export function linkedRoots(posts, extraUrl) {
  const counts = new Map();
  const add = (host, n = 1) => {
    const r = rootOf(host);
    if (!r || NOT_EMPLOYER.has(r)) return;
    counts.set(r, (counts.get(r) || 0) + n);
  };
  for (const p of posts || []) {
    const html = String(p?.html || '');
    for (const m of html.matchAll(/(?:https?:\/\/|@|www\.)([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) add(m[1]);
  }
  if (extraUrl) {
    try { add(new URL(extraUrl).hostname, 5); } catch { /* not a URL */ }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);
}

/**
 * board: { name: string|null, posts: [{title, html}], careersUrl? }
 * company: { name, domain: string|null }
 * opts: { viaUrl: boolean } the board token came from an employer job URL
 * returns { verdict: 'confirmed'|'review'|'rejected'|'empty', evidence }
 */
export function classify(company, board, { viaUrl = false } = {}) {
  if (!board?.posts?.length) return { verdict: 'empty', evidence: {} }; // squats, dormant boards
  const name = core(company.name);
  const compact = name.replace(/ /g, '');
  const b = core(board.name);
  const nameExact = !!board.name && !!name && b === name;
  const nameNear =
    !!board.name && !nameExact && compact.length >= 4 && b.length > 0 &&
    (b.replace(/ /g, '').startsWith(compact) || compact.startsWith(b.replace(/ /g, '')));
  const roots = linkedRoots(board.posts, board.careersUrl);
  const label = (r) => r.split('.')[0].replace(/-/g, '');
  const known = company.domain ? rootOf(company.domain) : null;
  const domainKnown = !!known && roots.includes(known);
  const domainName = !known && !!compact && roots.some((r) => label(r) === compact); // exact label, never substring
  const domain = domainKnown || domainName;
  const texts = board.posts.map(textOf).filter((t) => t.length > 200);
  const re = name ? nameRe(name) : null;
  const mention = re && texts.length ? texts.filter((t) => re.test(t)).length / texts.length : 0;
  const named = nameExact || nameNear || (!board.name && mention >= 0.5);
  const evidence = { nameExact, nameNear, mention: +mention.toFixed(2), roots, domainKnown, domainName, viaUrl };
  if (viaUrl && (named || domain || mention >= 0.5)) return { verdict: 'confirmed', evidence };
  if (domain && named) return { verdict: 'confirmed', evidence };
  if (named || domain || mention >= 0.5) return { verdict: 'review', evidence };
  return { verdict: 'rejected', evidence };
}
