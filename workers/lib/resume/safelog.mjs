// The public repository's Actions log must never carry CV text, draft text or
// Claude's output. The worker replaces console.* before it does anything and
// speaks only through event(), which prints allow-listed keys with safe values.

let out = process.stdout.write.bind(process.stdout);
const KEYS = new Set(['job','n','code','stage','todo','queued','skipped','used','cap','drafted','failed','left','stopped','hard','soft','attempt','version']);
const SAFE = /^[a-z0-9_]{1,40}$|^[a-z]+:[A-Za-z0-9._-]{1,80}(:[A-Za-z0-9._-]{1,80})?$/;

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
    .filter(([k, v]) => KEYS.has(k) && (typeof v === 'number' || SAFE.test(String(v))))
    .map(([k, v]) => `${k}=${v}`);
  out(`${name} ${parts.join(' ')}\n`);
}

/** Never e.message: a PostgREST error carries the whole failing row (db.mjs request()). */
export function safeCode(e) {
  if (e?.code && /^[a-z_]{2,30}$/.test(e.code)) return e.code;
  const m = /-> (\d{3})/.exec(String(e?.message || ''));
  return m ? `db_${m[1]}` : 'internal';
}
