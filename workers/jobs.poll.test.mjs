// The real jobs worker against the in-memory database, with every outbound
// request answered from invented fixtures. Includes the log check: in Actions
// the poll prints no company, slug, token, title or owner label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startStub } from './lib/resume/fixtures/stub-db.mjs';
import { runWorker } from './lib/boards/fixtures/exec.mjs';

const JOBS = fileURLToPath(new URL('./jobs.mjs', import.meta.url));
const P = '00000000-0000-4000-8000-0000000000a1';
const S = '00000000-0000-4000-8000-0000000000a2';
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();

const TEXT = 'Help customers debug REST integrations, logs and webhooks. '.repeat(10);
const workableBody = (shortcodes) => ({
  name: 'Zorblax Canary',
  jobs: shortcodes.map((s) => ({
    shortcode: s, title: s === 'fresh1' ? 'Canary Technical Support Engineer' : 'Canary Support Engineer', url: `https://apply.workable.com/zorblaxcanary/j/${s}/`,
    country: 'Germany', telecommuting: true, description: `<p>${TEXT}</p>`, published_on: iso(NOW - 2 * 86_400_000),
  })),
});

function world() {
  const t = {
    allowed_user: [{ user_id: P, is_primary: true, label: 'canarylabel-primary' }, { user_id: S, is_primary: false, label: 'canarylabel-second' }],
    settings: [{ owner: S, key: 'jobfit_profile', value: { roles: ['support engineer'], skills: { core: ['api'] } } }],
    companies: [
      { owner: P, slug: 'zorblax-canary', name: 'Zorblax Canary', board_kind: 'workable', board_token: 'zorblaxcanary', board_baselined_at: iso(NOW - 86_400_000), board_fail_count: 0 },
      { owner: P, slug: 'quuxfail-canary', name: 'Quuxfail Canary', board_kind: 'greenhouse', board_token: 'quuxfailcanary', board_baselined_at: iso(NOW - 86_400_000), board_fail_count: 0 },
    ],
    jobs: [], job_descriptions: [], resume_drafts: [], notifications: [], runs: [],
  };
  // 1,100 filler rows sort before the workable ids, pushing the applied row past PostgREST's 1000.
  for (let i = 0; i < 1100; i++) t.jobs.push({ owner: P, id: `manual:fill:${String(i).padStart(5, '0')}`, source: 'manual', company_slug: null, company: 'Filler', title: 'x', status: 'found', closed: true, backlog: false });
  const base = { owner: P, source: 'workable', company_slug: 'zorblax-canary', company: 'Zorblax Canary', title: 'Canary Support Engineer', status: 'found', closed: false, backlog: false, url: 'https://x.invalid/1' };
  t.jobs.push({ ...base, id: 'workable:zorblaxcanary:gone', url: 'https://x.invalid/gone' });
  t.jobs.push({ ...base, id: 'workable:zorblaxcanary:applied1', status: 'applied', applied_at: '2026-10-01', notes: 'sent it' });
  t.jobs.push({ ...base, id: 'greenhouse:quuxfailcanary:keep', source: 'greenhouse', company_slug: 'quuxfail-canary', company: 'Quuxfail Canary', url: 'https://x.invalid/keep' });
  return { tables: t };
}

const fixtures = { 'https://apply.workable.com/api/v1/widget/accounts/zorblaxcanary?details=true': { status: 200, json: workableBody(['applied1', 'fresh1']) } };
const row = (st, id) => st.tables.jobs.find((j) => j.id === id);

test('poll: an applied row past row 1000 keeps its status; a failing board closes nothing; a vanished posting on an answered board closes', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(JOBS, ['--owner', 'canarylabel-primary'], { url: stub.url, fixtures });
    assert.equal(r.code, 0, r.out);
    assert.equal(row(st, 'workable:zorblaxcanary:applied1').status, 'applied');
    assert.equal(row(st, 'workable:zorblaxcanary:applied1').notes, 'sent it');
    assert.equal(row(st, 'workable:zorblaxcanary:gone').closed, true, 'answered board, posting gone');
    assert.equal(row(st, 'greenhouse:quuxfailcanary:keep').closed, false, 'failed board closes nothing');
    assert.ok(row(st, 'workable:zorblaxcanary:fresh1'), 'a new posting is stored');
    assert.equal(row(st, 'workable:zorblaxcanary:fresh1').backlog, false);
    assert.equal(st.tables.companies.find((c) => c.slug === 'quuxfail-canary').board_fail_count, 1);
    assert.equal(st.tables.runs.at(-1).ok, true);
    const gets = st.requests.filter((q) => q.table === 'jobs' && q.method === 'GET');
    assert.ok(gets.length >= 2, 'jobs were read in pages');
  } finally {
    await stub.close();
  }
});

test('poll: a dry run writes nothing', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(JOBS, ['--owner', 'canarylabel-primary', '--dry-run'], { url: stub.url, fixtures });
    assert.equal(r.code, 0, r.out);
    assert.equal(st.requests.filter((q) => q.method !== 'GET').length, 0);
  } finally {
    await stub.close();
  }
});

test('in Actions the poll prints no company, slug, token, title, owner label or URL', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(JOBS, [], { url: stub.url, fixtures, env: { GITHUB_ACTIONS: 'true' } });
    assert.equal(r.code, 0, r.out);
    for (const canary of ['zorblax', 'quuxfail', 'canarylabel', 'Canary Support', 'workable.com', 'greenhouse.io', 'apply.']) {
      assert.ok(!r.out.toLowerCase().includes(canary.toLowerCase()), `output contains ${canary}:\n${r.out}`);
    }
    assert.match(r.out, /boards: \d+ answered, \d+ failed/);
    assert.ok(row(st, 'workable:zorblaxcanary:fresh1'), 'the run did work');
  } finally {
    await stub.close();
  }
});
