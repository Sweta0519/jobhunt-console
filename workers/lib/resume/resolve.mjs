// Aggregator listing URL to the employer's own public posting API.
//
// The URL comes from a third party, so only parsed path parts ever reach the
// two fixed API hosts below. Nothing from the URL becomes a host.

import { cleanText } from './text.mjs';
import { UA } from '../sources.mjs';

const GH = /^https:\/\/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)(?:[/?#]|$)/i;
const ASHBY = /^https:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)\/([0-9a-f-]{36})(?:[/?#]|$)/i;

/** {kind:'greenhouse'|'ashby', token, id} or null. */
export function parseAtsUrl(url) {
  const s = String(url || '');
  if (/\/\.\.?(?:[/?#]|$)|%2e|%2f|\\/i.test(s)) return null; // traversal or encoded separators
  let m = GH.exec(s);
  if (m) return { kind: 'greenhouse', token: m[1], id: m[2] };
  m = ASHBY.exec(s);
  if (m && !/^\.+$/.test(m[1])) return { kind: 'ashby', token: m[1], id: m[2].toLowerCase() };
  return null;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!r.ok) throw new Error('status');
  return r.json();
}

/** Full posting text, or null for anything unexpected. Never throws. */
export async function resolveFull(url) {
  const t = parseAtsUrl(url);
  if (!t) return null;
  try {
    if (t.kind === 'greenhouse') {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${t.token}/jobs/${t.id}`);
      return cleanText(j?.content) || null;
    }
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${t.token}?includeCompensation=false`);
    const job = (j?.jobs || []).find((x) => String(x.id).toLowerCase() === t.id);
    return cleanText(job?.descriptionHtml || job?.descriptionPlain) || null;
  } catch {
    return null;
  }
}
