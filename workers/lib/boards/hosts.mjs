// Tokens from aggregators and career pages are third-party input, and three
// board kinds build a hostname from them. Nothing here does I/O.

const SUB = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// No IP literal, no port, no userinfo.
const HOST = /^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/;
const NUMERIC_HOST = /^[0-9.]+$/;

export const validHost = (h) => HOST.test(String(h || '')) && !NUMERIC_HOST.test(h);

export function validToken(kind, t) {
  const s = String(t ?? '');
  if (kind === 'recruitee' || kind === 'personio') return SUB.test(s);
  if (kind === 'teamtailor') return validHost(s);
  return PATH.test(s) && !/^\.+$/.test(s);
}

/** One key per kind: shared infrastructure counts as one host. Teamtailor is per career host. */
export const hostKey = (kind, token) => (kind === 'teamtailor' && token ? String(token) : String(kind));

/** Lever's robots.txt asks for a 1 second crawl delay. */
export const gapMs = (kind) => (kind === 'lever' ? 1100 : 300);

/** Kinds whose rows are read from a public board API. */
export const SUPPORTED_KINDS = ['greenhouse', 'ashby', 'lever', 'teamtailor', 'workable', 'recruitee', 'personio'];
export const UNSUPPORTED_KINDS = ['smartrecruiters', 'workday'];

const BAD = /\/\.\.?(?:[/?#]|$)|%2e|%2f|%5c|\|@/i;

/**
 * { kind, token } for a URL on a known board host, or null. Same rejection of
 * traversal and encoded separators as parseAtsUrl in resume/resolve.mjs, which
 * stays untouched. SmartRecruiters and Workday are recognised but unsupported.
 */
export function parseBoardUrl(url) {
  const s = String(url || '');
  if (BAD.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const first = u.pathname.split('/').filter(Boolean)[0] || '';
  const withPath = (kind) => (first && validToken(kind, first) ? { kind, token: first } : null);
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    return withPath('greenhouse');
  }
  if (host === 'jobs.ashbyhq.com') return withPath('ashby');
  if (host === 'jobs.lever.co') return withPath('lever');
  if (host === 'apply.workable.com') return withPath('workable');
  let m = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host);
  if (m && validToken('recruitee', m[1])) return { kind: 'recruitee', token: m[1] };
  m = /^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/.exec(host);
  if (m && validToken('personio', m[1])) return { kind: 'personio', token: m[1] };
  m = /^([a-z0-9-]+)\.teamtailor\.com$/.exec(host);
  if (m && validToken('teamtailor', host)) return { kind: 'teamtailor', token: host };
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    return first ? { kind: 'smartrecruiters', token: first.slice(0, 100), unsupported: true } : null;
  }
  m = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
  if (m) return { kind: 'workday', token: m[1], unsupported: true };
  return null;
}
