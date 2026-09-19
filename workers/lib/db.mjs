// Minimal PostgREST client over Node's built-in fetch. No npm dependencies, so
// the workers run on a bare Actions runner and on her PC unchanged.
//
// Credentials (service role — bypasses RLS, so this must never reach a browser):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Locally these come from .env.local, which is gitignored.

import { readFileSync, existsSync } from 'node:fs';

const SCHEMA = process.env.SUPABASE_SCHEMA || 'jobhunt';

/** Load .env.local into process.env without overwriting anything already set. */
function loadDotEnv(path = '.env.local') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (put them in .env.local, or in Actions secrets)'
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function request(method, path, { body, headers = {}, query = '' } = {}) {
  const { url, key } = config();
  const profile = method === 'GET' ? { 'Accept-Profile': SCHEMA } : { 'Content-Profile': SCHEMA };
  const res = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...profile,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // A 404 here almost always means the schema is not in Exposed Schemas.
    const hint =
      res.status === 404
        ? ` (is "${SCHEMA}" added under Settings -> API -> Exposed schemas?)`
        : '';
    throw new Error(`${method} ${path} -> ${res.status}${hint}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Upsert rows in batches. Returns the number of rows sent. */
export async function upsert(table, rows, { onConflict = 'id', batch = 500 } = {}) {
  if (!rows?.length) return 0;
  for (let i = 0; i < rows.length; i += batch) {
    await request('POST', table, {
      query: `?on_conflict=${onConflict}`,
      body: rows.slice(i, i + batch),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
  return rows.length;
}

export async function select(table, query = '') {
  return request('GET', table, { query });
}

export async function patch(table, query, body) {
  return request('PATCH', table, { query, body, headers: { Prefer: 'return=minimal' } });
}

/** Read a secret. Only ever called by workers; the browser cannot reach this table. */
export async function getSecret(key) {
  const rows = await select('secrets', `?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? null;
}

export async function setSecret(key, value) {
  await upsert('secrets', [{ key, value, updated_at: new Date().toISOString() }], { onConflict: 'key' });
}

/** Record a worker run. Returns a finish(ok, summary, error) callback. */
export async function startRun(worker) {
  const started_at = new Date().toISOString();
  const [row] = (await request('POST', 'runs', {
    body: [{ worker, started_at }],
    headers: { Prefer: 'return=representation' },
  })) || [];
  return async (ok, summary, error) => {
    if (!row?.id) return;
    await patch('runs', `?id=eq.${row.id}`, {
      finished_at: new Date().toISOString(),
      ok,
      summary: summary ?? null,
      error: error ? String(error).slice(0, 2000) : null,
    });
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}
