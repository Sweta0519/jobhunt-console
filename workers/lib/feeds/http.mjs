// Shared GET for the feeds. Public pages and JSON only, honest User-Agent, no
// credentials. Errors carry .status; the message names the URL, so callers
// print it locally only.

import { UA } from '../sources.mjs';

export async function httpGet(url, accept = 'application/json', timeout = 25000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) {
    const e = new Error(`${url} -> ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.text();
}

export const httpJson = async (url) => JSON.parse(await httpGet(url, 'application/json'));
