// Test hook, loaded with `node --import`. Replaces fetch so a worker run in a
// child process never reaches the internet: requests to the stub database
// pass through, everything else is answered from a JSON file of invented
// fixtures (FETCH_FIXTURES), or with 404. Every outbound URL is recorded to
// FETCH_LOG so a test can see what was asked.
//
// Fixture file: { "<exact url>": { "status": 200, "json": {...} | "text": "..." } }

import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const real = globalThis.fetch;
const fixtures = process.env.FETCH_FIXTURES && existsSync(process.env.FETCH_FIXTURES)
  ? JSON.parse(readFileSync(process.env.FETCH_FIXTURES, 'utf8'))
  : {};
const base = process.env.SUPABASE_URL;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (base && url.startsWith(base)) return real(input, init);
  if (process.env.FETCH_LOG) appendFileSync(process.env.FETCH_LOG, `${url}\n`);
  const hit = fixtures[url];
  if (!hit) return new Response('not found', { status: 404 });
  const body = hit.json !== undefined ? JSON.stringify(hit.json) : String(hit.text ?? '');
  return new Response(body, { status: hit.status ?? 200, headers: { 'content-type': hit.json !== undefined ? 'application/json' : 'text/plain' } });
};
