// A tiny in-memory PostgREST, enough for workers/resumes.mjs. The real db.mjs
// talks to it over http, so the real request code is exercised. Tests only.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const RESERVED = new Set(['select', 'order', 'limit', 'on_conflict']);

function matches(row, key, spec) {
  const v = row[key];
  const num = (x) => (x !== '' && !Number.isNaN(Number(x)) ? Number(x) : x);
  if (spec.startsWith('eq.')) return String(v) === spec.slice(3);
  if (spec.startsWith('in.(')) return spec.slice(4, -1).split(',').includes(String(v));
  if (spec.startsWith('gte.')) return v != null && (typeof v === 'number' ? v >= num(spec.slice(4)) : String(v) >= spec.slice(4));
  if (spec.startsWith('lt.')) return v != null && (typeof v === 'number' ? v < num(spec.slice(3)) : String(v) < spec.slice(3));
  if (spec === 'is.true') return v === true;
  if (spec === 'is.false') return v === false;
  if (spec === 'is.null') return v == null;
  if (spec === 'not.is.null') return v != null;
  throw new Error(`stub: unsupported filter ${key}=${spec}`);
}

/**
 * state: { tables: { name: rows[] }, requests: [], hooks: { onPatch(table, body, query) -> {status, body}|null } }
 */
export async function startStub(state) {
  state.requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.replace('/rest/v1/', '');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    state.requests.push({ method: req.method, table, query: url.search, body });
    state.tables[table] ||= [];
    const rows = state.tables[table];
    const filters = [...url.searchParams.entries()].filter(([k]) => !RESERVED.has(k));
    const pick = () => rows.filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload === undefined ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload));
    };

    if (req.method === 'GET') {
      let out = pick();
      const order = url.searchParams.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const limit = Number(url.searchParams.get('limit'));
      if (limit) out = out.slice(0, limit);
      return send(200, out);
    }

    const hook = state.hooks?.[req.method]?.(table, body, url.search);
    if (hook) return send(hook.status, hook.body);

    if (req.method === 'PATCH') {
      for (const r of pick()) Object.assign(r, body);
      return send(204);
    }
    if (req.method === 'POST') {
      const conflict = url.searchParams.get('on_conflict')?.split(',');
      const out = [];
      for (const b of body) {
        let row = conflict ? rows.find((r) => conflict.every((c) => r[c] === b[c])) : null;
        if (row) Object.assign(row, b);
        else {
          row = { ...b };
          if (table === 'resume_drafts') Object.assign(row, { attempts: 0, generation: 0, ...b, id: b.id || randomUUID() });
          else if (table === 'runs') row.id = randomUUID();
          rows.push(row);
        }
        out.push(row);
      }
      return (req.headers.prefer || '').includes('return=representation') ? send(201, out) : send(201);
    }
    return send(405);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
