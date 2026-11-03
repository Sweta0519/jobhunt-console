// Polite fetching: one request at a time per host, hosts in parallel, one retry
// on 429 or 5xx, and a host that keeps failing is left alone for the rest of
// the run. Nothing here throws out of byHost; a failure is a value.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const PAUSE_AFTER = 5;
const MAX_RETRY_AFTER_MS = 30_000;

const transient = (e) => e?.status === 429 || (e?.status >= 500 && e?.status < 600);

/**
 * One retry on 429 or 5xx, honouring Retry-After up to 30 s. After 5
 * consecutive 429/5xx the host is paused for this run: run() then throws
 * `host paused` without making a request.
 */
export function makeGate({ wait = sleep } = {}) {
  const streak = new Map();
  return {
    paused: (host) => (streak.get(host) || 0) >= PAUSE_AFTER,
    async run(host, fn) {
      if ((streak.get(host) || 0) >= PAUSE_AFTER) throw Object.assign(new Error('host paused'), { code: 'host_paused' });
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await fn();
          streak.set(host, 0);
          return out;
        } catch (e) {
          if (!transient(e)) {
            // A clean 404 or a parse error says nothing about the host's health.
            if (e?.status) streak.set(host, 0);
            throw e;
          }
          streak.set(host, (streak.get(host) || 0) + 1);
          if (attempt >= 1 || (streak.get(host) || 0) >= PAUSE_AFTER) throw e;
          const ms = Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, Number(e.retryAfter || 0) * 1000));
          await wait(ms);
        }
      }
    },
  };
}

/**
 * Runs fn over items, one at a time per host, hosts in parallel. Never rejects.
 * Returns [[item, { value } | { error }], ...] in the order of `items`.
 */
export async function byHost(items, hostOf, fn, { gapOf = () => 300, wait = sleep, gate = makeGate({ wait }) } = {}) {
  const results = new Map();
  const groups = new Map();
  for (const item of items) {
    const h = hostOf(item);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(item);
  }
  await Promise.all(
    [...groups.entries()].map(async ([host, list]) => {
      let first = true;
      for (const item of list) {
        if (!first && !gate.paused(host)) await wait(gapOf(host));
        first = false;
        try {
          results.set(item, { value: await gate.run(host, () => fn(item)) });
        } catch (error) {
          results.set(item, { error });
        }
      }
    })
  );
  return items.map((item) => [item, results.get(item)]);
}

/**
 * For callers that work through a queue themselves (the probe): run(host, fn)
 * lines calls up one at a time per host, with a gap after each. Hosts do not
 * wait for each other.
 */
export function makeLimiter({ gapOf = () => 300, wait = sleep } = {}) {
  const tails = new Map();
  return (host, fn) => {
    const prev = tails.get(host) || Promise.resolve();
    const run = prev.then(() => fn());
    tails.set(host, run.then(() => wait(gapOf(host)), () => wait(gapOf(host))));
    return run;
  };
}
