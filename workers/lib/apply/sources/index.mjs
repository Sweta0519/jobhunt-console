// Which reader, if any, may read the form of one job. Pure except readSource.
//
// First match wins:
//   1. job id prefix greenhouse: | ashby: | lever: with checked token and id
//   2. the job URL is a posting on one of those three boards
//   3. a board we do not read (smartrecruiters, workday, gem) or a denied host
//   4. aggregator feed rows with no board URL: the listing page is never opened
//   5. (phase 3 slot, browser reader: not built; deliberately absent here)
//   6. everything else: paste

import { validToken, parseBoardUrl } from '../../boards/hosts.mjs';
import { parseAtsUrl } from '../../resume/resolve.mjs';
import { validateForm } from '../schema.mjs';
import { readGreenhouse } from './greenhouse.mjs';
import { readAshby } from './ashby.mjs';
import { readLever } from './lever.mjs';
import { SourceError } from './http.mjs';

export const READABLE = ['greenhouse', 'ashby', 'lever'];
export const FEED_PREFIXES = ['rr', 'him', 'jobicy'];
// Hosts that are never opened for a form, whatever else matches.
export const DENY_HOSTS = [
  'smartrecruiters.com', 'myworkdayjobs.com', 'workday.com', 'gem.com', 'ycombinator.com', 'workatastartup.com',
  'remotive.com', 'linkedin.com', 'indeed.', 'xing.com', 'stepstone.', 'glassdoor.',
  'remoterocketship.com', 'himalayas.app', 'jobicy.com',
];
const LEVER_URL = /^https:\/\/jobs\.lever\.co\/([A-Za-z0-9._-]+)\/([0-9a-f-]{36})(?:[/?#]|$)/i;

export function denied(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return false; }
  return DENY_HOSTS.some((d) => (d.endsWith('.') ? host.split('.').some((p) => p === d.slice(0, -1)) : host === d || host.endsWith(`.${d}`)));
}

const ok = (kind, token, id) => (READABLE.includes(kind) && validToken(kind, token) && validToken(kind, id) ? { kind, token, id } : null);

function fromUrl(url) {
  const s = String(url || '');
  const gh = parseAtsUrl(s);
  if (gh) return ok(gh.kind, gh.token, gh.id);
  if (/\/\.\.?(?:[/?#]|$)|%2e|%2f|\\/i.test(s)) return null;
  const m = LEVER_URL.exec(s);
  return m ? ok('lever', m[1], m[2].toLowerCase()) : null;
}

/**
 * @param {{ id: string, url?: string }} job
 * @param {{ sources?: Record<string, boolean> }} cfg
 * @returns {{ kind: string, token: string, id: string } | { needs_paste: true, reason: string }}
 */
export function resolveSource(job, cfg = {}) {
  const gate = (src) => (cfg.sources && cfg.sources[src.kind] === false ? { needs_paste: true, reason: 'source_off' } : src);
  const m = /^(greenhouse|ashby|lever):([^:]+):(.+)$/.exec(String(job.id || ''));
  if (m) {
    const src = ok(m[1], m[2], m[3]);
    if (src) return gate(src);
  }
  const byUrl = fromUrl(job.url);
  if (byUrl) return gate(byUrl);
  const board = parseBoardUrl(job.url);
  if (board?.unsupported || denied(job.url)) return { needs_paste: true, reason: 'excluded' };
  if (FEED_PREFIXES.includes(String(job.id || '').split(':')[0])) return { needs_paste: true, reason: 'feed_listing' };
  return { needs_paste: true, reason: 'no_reader' };
}

/**
 * Reads and validates one form. Never throws.
 * @returns {Promise<{ ok: true, form: any, applyUrl: string } | { ok: false, reason: string }>}
 */
export async function readSource(src, deps = {}) {
  try {
    const read = src.kind === 'greenhouse' ? readGreenhouse : src.kind === 'ashby' ? readAshby : readLever;
    const { raw, applyUrl } = await read(src.token, src.id, deps);
    const v = validateForm(raw);
    return v.ok ? { ok: true, form: v.form, applyUrl } : { ok: false, reason: 'shape_changed' };
  } catch (e) {
    return { ok: false, reason: e instanceof SourceError ? e.code : 'unreachable' };
  }
}
