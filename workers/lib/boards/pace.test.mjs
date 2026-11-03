import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byHost, makeGate, makeLimiter, PAUSE_AFTER } from './pace.mjs';

const status = (s, extra = {}) => Object.assign(new Error(`http ${s}`), { status: s, ...extra });

test('one host never runs two at once, and the gap is honoured', async () => {
  let running = 0;
  let peak = 0;
  const waits = [];
  const out = await byHost(
    [1, 2, 3],
    () => 'h',
    async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setImmediate(r)); running--; return n * 2; },
    { gapOf: () => 1100, wait: async (ms) => { waits.push(ms); } }
  );
  assert.equal(peak, 1);
  assert.deepEqual(waits, [1100, 1100]);
  assert.deepEqual(out.map(([, r]) => r.value), [2, 4, 6]);
});

test('different hosts run in parallel', async () => {
  let running = 0;
  let peak = 0;
  await byHost(['a', 'b', 'c'], (x) => x, async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setImmediate(r)); running--; }, { wait: async () => {} });
  assert.equal(peak, 3);
});

test('a throwing item does not stop the others', async () => {
  const out = await byHost([1, 2, 3], () => 'h', async (n) => { if (n === 2) throw new Error('boom'); return n; }, { wait: async () => {} });
  assert.equal(out[0][1].value, 1);
  assert.equal(out[1][1].error.message, 'boom');
  assert.equal(out[2][1].value, 3);
});

test('one retry on 429, honouring Retry-After, capped at 30 s', async () => {
  const gate = makeGate({ wait: async (ms) => waits.push(ms) });
  const waits = [];
  let calls = 0;
  const v = await gate.run('h', async () => { if (++calls === 1) throw status(429, { retryAfter: 120 }); return 'ok'; });
  assert.equal(v, 'ok');
  assert.deepEqual(waits, [30000]);
});

test('five consecutive failures pause the host: no further request is made', async () => {
  const gate = makeGate({ wait: async () => {} });
  let calls = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  const out = await byHost(items, () => 'h', async () => { calls++; throw status(503); }, { gate, wait: async () => {} });
  assert.ok(calls <= PAUSE_AFTER + 1, `calls ${calls}`);
  assert.equal(out.filter(([, r]) => r.error?.code === 'host_paused').length > 0, true);
  assert.equal(gate.paused('h'), true);
});

test('a 404 is not a host failure', async () => {
  const gate = makeGate({ wait: async () => {} });
  for (let i = 0; i < 8; i++) await gate.run('h', async () => { throw status(404); }).catch(() => {});
  assert.equal(gate.paused('h'), false);
});

test('limiter serialises one host and spaces calls', async () => {
  const waits = [];
  const run = makeLimiter({ gapOf: () => 5, wait: async (ms) => waits.push(ms) });
  const order = [];
  await Promise.all([1, 2, 3].map((n) => run('h', async () => { order.push(`s${n}`); await new Promise((r) => setImmediate(r)); order.push(`e${n}`); })));
  assert.deepEqual(order, ['s1', 'e1', 's2', 'e2', 's3', 'e3']);
});
