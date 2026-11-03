// The public repository's Actions log must never carry CV text, draft text or
// Claude's output. The worker replaces console.* before it does anything and
// speaks only through event(), which prints allow-listed keys with safe values.

import { createHmac } from 'node:crypto';

let out = process.stdout.write.bind(process.stdout);
const KEYS = new Set(['job','n','code','stage','todo','queued','skipped','used','cap','drafted','failed','left','stopped','hard','soft','attempt','version']);
const SAFE = /^[a-z0-9_]{1,40}$/;
// Job ids carry the company token, so only the hashId tag may be printed.
const JOB_TAG = /^[0-9a-f]{10}$/;
const safeValue = (k, v) => (k === 'job' ? JOB_TAG.test(String(v)) : typeof v === 'number' || SAFE.test(String(v)));

/** Test hook: redirect what event() and the crash handler print. */
export function setOutput(fn) { out = fn; }

export function installQuietConsole() {
  for (const m of ['log','info','warn','error','debug','trace','dir','table']) console[m] = () => {};
  const die = (e) => { out(`resumes failed code=${safeCode(e)}\n`); process.exit(1); };
  process.on('uncaughtException', die);
  process.on('unhandledRejection', die);
}

/** `name` is always a literal in code. Unknown keys and unsafe values are dropped. */
export function event(name, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([k, v]) => KEYS.has(k) && safeValue(k, v))
    .map(([k, v]) => `${k}=${v}`);
  out(`${name} ${parts.join(' ')}\n`);
}

/** Never e.message: a PostgREST error carries the whole failing row (db.mjs request()). */
export function safeCode(e) {
  if (e?.code && /^[a-z_]{2,30}$/.test(e.code)) return e.code;
  const m = /-> (\d{3})/.exec(String(e?.message || ''));
  return m ? `db_${m[1]}` : 'internal';
}

/**
 * A short, non-reversible tag for a job id. Ids carry the company token
 * (`ashby:<company>:<uuid>`), so they must not be printed. Keyed with the
 * service role key, so a guessed company and id cannot be checked against a
 * log line by anyone who lacks it. scripts/job-hash.mjs maps a tag back.
 */
export function hashId(id, key = process.env.SUPABASE_SERVICE_ROLE_KEY || '') {
  return createHmac('sha256', key).update(String(id)).digest('hex').slice(0, 10);
}
