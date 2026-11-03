// One fetch for every structured source: a fixed host, https only, no redirect,
// a 20 second timeout and a 2 MB body cap. boards/fetch.mjs follows redirects,
// so it is not used here; follow resume/resolve.mjs getJson instead.
//
// Nothing from a page or a URL becomes a host: callers pass the host they expect.

import { UA } from '../../sources.mjs';

export class SourceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export const MAX_BODY = 2 * 1024 * 1024;

/**
 * @param {string} url
 * @param {{ host: string, method?: string, body?: any, accept?: string, fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number }} o
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function getLimited(url, { host, method = 'GET', body, accept = 'application/json', fetchImpl = fetch, timeoutMs = 20000, maxBytes = MAX_BODY }) {
  let u;
  try { u = new URL(url); } catch { throw new SourceError('bad_url'); }
  if (u.protocol !== 'https:' || u.hostname !== host || u.port || u.username || u.password) throw new SourceError('bad_url');
  let res;
  try {
    res = await fetchImpl(u.href, {
      method,
      headers: { 'User-Agent': UA, Accept: accept, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch {
    throw new SourceError('unreachable');
  }
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new SourceError('too_big');
  let text = '';
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); throw new SourceError('too_big'); }
      text += dec.decode(value, { stream: true });
    }
    text += dec.decode();
  } else {
    text = await res.text();
    if (text.length > maxBytes) throw new SourceError('too_big');
  }
  return { status: res.status, text };
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new SourceError('shape_changed'); }
}
