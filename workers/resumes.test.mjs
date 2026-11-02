// End to end test of workers/resumes.mjs.
//
// The worker runs as a child process against an in-memory PostgREST (so the real
// db.mjs is exercised) and a fake Claude binary. Every piece of text that must
// never reach a public log carries a canary, and every scenario asserts that
// stdout and stderr contain none of them. All data here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './lib/resume/fixtures/stub-db.mjs';
import { syntheticMaster } from './lib/resume/fixtures/load.mjs';

const WORKER = fileURLToPath(new URL('./resumes.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./lib/resume/fixtures/fake-claude-pipeline.mjs', import.meta.url));

const CV = 'CANARY_CV_x7';
const JD = 'CANARY_JD_x7';
const DRAFT = 'CANARY_DRAFT_x7';
const TOKEN = 'CANARY_TOKEN_x7';
const CANARIES = [CV, JD, DRAFT, TOKEN];

const PRIMARY = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function posting(scenario, countFile) {
  return `SCENARIO=${scenario} COUNTFILE=${countFile} ${JD}\n` + 'We need someone to debug REST integrations for customers. '.repeat(30);
}

/** Fresh world: one master (with a canary), N queued drafts for N jobs. */
function world({ scenario = 'success', jobs = 1, cap = 5, countFile }) {
  const master = syntheticMaster();
  master.summary += ` ${CV}`;
  const t = {
    allowed_user: [{ user_id: PRIMARY, is_primary: true, label: 'p' }, { user_id: SECOND, is_primary: false, label: 's' }],
    settings: [{ owner: PRIMARY, key: 'resume_config', value: { enabled: true, daily_cap: cap, min_score: 70, from: '2020-01-01T00:00:00Z', model: 'sonnet', stop_at_utilization: 0.85 } }],
    master_cv: [{ owner: PRIMARY, version: 1, doc: master, source_sha: 'x' }],
    jobs: [], job_descriptions: [], resume_drafts: [], notifications: [], runs: [],
  };
  for (let i = 1; i <= jobs; i++) {
    const id = `greenhouse:acme:${1000 + i}`;
    t.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: `Support Engineer ${i}`, location: 'Remote', status: 'found', closed: false, eligible: true, score: 90 - i, first_seen_at: iso(NOW - 3_600_000) });
    const text = posting(scenario, countFile);
    t.job_descriptions.push({ owner: PRIMARY, job_id: id, description: text, kind: 'board', chars: text.length, sha: `sha${i}` });
    t.resume_drafts.push({ id: `draft-${i}`, owner: PRIMARY, job_id: id, master_version: 1, status: 'queued', attempts: 0, generation: 0, last_attempt_at: null });
  }
  return { tables: t };
}

function exec(args, url, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rt-')); // cwd without a .env.local
  const ghOut = join(dir, 'gh-output');
  writeFileSync(ghOut, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, ...args], {
      cwd: dir,
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'stub-key', GITHUB_OUTPUT: ghOut, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const gh = readFileSync(ghOut, 'utf8');
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, gh });
    });
  });
}

const draftArgs = ['--claude-node-script', FAKE];
const draftEnv = { CLAUDE_CODE_OAUTH_TOKEN: TOKEN };

async function scenario(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-'));
  const countFile = join(dir, 'calls');
  const state = world({ ...opts, countFile });
  state.hooks = opts.hooks;
  const stub = await startStub(state);
  try {
    await fn({ state, url: stub.url, countFile, calls: () => (existsSync(countFile) ? readFileSync(countFile, 'utf8').split('\n').filter(Boolean).length : 0) });
  } finally {
    await stub.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const noCanary = (out, label) => {
  for (const c of CANARIES) assert.ok(!out.includes(c), `${label}: output contains ${c}`);
};
const draftOf = (state, i = 1) => state.tables.resume_drafts.find((d) => d.id === `draft-${i}`);

test('success: drafts, stores, notifies, logs no canary', async () => {
  await scenario({}, async ({ state, url }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'success');
    const d = draftOf(state);
    assert.equal(d.status, 'draft');
    assert.equal(d.generation, 1);
    assert.ok(d.doc.summary.includes(DRAFT), 'the draft is stored, only never logged');
    assert.equal(d.gaps.length, 1);
    assert.equal(d.generated_doc.summary, d.doc.summary);
    assert.equal(state.tables.notifications.length, 1);
    assert.equal(state.tables.notifications[0].dedupe_key, 'resume:draft-1:1');
    assert.ok(!JSON.stringify(state.tables.notifications).includes(DRAFT));
    assert.equal(state.tables.runs[0].ok, true);
    assert.deepEqual(Object.keys(state.tables.runs[0].summary).sort(), ['drafted', 'failed', 'left', 'skipped', 'stopped']);
  });
});

test('facts failure: one retry only, then failed; no canary in the log', async () => {
  await scenario({ scenario: 'facts_fail' }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'facts_fail');
    assert.equal(calls(), 2, 'exactly one retry');
    const d = draftOf(state);
    assert.equal(d.status, 'failed');
    assert.equal(d.reason, 'facts_failed');
    assert.ok(d.fact_flags.some((f) => f.code === 'number_not_in_source'));
    assert.equal(state.tables.notifications.length, 0);
  });
});

test('a bad first answer is retried once and the second can succeed', async () => {
  await scenario({ scenario: 'facts_retry' }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'facts_retry');
    assert.equal(calls(), 2);
    assert.equal(draftOf(state).status, 'draft');
  });
});

test('usage limit: rows stay queued, attempts reverted, exit 0, run ok', async () => {
  await scenario({ scenario: 'usage_limit', jobs: 2 }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'usage_limit');
    assert.equal(calls(), 1, 'stops at the first limit');
    for (const i of [1, 2]) {
      const d = draftOf(state, i);
      assert.equal(d.status, 'queued');
      assert.equal(d.attempts, 0);
      assert.equal(d.last_attempt_at, null);
    }
    assert.equal(state.tables.runs[0].ok, true);
    assert.equal(state.tables.runs[0].summary.stopped, 'usage_limit');
    assert.match(r.out, /stopped=usage_limit/);
  });
});

test('db failure whose message carries the row: only a status code is logged', async () => {
  const hooks = { PATCH: (table, body) => (table === 'resume_drafts' && body.status === 'draft'
    ? { status: 400, body: { message: 'bad column', details: `Failing row contains (${CV}, ${DRAFT}, ${JD})` } }
    : null) };
  await scenario({ hooks }, async ({ state, url }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 1);
    noCanary(r.out, 'db failure');
    assert.match(r.out, /failed code=db_400/);
    assert.equal(state.tables.runs[0].ok, false);
    assert.equal(state.tables.runs[0].error, 'db_400');
    for (const c of CANARIES) assert.ok(!JSON.stringify(state.tables.runs).includes(c));
  });
});

test('a thrown error that quotes the response body is never printed', async () => {
  const hooks = { PATCH: (table, body) => (table === 'resume_drafts' && body.status === 'draft'
    ? { status: 200, body: `${CV} ${DRAFT} not json at all` }
    : null) };
  await scenario({ hooks }, async ({ state, url }) => {
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 1);
    noCanary(r.out, 'thrown error');
    assert.match(r.out, /failed code=internal/);
    assert.equal(state.tables.runs[0].error, 'internal');
  });
});

test('the daily cap is honoured, in the plan and in the draft step', async () => {
  await scenario({ jobs: 3, cap: 2 }, async ({ state, url, calls }) => {
    const plan = await exec(['--plan'], url);
    assert.equal(plan.code, 0, plan.out);
    assert.match(plan.out, /plan todo=2 queued=3/);
    assert.match(plan.gh, /todo=2/);
    noCanary(plan.out, 'plan');

    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 2);
    const drafted = state.tables.resume_drafts.filter((d) => d.status === 'draft');
    assert.equal(drafted.length, 2);
    assert.equal(state.tables.resume_drafts.filter((d) => d.status === 'queued').length, 1);
    assert.match(r.out, /left=1/);

    // a third run the same day finds the cap used up
    const again = await exec(['--plan'], url);
    assert.match(again.out, /plan todo=0/);
  });
});

test('a disabled config does nothing', async () => {
  await scenario({}, async ({ state, url }) => {
    state.tables.settings[0].value.enabled = false;
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /plan todo=0/);
    assert.match(plan.gh, /todo=0/);
  });
});

test('thin descriptions are skipped, never drafted', async () => {
  await scenario({ jobs: 1 }, async ({ state, url, calls }) => {
    state.tables.job_descriptions[0].kind = 'summary';
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 0);
    assert.equal(draftOf(state).status, 'skipped');
    assert.equal(draftOf(state).reason, 'thin_description');
  });
});

test('a closed job is skipped as job_closed', async () => {
  await scenario({ jobs: 1 }, async ({ state, url, calls }) => {
    state.tables.jobs[0].closed = true;
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 0);
    assert.equal(draftOf(state).reason, 'job_closed');
  });
});

test('the plan queues a new well-scored job and skips a thin one', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    const base = { owner: PRIMARY, company: 'Initech Widgets', location: 'Remote', status: 'found', closed: false, eligible: true, score: 80, first_seen_at: iso(NOW - 3_600_000) };
    state.tables.jobs.push({ ...base, id: 'greenhouse:acme:1', title: 'A' }, { ...base, id: 'rr:2', title: 'B' }, { ...base, id: 'rr:3', title: 'C', score: 40 });
    state.tables.job_descriptions.push(
      { owner: PRIMARY, job_id: 'greenhouse:acme:1', description: 'x', kind: 'board', chars: 5000, sha: 'a' },
      { owner: PRIMARY, job_id: 'rr:2', description: 'x', kind: 'summary', chars: 300, sha: 'b' },
    );
    const r = await exec(['--plan'], url);
    assert.equal(r.code, 0, r.out);
    const byJob = Object.fromEntries(state.tables.resume_drafts.map((d) => [d.job_id, d]));
    assert.equal(byJob['greenhouse:acme:1'].status, 'queued');
    assert.equal(byJob['rr:2'].status, 'skipped');
    assert.equal(byJob['rr:2'].reason, 'thin_description');
    assert.equal(byJob['rr:3'], undefined, 'below the score floor');
    assert.match(r.out, /plan todo=1/);
  });
});

test('dry run writes nothing', async () => {
  await scenario({}, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { ...draftEnv, DRY_RUN: 'true' });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'dry run');
    assert.equal(calls(), 1);
    assert.equal(draftOf(state).status, 'queued');
    assert.equal(state.tables.notifications.length, 0);
    assert.equal(state.tables.runs.length, 0);
    assert.ok(!state.requests.some((q) => q.method !== 'GET'), 'no write request at all');
  });
});

test('every request is scoped to the primary owner, never the second user', async () => {
  await scenario({ jobs: 2 }, async ({ state, url }) => {
    await exec(['--plan'], url);
    await exec(draftArgs, url, draftEnv);
    assert.ok(state.requests.length > 10);
    for (const q of state.requests) {
      if (q.table === 'allowed_user' || (q.table === 'runs' && q.method === 'PATCH')) continue; // run rows are patched by their own uuid
      assert.ok(q.query.includes(`owner=eq.${PRIMARY}`) || q.method === 'POST', `${q.method} ${q.table} ${q.query}`);
      assert.ok(!q.query.includes(SECOND));
      for (const row of Array.isArray(q.body) ? q.body : []) assert.equal(row.owner, PRIMARY, `${q.table} body owner`);
    }
  });
});

test('a missing OAuth token fails the draft step without printing anything sensitive', async () => {
  await scenario({}, async ({ url }) => {
    const r = await exec(draftArgs, url, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.out, /failed code=no_token/);
  });
});
