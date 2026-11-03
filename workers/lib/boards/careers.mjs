// Careers-section fallback: for a company with no findable board, read only its
// careers pages, once a month, to find an embedded board. Nothing else on a
// company's site is ever requested: robots.txt, the homepage (to find the
// careers link) and a few careers paths. No headless browser, no retry after a
// block, no other User-Agent. Plain HTML titles become a "Check by hand" hint,
// never a job row.
//
// Page text is untrusted: every token goes through validToken, and no value
// from a page becomes a hostname except through the fixed patterns below.

import { UA } from '../sources.mjs';
import { validToken, validHost, parseBoardUrl } from './hosts.mjs';

export const CAREER_PATHS = ['/careers', '/jobs', '/join-us', '/company/careers', '/about/careers', '/karriere', '/en/careers'];
const IN_SECTION = /^\/([a-z]{2}(-[a-z]{2})?\/)?((about|company|about-us)\/)?(careers?|jobs?|join-us|karriere|stellen(angebote)?)(\/|$)/i;
const CAREER_HOST = /^(careers?|jobs|karriere)\./i;
const BLOCK_BODY = /just a moment|cf-chl|checking your browser|attention required|captcha|access denied|are you a robot/i;
const MAX_PAGES = 4;
const MAX_BODY = 1_500_000;

/** The only pages this module may ever request on a company's site. */
export function inScope(url, domain) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  if (/\/\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(u.pathname)) return false;
  const host = u.hostname.replace(/^www\./, '');
  if (!validHost(host)) return false; // no IP literal
  if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  if (u.pathname === '/' && host === domain) return true; // homepage, once, to find the careers link
  return IN_SECTION.test(u.pathname) || CAREER_HOST.test(host);
}

/** robots.txt rules for our agent (else `*`). Longest match wins; Allow beats Disallow on a tie. */
export function parseRobots(text, agent = 'jobhunt-console') {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(m[2].trim().toLowerCase());
      lastWasAgent = true;
    } else if (cur && (key === 'allow' || key === 'disallow')) {
      cur.rules.push({ allow: key === 'allow', path: m[2].trim() });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const own = groups.filter((g) => g.agents.some((a) => a && agent.toLowerCase().includes(a) && a !== '*'));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (own.length ? own : star).flatMap((g) => g.rules);
}

const toRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // an empty Disallow allows everything
    if (!toRe(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

const EMBEDS = [
  ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i],
  ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/i],
  ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/i],
  ['ashby', /\bASHBY_BOARD\s*=\s*['"]([A-Za-z0-9._-]+)['"]/],
  ['lever', /jobs\.lever\.co\/([A-Za-z0-9._-]+)/i],
  ['lever', /api\.lever\.co\/v0\/postings\/([A-Za-z0-9._-]+)/i],
  ['workable', /apply\.workable\.com\/([A-Za-z0-9._-]+)/i],
  ['recruitee', /\b([a-z0-9-]+)\.recruitee\.com/i],
  ['personio', /\b([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i],
  ['teamtailor', /\b([a-z0-9-]+)\.teamtailor\.com/i],
  // Named so she can look, not read by us.
  ['smartrecruiters', /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9._-]+)/i],
  ['workday', /\b([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com/i],
  ['gem', /\bjobs\.gem\.com\/([A-Za-z0-9._-]+)/i], // not gem.com alone: a marketing form
];
const NOT_TOKENS = /^(embed|static|assets|api|www|cdn|js|css|jobs)$/i;
const UNSUPPORTED = new Set(['smartrecruiters', 'workday', 'gem']);

/** What one careers page says. Pure. */
export function scanCareersPage(html, pageUrl, titleOk = () => true) {
  const src = String(html || '');
  const embeds = [];
  const seen = new Set();
  for (const [kind, re] of EMBEDS) {
    for (const m of src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      let token = decodeURIComponent(m[1] || '').trim();
      if (!token || NOT_TOKENS.test(token)) continue;
      if (kind === 'teamtailor') token = `${token}.teamtailor.com`;
      if (!UNSUPPORTED.has(kind) && !validToken(kind, token)) continue;
      const key = `${kind}|${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      embeds.push({ kind, token, unsupported: UNSUPPORTED.has(kind) });
    }
  }
  // Link text that reads like a role, from links inside the careers section only.
  const titles = [];
  for (const m of src.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text.length < 6 || text.length > 100 || !titleOk(text)) continue;
    let abs;
    try { abs = new URL(m[1], pageUrl); } catch { continue; }
    if (!titles.some((t) => t.title === text)) titles.push({ title: text, url: `${abs.origin}${abs.pathname}` });
  }
  const ldSeen = (src.match(/"@type"\s*:\s*"JobPosting"/g) || []).length;
  const visible = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim();
  return { embeds, titles: titles.slice(0, 5), ldSeen, jsShell: visible.length < 400 };
}

/**
 * Reads one company's careers section within the budget: robots.txt, the
 * homepage, at most 4 careers pages. Returns
 *   { status, embeds, hints, ldSeen, moved }
 * status: board | postings | hint | shell | none | moved | disallowed | blocked | unreachable
 *
 * opts: { fetchImpl, titleOk, gap, wait }
 */
export async function checkCareers(domain, { fetchImpl = fetch, titleOk = () => true, gap = 1500, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const out = { status: 'none', embeds: [], hints: [], ldSeen: 0, moved: null, requests: 0 };
  const robotsCache = new Map();
  let requests = 0;
  // 1.5 s between requests to one company's site.
  const pace = async () => { if (requests++ && gap) await wait(gap); };

  async function get(url, hops = 0) {
    await pace();
    const r = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc || hops >= 3) return { status: 'none' };
      const next = new URL(loc, url).href;
      const board = parseBoardUrl(next);
      if (board) return { status: 'board-redirect', board };
      if (!inScope(next, domain)) return { status: 'moved', to: new URL(next).hostname };
      return get(next, hops + 1);
    }
    if ([401, 403, 429, 503].includes(r.status) || r.headers.get('cf-mitigated')) return { status: 'blocked' };
    if (r.status === 404 || r.status === 410) return { status: 'none' };
    if (!r.ok) return { status: 'blocked' };
    const body = (await r.text()).slice(0, MAX_BODY);
    if (body.length < 20_000 && BLOCK_BODY.test(body)) return { status: 'blocked' };
    return { status: 'ok', body, url: r.url || url };
  }

  async function rulesFor(host) {
    if (robotsCache.has(host)) return robotsCache.get(host);
    let rules;
    try {
      await pace();
      const r = await fetchImpl(`https://${host}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
      if (r.status === 200) rules = parseRobots((await r.text()).slice(0, 500_000));
      else if (r.status >= 400 && r.status < 500 && ![401, 403, 429].includes(r.status)) rules = [];
      else rules = null; // 401, 403, 429, 5xx, redirect: stop
    } catch { rules = null; }
    robotsCache.set(host, rules);
    return rules;
  }

  const base = await rulesFor(domain);
  if (base === null) { out.status = 'blocked'; return out; }

  let pages = 0;
  let disallowed = 0;
  let okPages = 0;
  const tried = new Set();
  async function visit(url) {
    if (tried.has(url) || !inScope(url, domain)) return null;
    tried.add(url);
    const u = new URL(url);
    const rules = u.hostname.replace(/^www\./, '') === domain ? base : await rulesFor(u.hostname);
    if (rules === null) { out.status = 'blocked'; return 'stop'; }
    if (!robotsAllows(rules, u.pathname + u.search)) { disallowed++; return null; }
    const g = await get(url);
    if (g.status === 'blocked') { out.status = 'blocked'; return 'stop'; }
    if (g.status === 'moved') { out.status = 'moved'; out.moved = g.to; return 'stop'; }
    if (g.status === 'board-redirect') { out.embeds.push({ ...g.board }); return 'found'; }
    if (g.status !== 'ok') return null;
    return g;
  }

  // Homepage: only to read links that say careers.
  const home = await visit(`https://${domain}/`);
  if (home === 'stop') return out;
  const links = [];
  if (home && home !== 'found') {
    for (const m of home.body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = m[2].replace(/<[^>]+>/g, ' ');
      let abs;
      try { abs = new URL(m[1], home.url).href; } catch { continue; }
      if (/career|jobs|karriere|join us|stellen/i.test(`${text} ${m[1]}`)) links.push(abs);
    }
  }
  const candidates = [...new Set([...links.filter((l) => inScope(l, domain)).slice(0, 2), ...CAREER_PATHS.map((p) => `https://${domain}${p}`)])];
  for (const url of candidates) {
    if (pages >= MAX_PAGES) break;
    pages++;
    const g = await visit(url);
    if (g === 'stop') return out;
    if (g === 'found') break;
    if (!g) continue;
    okPages++;
    const scan = scanCareersPage(g.body, g.url, titleOk);
    out.ldSeen += scan.ldSeen;
    out.embeds.push(...scan.embeds);
    if (scan.embeds.length) break;
    if (scan.titles.length) { out.hints.push(...scan.titles); break; }
    if (scan.jsShell) out.status = 'shell';
  }
  out.requests = requests;
  if (out.embeds.length) out.status = 'board';
  else if (out.hints.length) out.status = 'hint';
  else if (out.ldSeen) out.status = 'postings';
  else if (out.status === 'shell') out.status = 'shell';
  else if (disallowed && !okPages) out.status = 'disallowed';
  return out;
}
