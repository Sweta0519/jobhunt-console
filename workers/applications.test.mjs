// End to end test of workers/applications.mjs.
//
// The worker runs as a child process against an in-memory PostgREST (so the real
// db.mjs is exercised), a fake Claude binary, and a replaced fetch so nothing
// reaches the internet. Every piece of text that must never reach a public log
// carries a canary, and every scenario asserts stdout and stderr hold none of
// them. All data here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startStub } from './lib/resume/fixtures/stub-db.mjs';
import { syntheticMaster } from './lib/resume/fixtures/load.mjs';
import { validateForm } from './lib/apply/schema.mjs';

const WORKER = fileURLToPath(new URL('./applications.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./lib/apply/fixtures/fake-claude-apply.mjs', import.meta.url));
const PRELOAD = pathToFileURL(fileURLToPath(new URL('./lib/boards/fixtures/preload-fetch.mjs', import.meta.url))).href;
const GH = JSON.parse(readFileSync(fileURLToPath(new URL('./lib/apply/sources/fixtures/greenhouse.json', import.meta.url)), 'utf8'));

const CV = 'CANARY_CV_x7';
const JD = 'CANARY_JD_x7';
const LABEL = 'CANARY_LABEL_x7';
const PASTE = 'CANARY_PASTE_x7';
const ANS = 'CANARY_ANS_x7';
const TOKEN = 'CANARY_TOKEN_x7';
const CANARIES = [CV, JD, LABEL, PASTE, ANS, TOKEN];

const PRIMARY = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const posting = (scenario, countFile) =>
  `SCENARIO=${scenario} COUNTFILE=${countFile} ${JD}\n` + 'We need someone to debug REST integrations for customers. '.repeat(30);

function formWith(extra = []) {
  const { form } = validateForm({ source: 'greenhouse', completeness: 'complete', questions: [
    { label: 'Email', kind: 'email', required: true },
    { label: 'Gender', kind: 'short_text' },
    { label: `Why do you want to work here? ${LABEL}`, kind: 'long_text', required: true },
    { label: 'Do you have experience with n8n?', kind: 'long_text' },
    { label: 'Preferred team', kind: 'single_select', options: ['Alpha', 'Beta'] },
    { label: 'Resume', kind: 'file', role: 'resume_file' },
    ...extra,
  ] });
  return form;
}

function world({ scenario = 'success', jobs = 1, cap = 5, hard = 12, countFile, form = formWith(), withCover = false }) {
  const master = syntheticMaster();
  master.summary += ` ${CV}`;
  const t = {
    allowed_user: [{ user_id: PRIMARY, is_primary: true, label: 'p' }, { user_id: SECOND, is_primary: false, label: 's' }],
    settings: [{ owner: PRIMARY, key: 'application_config', value: { enabled: true, daily_cap: cap, hard_cap: hard, stop_at_utilization: 0.7, model: 'sonnet' } }],
    master_cv: [{ owner: PRIMARY, version: 1, doc: master, source_sha: 'x' }],
    jobs: [], job_descriptions: [], resume_drafts: [], application_forms: [], application_drafts: [], notifications: [], runs: [],
  };
  const f = withCover ? formWith([{ label: 'Cover letter', kind: 'long_text' }]) : form;
  for (let i = 1; i <= jobs; i++) {
    const id = `greenhouse:exampleco:${1000 + i}`;
    t.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: `Support Engineer ${i}`, location: 'Berlin, Germany', url: `https://boards.greenhouse.io/exampleco/jobs/${1000 + i}`, status: 'found', closed: false, eligible: true, score: 90 - i, first_seen_at: iso(NOW - 3_600_000) });
    const text = posting(scenario, countFile);
    t.job_descriptions.push({ owner: PRIMARY, job_id: id, description: text, kind: 'board', chars: text.length, sha: `sha${i}` });
    t.resume_drafts.push({ id: `cv-${i}`, owner: PRIMARY, job_id: id, master_version: 1, status: 'draft' });
    t.application_forms.push({ id: `form-${i}`, owner: PRIMARY, job_id: id, status: 'read', form: f, form_sha: 'fs', attempts: 0 });
    t.application_drafts.push({ id: `ad-${i}`, owner: PRIMARY, job_id: id, resume_draft_id: `cv-${i}`, master_version: 1, status: 'queued', attempts: 0, generation: 0, last_attempt_at: null, edits: {}, answers: null, cover_requested_at: null, not_before: null });
  }
  return { tables: t };
}

function exec(args, url, { env = {}, fixtures = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ap-')); // cwd without a .env.local
  const ghOut = join(dir, 'gh-output');
  const fx = join(dir, 'fixtures.json');
  const log = join(dir, 'asked.log');
  writeFileSync(ghOut, '');
  writeFileSync(log, '');
  writeFileSync(fx, JSON.stringify(fixtures));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, WORKER, ...args], {
      cwd: dir,
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'stub-key', GITHUB_OUTPUT: ghOut, FETCH_FIXTURES: fx, FETCH_LOG: log, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const gh = readFileSync(ghOut, 'utf8');
      const asked = readFileSync(log, 'utf8').split('\n').filter(Boolean);
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, gh, asked });
    });
  });
}

const draftArgs = ['--claude-node-script', FAKE];
const draftEnv = { CLAUDE_CODE_OAUTH_TOKEN: TOKEN };

async function scenario(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apc-'));
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
const draftOf = (state, i = 1) => state.tables.application_drafts.find((d) => d.id === `ad-${i}`);
const answerOf = (d, label, form) => d.answers.find((a) => a.q === form.questions.find((q) => q.label.startsWith(label)).id);

test('success: classifies, drafts, stores, notifies, logs no canary', async () => {
  await scenario({ withCover: true }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'success');
    assert.equal(calls(), 1);
    const d = draftOf(state);
    const form = state.tables.application_forms[0].form;
    assert.equal(d.status, 'draft');
    assert.equal(d.generation, 1);
    assert.equal(d.answers.length, form.questions.length);
    assert.deepEqual([answerOf(d, 'Email', form).cls, answerOf(d, 'Email', form).bank_key], ['fixed', 'email']);
    assert.equal(answerOf(d, 'Gender', form).cls, 'blank');
    assert.equal(answerOf(d, 'Why do you want', form).cls, 'drafted');
    assert.ok(answerOf(d, 'Why do you want', form).text.includes(ANS), 'the answer is stored, only never logged');
    assert.deepEqual([answerOf(d, 'Do you have experience', form).cls, answerOf(d, 'Do you have experience', form).why], ['needs_you', 'tool_unsupported']);
    assert.deepEqual(answerOf(d, 'Preferred team', form).option_ids, ['o0']);
    assert.equal(answerOf(d, 'Resume', form).cls, 'upload');
    assert.equal(answerOf(d, 'Cover letter', form).source, 'cover');
    assert.ok(d.cover_text.includes(ANS));
    assert.equal(d.generated_cover, d.cover_text);
    assert.deepEqual(d.edits, {});
    assert.equal(d.form_sha, 'fs');
    assert.equal(state.tables.notifications.length, 1);
    assert.equal(state.tables.notifications[0].dedupe_key, 'application:ad-1:1');
    assert.ok(!JSON.stringify(state.tables.notifications).match(/CANARY/));
    assert.equal(state.tables.runs[0].ok, true);
    assert.deepEqual(Object.keys(state.tables.runs[0].summary).sort(), ['drafted', 'failed', 'left', 'skipped', 'stopped']);
    assert.match(r.out, /draft job=[0-9a-f]{10} qs=\d+ fixed=1/);
  });
});

test('the answers bank is never touched by the worker', async () => {
  await scenario({ withCover: true }, async ({ state, url }) => {
    await exec(['--plan'], url);
    await exec(draftArgs, url, { env: draftEnv });
    assert.ok(state.requests.length > 5);
    assert.ok(!state.requests.some((q) => /answer_bank/.test(q.table) || /answer_bank/.test(q.query)), 'no request names answer_bank');
    assert.ok(!JSON.stringify(state.tables.application_drafts).match(/answer_bank/));
  });
});

test('one failed answer keeps the others; the model is asked once more, with codes only', async () => {
  const form = formWith([{ label: 'BADNUM story', kind: 'long_text' }]);
  await scenario({ form }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'facts');
    assert.equal(calls(), 2, 'exactly one retry');
    const d = draftOf(state);
    const f = state.tables.application_forms[0].form;
    assert.equal(d.status, 'draft');
    assert.deepEqual([answerOf(d, 'BADNUM', f).cls, answerOf(d, 'BADNUM', f).why], ['needs_you', 'facts_failed']);
    assert.equal(answerOf(d, 'Why do you want', f).cls, 'drafted', 'the rest is kept');
    assert.equal(answerOf(d, 'Email', f).cls, 'fixed');
  });
});

test('a tool the CV does not name is forced to needs_you and is not retried', async () => {
  await scenario({}, async ({ state, url, calls }) => {
    await exec(draftArgs, url, { env: draftEnv });
    assert.equal(calls(), 1);
    const f = state.tables.application_forms[0].form;
    assert.equal(answerOf(draftOf(state), 'Do you have experience', f).why, 'tool_unsupported');
  });
});

test('invalid model output twice: every model question needs you, the rules still apply', async () => {
  await scenario({ scenario: 'bad_schema' }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 2);
    const f = state.tables.application_forms[0].form;
    const d = draftOf(state);
    assert.equal(d.status, 'draft');
    assert.equal(answerOf(d, 'Why do you want', f).why, 'schema_invalid');
    assert.equal(answerOf(d, 'Email', f).cls, 'fixed');
  });
});

test('a failing cover letter is left empty and the answers survive', async () => {
  await scenario({ scenario: 'cover_fail', withCover: true }, async ({ state, url }) => {
    await exec(draftArgs, url, { env: draftEnv });
    const d = draftOf(state);
    const f = state.tables.application_forms[0].form;
    assert.equal(d.status, 'draft');
    assert.equal(d.cover_reason, 'facts_failed');
    assert.ok(!d.cover_text);
    assert.equal(answerOf(d, 'Cover letter', f).why, 'cover_failed');
    assert.equal(answerOf(d, 'Why do you want', f).cls, 'drafted');
  });
});

test('usage limit: rows stay queued, attempts reverted, parked, exit 0', async () => {
  await scenario({ scenario: 'usage_limit', jobs: 2 }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'usage_limit');
    assert.equal(calls(), 1, 'stops at the first limit');
    for (const i of [1, 2]) {
      const d = draftOf(state, i);
      assert.equal(d.status, 'queued');
      assert.equal(d.attempts, 0);
      assert.equal(d.last_attempt_at, null);
      assert.ok(Date.parse(d.not_before) > Date.now(), 'parked so the clock stays quiet');
    }
    assert.equal(state.tables.runs[0].summary.stopped, 'usage_limit');
    // the plan sees nothing to run while they are parked
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /plan todo=0/);
  });
});

test('overage stops after one draft, notifies and parks the rest', async () => {
  await scenario({ scenario: 'overage', jobs: 2 }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 1);
    assert.equal(state.tables.runs[0].summary.stopped, 'overage');
    assert.ok(state.tables.notifications.some((n) => n.kind === 'application_overage' && n.dedupe_key.startsWith('application_overage:')));
    assert.equal(state.tables.application_drafts.filter((d) => d.status === 'draft').length, 1);
    assert.ok(state.tables.application_drafts.filter((d) => d.status === 'queued').every((d) => d.not_before));
  });
});

test('stops at 70% utilization after a draft', async () => {
  await scenario({ scenario: 'near_limit', jobs: 3 }, async ({ state, url, calls }) => {
    await exec(draftArgs, url, { env: draftEnv });
    assert.equal(calls(), 1);
    assert.equal(state.tables.runs[0].summary.stopped, 'near_limit');
  });
});

test('auth failure: row stays queued, a bell is raised, exit 1', async () => {
  await scenario({ scenario: 'auth' }, async ({ state, url }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 1);
    noCanary(r.out, 'auth');
    assert.equal(draftOf(state).status, 'queued');
    assert.ok(state.tables.notifications.some((n) => n.kind === 'application_auth'));
  });
});

test('tool drift aborts the run and marks the row', async () => {
  await scenario({ scenario: 'drift', jobs: 2 }, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 1);
    assert.equal(calls(), 1);
    assert.deepEqual([draftOf(state).status, draftOf(state).reason], ['failed', 'tool_drift']);
    assert.equal(draftOf(state, 2).status, 'queued');
    assert.match(r.out, /drift=1/);
  });
});

test('the daily cap and the hard cap are honoured in the plan and in the draft step', async () => {
  await scenario({ jobs: 4, cap: 2, hard: 3 }, async ({ state, url, calls }) => {
    const plan = await exec(['--plan'], url);
    assert.equal(plan.code, 0, plan.out);
    assert.match(plan.out, /plan todo=2 queued=4/);
    assert.match(plan.gh, /todo=2/);
    assert.match(plan.gh, /browser=0/);
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    assert.equal(calls(), 2);
    assert.equal(state.tables.application_drafts.filter((d) => d.status === 'draft').length, 2);
    assert.equal((await exec(['--plan'], url)).out.match(/todo=(\d+)/)[1], '0', 'cap used up');
    // a cover letter she asks for jumps the queue and counts against the hard cap (3)
    const parked = state.tables.application_drafts.find((d) => d.status === 'queued');
    Object.assign(parked, { cover_requested_at: iso(NOW), not_before: null });
    const again = await exec(['--plan'], url);
    assert.match(again.out, /plan todo=1/);
  });
});

test('a disabled or missing config does nothing', async () => {
  await scenario({}, async ({ state, url }) => {
    state.tables.settings[0].value.enabled = false;
    const plan = await exec(['--plan'], url);
    assert.match(plan.out, /plan todo=0/);
    assert.match(plan.gh, /todo=0/);
    state.tables.settings.length = 0;
    assert.match((await exec(['--plan'], url)).out, /plan todo=0/);
    assert.equal((await exec(draftArgs, url, { env: draftEnv })).code, 0);
    assert.equal(draftOf(state).status, 'queued');
  });
});

test('dry run writes nothing', async () => {
  await scenario({}, async ({ state, url, calls }) => {
    const r = await exec(draftArgs, url, { env: { ...draftEnv, DRY_RUN: 'true' } });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'dry run');
    assert.equal(calls(), 1);
    assert.equal(draftOf(state).status, 'queued');
    assert.equal(state.tables.notifications.length, 0);
    assert.equal(state.tables.runs.length, 0);
    assert.ok(!state.requests.some((q) => q.method !== 'GET'), 'no write request at all');
  });
});

test('her edits survive a run in flight: the write is conditional on drafting', async () => {
  const hooks = { PATCH: (table, body) => {
    // she saves an edit (and the row leaves drafting) just before the worker writes its result
    if (table === 'application_drafts' && body.status === 'draft' && body.answers) {
      Object.assign(world.current.tables.application_drafts[0], { status: 'discarded', edits: { q_x: { text: 'mine' } } });
    }
    return null;
  } };
  await scenario({ hooks }, async ({ state, url }) => {
    world.current = state;
    await exec(draftArgs, url, { env: draftEnv });
    const d = draftOf(state);
    assert.equal(d.status, 'discarded');
    assert.deepEqual(d.edits, { q_x: { text: 'mine' } });
    assert.equal(d.answers, null, 'nothing overwritten');
  });
});

test('a cover-only request leaves answers and edits alone', async () => {
  await scenario({}, async ({ state, url, calls }) => {
    const d = draftOf(state);
    Object.assign(d, { status: 'queued', answers: [{ q: 'q_keep', cls: 'blank' }], edits: { q_keep: { text: 'hers' } }, cover_requested_at: iso(NOW), generation: 1, fact_flags: [] });
    const r = await exec(draftArgs, url, { env: draftEnv });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'cover only');
    assert.equal(calls(), 1);
    assert.deepEqual(d.answers, [{ q: 'q_keep', cls: 'blank' }]);
    assert.deepEqual(d.edits, { q_keep: { text: 'hers' } });
    assert.equal(d.status, 'draft');
    assert.ok(d.cover_text.includes(ANS));
    assert.equal(d.cover_requested_at, null);
    assert.equal(d.generation, 2);
  });
});

test('a cover-only request on a job with no readable form still drafts a letter', async () => {
  await scenario({}, async ({ state, url }) => {
    Object.assign(state.tables.application_forms[0], { status: 'needs_paste', form: null, reason: 'no_reader' });
    Object.assign(draftOf(state), { status: 'queued', cover_requested_at: iso(NOW) });
    await exec(['--plan'], url);
    assert.equal(draftOf(state).status, 'queued', 'a cover request keeps the draft alive');
    await exec(draftArgs, url, { env: draftEnv });
    const d = draftOf(state);
    assert.equal(d.status, 'draft');
    assert.deepEqual(d.answers, []);
    assert.ok(d.cover_text.includes(ANS));
  });
});

test('every request is scoped to the primary owner, never the second user', async () => {
  await scenario({ jobs: 2 }, async ({ state, url }) => {
    await exec(['--plan'], url);
    await exec(draftArgs, url, { env: draftEnv });
    assert.ok(state.requests.length > 10);
    for (const q of state.requests) {
      if (q.table === 'allowed_user' || (q.table === 'runs' && q.method === 'PATCH')) continue;
      assert.ok(q.query.includes(`owner=eq.${PRIMARY}`) || q.method === 'POST', `${q.method} ${q.table} ${q.query}`);
      assert.ok(!q.query.includes(SECOND));
      for (const row of Array.isArray(q.body) ? q.body : []) assert.equal(row.owner, PRIMARY, `${q.table} body owner`);
    }
  });
});

test('a missing OAuth token fails the draft step without printing anything sensitive', async () => {
  await scenario({}, async ({ url }) => {
    const r = await exec(draftArgs, url, { env: { CLAUDE_CODE_OAUTH_TOKEN: '' } });
    assert.equal(r.code, 1);
    assert.match(r.out, /failed code=no_token/);
  });
});

// --- plan: rows, reads, paste -----------------------------------------------------
const GH_URL = 'https://boards-api.greenhouse.io/v1/boards/exampleco/jobs/1001?questions=true';

test('the plan creates both rows for a ready CV draft, reads Greenhouse and queues the draft', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    const id = 'greenhouse:exampleco:1001';
    state.tables.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: 'Support Engineer', location: 'Berlin, Germany', url: 'https://boards.greenhouse.io/exampleco/jobs/1001', status: 'found', closed: false, score: 90 });
    state.tables.resume_drafts.push({ id: 'cv-1', owner: PRIMARY, job_id: id, master_version: 1, status: 'approved' });
    const r = await exec(['--plan'], url, { fixtures: { [GH_URL]: { json: GH } } });
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'plan');
    assert.ok(!r.out.includes('exampleco'), 'no company token in the log');
    assert.deepEqual(r.asked, [GH_URL], 'one fixed-host request');
    const f = state.tables.application_forms[0];
    assert.equal(f.status, 'read');
    assert.equal(f.source, 'greenhouse');
    assert.equal(f.apply_url, 'https://boards.greenhouse.io/exampleco/jobs/1001');
    assert.equal(f.completeness, 'complete');
    assert.ok(f.form.questions.length >= 8);
    assert.ok(f.form_sha);
    const d = state.tables.application_drafts[0];
    assert.deepEqual([d.status, d.resume_draft_id, d.master_version], ['queued', 'cv-1', 1]);
    assert.match(r.out, /plan todo=1 queued=1/);
    assert.match(r.out, /read source=greenhouse qs=\d+ partial=0/);
    assert.match(r.gh, /todo=1\nbrowser=0/);
    // idempotent: a second plan reads and creates nothing
    const again = await exec(['--plan'], url, { fixtures: { [GH_URL]: { json: GH } } });
    assert.deepEqual(again.asked, []);
    assert.equal(state.tables.application_forms.length, 1);
    assert.equal(state.tables.application_drafts.length, 1);
  });
});

test('no row is made for a closed job or a CV that is not ready', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    const base = { owner: PRIMARY, company: 'Initech Widgets', title: 'T', location: 'Remote', status: 'found', score: 90, url: null };
    state.tables.jobs.push({ ...base, id: 'rr:1', closed: true }, { ...base, id: 'rr:2', closed: false }, { ...base, id: 'rr:3', closed: false });
    state.tables.resume_drafts.push(
      { id: 'c1', owner: PRIMARY, job_id: 'rr:1', master_version: 1, status: 'draft' },
      { id: 'c2', owner: PRIMARY, job_id: 'rr:2', master_version: 1, status: 'queued' },
      { id: 'c3', owner: PRIMARY, job_id: 'rr:3', master_version: 1, status: 'discarded' },
    );
    await exec(['--plan'], url);
    assert.equal(state.tables.application_forms.length, 0);
    assert.equal(state.tables.application_drafts.length, 0);
  });
});

test('an unreadable job goes to needs_paste with a reason, and its draft is skipped without a Claude call', async () => {
  await scenario({ jobs: 0 }, async ({ state, url, calls }) => {
    const id = 'rr:feed1';
    state.tables.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: 'T', location: 'Remote', url: 'https://example.invalid/jobs/1', status: 'found', closed: false, score: 90 });
    state.tables.resume_drafts.push({ id: 'cv-1', owner: PRIMARY, job_id: id, master_version: 1, status: 'draft' });
    const r = await exec(['--plan'], url);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.asked, [], 'the listing page is never opened');
    assert.deepEqual([state.tables.application_forms[0].status, state.tables.application_forms[0].reason], ['needs_paste', 'feed_listing']);
    assert.deepEqual([state.tables.application_drafts[0].status, state.tables.application_drafts[0].reason], ['skipped', 'no_questions']);
    assert.match(r.out, /plan todo=0/);
    assert.equal(calls(), 0);
  });
});

test('a failed read keeps nothing wrong: 404 means paste, a changed shape means paste', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    const id = 'greenhouse:exampleco:1001';
    state.tables.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: 'T', location: 'Remote', url: null, status: 'found', closed: false, score: 90 });
    state.tables.resume_drafts.push({ id: 'cv-1', owner: PRIMARY, job_id: id, master_version: 1, status: 'draft' });
    await exec(['--plan'], url); // fetch answers 404
    assert.deepEqual([state.tables.application_forms[0].status, state.tables.application_forms[0].reason], ['needs_paste', 'not_found']);
  });
});

test('pasted text is parsed by the worker, merged by mode and cleared; the pasted text never reaches the log', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    const id = 'rr:feed1';
    state.tables.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: 'T', location: 'Remote', url: null, status: 'found', closed: false, score: 90 });
    state.tables.resume_drafts.push({ id: 'cv-1', owner: PRIMARY, job_id: id, master_version: 1, status: 'draft' });
    await exec(['--plan'], url);
    const f = state.tables.application_forms[0];
    assert.equal(f.status, 'needs_paste');
    Object.assign(f, { pasted_text: `Why do you want this job? ${PASTE} *\nWhich team?\n- Alpha\n- Beta`, paste_mode: 'replace', status: 'queued' });
    const r = await exec(['--plan'], url);
    assert.equal(r.code, 0, r.out);
    noCanary(r.out, 'paste');
    assert.deepEqual([f.status, f.source, f.pasted_text, f.paste_mode], ['read', 'paste', null, null]);
    assert.equal(f.form.questions.length, 2);
    assert.equal(f.form.questions[0].required, true);
    assert.equal(f.completeness, 'may_be_incomplete');
    assert.equal(state.tables.application_drafts[0].status, 'queued', 'a skipped draft is requeued once the form is read');
    assert.match(r.out, /read source=paste qs=2 partial=1/);
    assert.match(r.out, /plan todo=1/);

    // add mode merges later pages
    Object.assign(f, { pasted_text: 'Page two question', paste_mode: 'add', status: 'queued' });
    await exec(['--plan'], url);
    assert.equal(f.form.questions.length, 3);
    assert.equal(f.source, 'paste');

    // a hostile paste is refused with a fixed code and wiped
    Object.assign(f, { pasted_text: '12345', paste_mode: 'replace', status: 'queued' });
    const bad = await exec(['--plan'], url);
    assert.equal(f.reason, 'paste_invalid');
    assert.equal(f.pasted_text, null);
    assert.ok(!bad.out.includes('12345'));
  });
});

test('three shape changes in a day raise one bell', async () => {
  await scenario({ jobs: 0 }, async ({ state, url }) => {
    for (let i = 1; i <= 3; i++) {
      const id = `greenhouse:exampleco:${1000 + i}`;
      state.tables.jobs.push({ owner: PRIMARY, id, company: 'Initech Widgets', title: 'T', location: 'Remote', url: null, status: 'found', closed: false, score: 90 });
      state.tables.resume_drafts.push({ id: `cv-${i}`, owner: PRIMARY, job_id: id, master_version: 1, status: 'draft' });
    }
    const fixtures = Object.fromEntries([1, 2, 3].map((i) => [`https://boards-api.greenhouse.io/v1/boards/exampleco/jobs/${1000 + i}?questions=true`, { json: { questions: 'moved' } }]));
    const r = await exec(['--plan'], url, { fixtures });
    assert.equal(r.code, 0, r.out);
    assert.equal(state.tables.notifications.filter((n) => n.kind === 'application_shape').length, 1);
    await exec(['--plan'], url, { fixtures });
    assert.equal(state.tables.notifications.filter((n) => n.kind === 'application_shape').length, 1, 'deduped by date');
  });
});
