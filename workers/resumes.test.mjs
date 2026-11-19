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
import { syntheticMaster, goodOutput } from './lib/resume/fixtures/load.mjs';
import { composeDoc } from './lib/resume/compose.mjs';

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
    assert.deepEqual(Object.keys(state.tables.runs[0].summary).sort(), ['drafted', 'failed', 'left', 'recheck_failed', 'rechecked', 'skipped', 'stopped']);
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

// --- backlog, priority-free bar, queue ceiling, hashed ids -------------------------
const addJob = (state, id, extra = {}) => {
  const base = { owner: PRIMARY, company: 'Initech Widgets', company_slug: 'initech-widgets', title: id, location: 'Remote', status: 'found', closed: false, eligible: true, score: 80, first_seen_at: iso(NOW - 3_600_000) };
  state.tables.jobs.push({ ...base, id, ...extra });
  state.tables.job_descriptions.push({ owner: PRIMARY, job_id: id, description: 'x', kind: 'board', chars: 5000, sha: id });
};

test('a backlog row is not queued on its own; one she asked for is queued', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    addJob(state, 'ashby:acme:old', { backlog: true });
    addJob(state, 'ashby:acme:asked', { backlog: true, draft_requested_at: iso(NOW) });
    addJob(state, 'ashby:acme:normal', { score: 75 });
    const r = await exec(['--plan'], url);
    assert.equal(r.code, 0, r.out);
    const byJob = Object.fromEntries(state.tables.resume_drafts.map((d) => [d.job_id, d]));
    assert.equal(byJob['ashby:acme:old'], undefined);
    assert.equal(byJob['ashby:acme:asked'].status, 'queued');
    assert.equal(byJob['ashby:acme:normal'].status, 'queued');
  });
});

test('one bar for every company: 61 is not queued, 70 is', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    addJob(state, 'ashby:acme:a', { score: 61 });
    addJob(state, 'ashby:acme:b', { score: 70 });
    await exec(['--plan'], url);
    const ids = state.tables.resume_drafts.map((d) => d.job_id);
    assert.deepEqual(ids, ['ashby:acme:b']);
  });
});

test('queue ceiling: 40 candidates with a cap of 5 queue at most 15, the best ones; a better one arriving later gets in', async () => {
  await scenario({ jobs: 0, cap: 5 }, async ({ state, url }) => {
    for (let i = 0; i < 40; i++) addJob(state, `ashby:acme:j${String(i).padStart(2, '0')}`, { score: 70 + (i % 30) });
    await exec(['--plan'], url);
    const queued = state.tables.resume_drafts.filter((d) => d.status === 'queued');
    assert.equal(queued.length, 15);
    const scoreOf = (id) => state.tables.jobs.find((j) => j.id === id).score;
    const worstQueued = Math.min(...queued.map((d) => scoreOf(d.job_id)));
    const bestLeft = Math.max(...state.tables.jobs.filter((j) => !queued.some((d) => d.job_id === j.id)).map((j) => j.score));
    assert.ok(worstQueued >= bestLeft, `${worstQueued} < ${bestLeft}`);
    // a second plan adds nothing while the queue is full
    await exec(['--plan'], url);
    assert.equal(state.tables.resume_drafts.length, 15);
    // after drafts leave the queue, the next best take the freed places
    for (const d of queued.slice(0, 5)) d.status = 'draft';
    await exec(['--plan'], url);
    assert.equal(state.tables.resume_drafts.filter((d) => d.status === 'queued').length, 15);
  });
});

test('draft order on equal score: newest first; logs carry a hash, never the id', async () => {
  await scenario({ jobs: 0, cap: 5 }, async ({ state, url }) => {
    addJob(state, 'ashby:acme:older', { first_seen_at: iso(NOW - 5 * 3_600_000) });
    addJob(state, 'ashby:acme:newer', { first_seen_at: iso(NOW - 1 * 3_600_000) });
    for (const id of ['ashby:acme:older', 'ashby:acme:newer']) {
      const text = posting('success', join(tmpdir(), 'unused-count'));
      state.tables.job_descriptions.find((d) => d.job_id === id).description = text;
      state.tables.job_descriptions.find((d) => d.job_id === id).chars = text.length;
      state.tables.resume_drafts.push({ id: `d-${id}`, owner: PRIMARY, job_id: id, master_version: 1, status: 'queued', attempts: 0, generation: 0, last_attempt_at: null });
    }
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes('acme'), 'no company token in the log');
    assert.match(r.out, /draft job=[0-9a-f]{10} /);
    const order = state.tables.resume_drafts.filter((d) => d.drafted_at).sort((a, b) => a.drafted_at.localeCompare(b.drafted_at)).map((d) => d.job_id);
    assert.deepEqual(order, ['ashby:acme:newer', 'ashby:acme:older']);
  });
});

test('a manually dispatched job id comes from the event payload and is never printed', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    addJob(state, 'ashby:acme:manual', { score: 10 }); // below the bar: only an explicit request queues it
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    const ev = join(dir, 'event.json');
    writeFileSync(ev, JSON.stringify({ inputs: { job: 'ashby:acme:manual', dry_run: 'false' } }));
    try {
      const r = await exec(['--plan'], url, { GITHUB_EVENT_PATH: ev });
      assert.equal(r.code, 0, r.out);
      assert.match(r.gh, /todo=1/);
      assert.equal(state.tables.resume_drafts.find((d) => d.job_id === 'ashby:acme:manual').status, 'queued');
      assert.ok(!r.out.includes('manual') && !r.out.includes('acme'), 'the id is not in the log');
      // JOB_ID in env no longer selects a job
      const other = await exec(['--plan'], url, { JOB_ID: 'ashby:acme:nothing', GITHUB_EVENT_PATH: '' });
      assert.equal(other.code, 0, other.out);
      assert.match(other.out, /plan todo=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- requirement rechecks after her edits --------------------------------------------
const UPD = '2026-11-19T10:00:00.123456+00:00';
const REQS = () => [
  { text: 'REST API debugging', kind: 'must', status: 'gap', evidence: [], note: 'old note' },
  { text: 'Kubernetes', kind: 'nice', status: 'gap', evidence: [], note: '' },
];

/** An edited draft with a recheck pending. The marker in the summary drives the fake CLI. */
function addEdited(state, countFile, scenarioName, i, extra = {}) {
  const doc = composeDoc(state.tables.master_cv[0].doc, goodOutput());
  doc.summary = `SCENARIO=${scenarioName} COUNTFILE=${countFile} edited by her`;
  const jobId = `ashby:acme:e${i}`;
  addJob(state, jobId);
  const row = {
    id: `e-${i}`, owner: PRIMARY, job_id: jobId, master_version: 1, status: 'draft', attempts: 0, generation: 1,
    last_attempt_at: null, doc, requirements: REQS(), gaps: REQS().map(({ text, kind, note }) => ({ text, kind, note })),
    fact_flags: [], updated_at: UPD, requirements_requested_at: iso(NOW - 60_000 * (10 - i)), requirements_attempts: 0, requirements_reason: null,
    ...extra,
  };
  state.tables.resume_drafts.push(row);
  return row;
}
const rowOf = (state, i) => state.tables.resume_drafts.find((d) => d.id === `e-${i}`);

test('recheck: an empty queue with the cap used still plans one run; statuses are updated without touching updated_at, doc or last_attempt_at', async () => {
  await scenario({ jobs: 0, cap: 1 }, async ({ state, url, countFile, calls }) => {
    state.tables.resume_drafts.push({ id: 'used', owner: PRIMARY, job_id: 'x:y:z', master_version: 1, status: 'failed', attempts: 0, generation: 0, last_attempt_at: iso(Date.now()) });
    const e = addEdited(state, countFile, 'recheck_ok', 1, { last_attempt_at: iso(NOW - 86_400_000 * 3) });
    const before = JSON.stringify(e.doc);
    const lastAttempt = e.last_attempt_at;
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /plan todo=1 .*rechecks=1/);
    assert.match(plan.gh, /todo=1/);
    noCanary(plan.out, 'plan');
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'recheck');
    assert.equal(calls(), 1);
    const d = rowOf(state, 1);
    assert.deepEqual(d.requirements.map((q) => q.status), ['met', 'met']);
    assert.deepEqual(d.requirements.map((q) => q.text), ['REST API debugging', 'Kubernetes']);
    assert.deepEqual(d.gaps, []);
    assert.equal(d.requirements_requested_at, null);
    assert.ok(d.requirements_checked_at);
    assert.equal(d.requirements_reason, null);
    assert.equal(d.updated_at, UPD);
    assert.equal(JSON.stringify(d.doc), before);
    assert.equal(d.last_attempt_at, lastAttempt);
    assert.equal(d.status, 'draft');
    assert.equal(state.tables.notifications.length, 0);
    assert.match(r.out, /recheck job=[0-9a-f]{10}\n/);
    assert.equal(state.tables.runs[0].summary.rechecked, 1);
    const patch = state.requests.find((q) => q.method === 'PATCH' && q.table === 'resume_drafts');
    assert.ok(patch.query.includes('updated_at=eq.') && patch.query.includes('requirements_requested_at=eq.'));
    assert.ok(!('updated_at' in patch.body));
  });
});

test('recheck race: an edit between read and write wins, the new request stays pending', async () => {
  let hit = false;
  const NEWER = '2026-11-19T11:00:00.000000+00:00';
  let state0;
  const hooks = { PATCH: (table, body) => {
    if (table === 'resume_drafts' && body.requirements && !hit) {
      hit = true;
      const d = state0.tables.resume_drafts.find((x) => x.id === 'e-1');
      d.updated_at = NEWER; d.requirements_requested_at = NEWER;
    }
    return null;
  } };
  await scenario({ jobs: 0, hooks }, async ({ state, url, countFile }) => {
    state0 = state;
    addEdited(state, countFile, 'recheck_ok', 1);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'race');
    assert.ok(hit);
    const d = rowOf(state, 1);
    assert.deepEqual(d.requirements.map((q) => q.status), ['gap', 'gap']);
    assert.equal(d.requirements_requested_at, NEWER);
    assert.equal(d.updated_at, NEWER);
  });
});

test('recheck: two bad answers leave the old requirements, clear the request, set recheck_invalid', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'recheck_bad', 1);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'recheck_bad');
    assert.equal(calls(), 2);
    const d = rowOf(state, 1);
    assert.deepEqual(d.requirements.map((q) => q.status), ['gap', 'gap']);
    assert.equal(d.requirements_requested_at, null);
    assert.equal(d.requirements_reason, 'recheck_invalid');
    assert.equal(d.requirements_attempts, 0);
    assert.equal(d.updated_at, UPD);
    assert.equal(state.tables.runs[0].summary.recheck_failed, 1);
  });
});

test('recheck: a bad first answer is retried once and the second is applied', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'recheck_bad_once', 1);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'recheck_bad_once');
    assert.equal(calls(), 2);
    const d = rowOf(state, 1);
    assert.deepEqual(d.requirements.map((q) => q.status), ['met', 'met']);
    assert.equal(d.requirements_requested_at, null);
    assert.equal(d.requirements_reason, null);
  });
});

test('recheck_cap 2 with 5 pending: 2 calls, 3 still pending, plan counts 2', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, countFile, calls }) => {
    state.tables.settings[0].value.recheck_cap = 2;
    for (let i = 1; i <= 5; i++) addEdited(state, countFile, 'recheck_ok', i);
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /plan todo=2 .*rechecks=2/);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'cap');
    assert.equal(calls(), 2);
    assert.equal(state.tables.resume_drafts.filter((d) => d.requirements_requested_at).length, 3);
    // oldest request first
    assert.equal(rowOf(state, 1).requirements_requested_at, null);
    assert.equal(rowOf(state, 2).requirements_requested_at, null);
  });
});

test('recheck usage limit: no write, request kept, no draft attempted, exit 0', async () => {
  await scenario({ jobs: 1 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'usage_limit', 1);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'recheck usage_limit');
    assert.equal(calls(), 1, 'the draft was not attempted');
    const d = rowOf(state, 1);
    assert.ok(d.requirements_requested_at);
    assert.deepEqual(d.requirements.map((q) => q.status), ['gap', 'gap']);
    assert.ok(!state.requests.some((q) => q.method === 'PATCH' && q.table === 'resume_drafts'), 'nothing written to a draft');
    assert.equal(draftOf(state).status, 'queued');
    assert.equal(draftOf(state).attempts, 0);
    assert.equal(state.tables.runs[0].ok, true);
    assert.equal(state.tables.runs[0].summary.stopped, 'usage_limit');
    assert.match(r.out, /stopped=usage_limit/);
  });
});

test('recheck ignores requests on queued or discarded drafts', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'recheck_ok', 1, { status: 'discarded' });
    addEdited(state, countFile, 'recheck_ok', 2, { status: 'queued', job_id: 'ashby:acme:e2' });
    state.tables.jobs.find((j) => j.id === 'ashby:acme:e2').closed = true; // the queued row is skipped, not drafted
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /rechecks=0/);
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 0);
    assert.doesNotMatch(r.out, /recheck job=/);
    assert.ok(rowOf(state, 1).requirements_requested_at);
    assert.ok(rowOf(state, 2).requirements_requested_at);
  });
});

test('recheck dry run: Claude is called, nothing is written', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'recheck_ok', 1);
    const r = await exec(draftArgs, url, { ...draftEnv, DRY_RUN: 'true' });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'recheck dry');
    assert.equal(calls(), 1);
    assert.ok(rowOf(state, 1).requirements_requested_at);
    assert.ok(!state.requests.some((q) => q.method !== 'GET'), 'no write request at all');
  });
});

test('a successful redraft clears the recheck request', async () => {
  await scenario({ jobs: 1 }, async ({ state, url }) => {
    Object.assign(draftOf(state), { requirements_requested_at: iso(NOW), requirements_reason: 'timeout', requirements_attempts: 2 });
    const r = await exec(draftArgs, url, draftEnv);
    assert.equal(r.code, 0, r.out);
    const d = draftOf(state);
    assert.equal(d.status, 'draft');
    assert.equal(d.requirements_requested_at, null);
    assert.equal(d.requirements_checked_at, null);
    assert.equal(d.requirements_reason, null);
    assert.equal(d.requirements_attempts, 0);
  });
});

test('a --job dispatch runs no recheck', async () => {
  await scenario({ jobs: 1 }, async ({ state, url, countFile, calls }) => {
    addEdited(state, countFile, 'recheck_ok', 1);
    const r = await exec([...draftArgs, '--job', 'greenhouse:acme:1001'], url, draftEnv);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'job dispatch');
    assert.equal(calls(), 1, 'only the dispatched draft');
    assert.equal(draftOf(state).status, 'draft');
    assert.ok(rowOf(state, 1).requirements_requested_at, 'the recheck waits for the scheduled run');
  });
});
