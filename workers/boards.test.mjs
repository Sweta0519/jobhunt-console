// The probe worker, pure rules first and then the real worker against the
// in-memory database with fixture answers. All names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { candidateStatus, nextProbeAt, pickCompanies, probeRank } from './boards.mjs';
import { startStub } from './lib/resume/fixtures/stub-db.mjs';
import { runWorker } from './lib/boards/fixtures/exec.mjs';

const BOARDS = fileURLToPath(new URL('./boards.mjs', import.meta.url));
const A = '00000000-0000-4000-8000-0000000000b1';
const B = '00000000-0000-4000-8000-0000000000b2';
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

test('review needs a relevant title or a marked company, else it is parked; rejected and empty store nothing', () => {
  assert.equal(candidateStatus('confirmed', 0, {}), 'confirmed');
  assert.equal(candidateStatus('review', 2, {}), 'review');
  assert.equal(candidateStatus('review', 0, {}), 'parked');
  assert.equal(candidateStatus('review', 0, { is_target: true }), 'review');
  assert.equal(candidateStatus('review', 0, { priority: true }), 'review');
  assert.equal(candidateStatus('rejected', 5, {}), null);
  assert.equal(candidateStatus('empty', 5, {}), null);
});

test('next look: a month plus up to 3 days after a clean run, a day after a failure', () => {
  const now = 1_000_000_000_000;
  assert.equal(Date.parse(nextProbeAt(true, now, () => 0)) - now, 30 * DAY);
  assert.ok(Date.parse(nextProbeAt(true, now, () => 0.999)) - now < 33 * DAY);
  assert.equal(Date.parse(nextProbeAt(false, now)) - now, DAY);
});

test('pick: due companies without a board, requested first, blocked ones never, limit and requested-only', () => {
  const now = Date.now();
  const list = [
    { slug: 'a', name: 'A' },
    { slug: 'b', name: 'B', probe_requested_at: iso(now) },
    { slug: 'c', name: 'C', board_block: 'staffing' },
    { slug: 'd', name: 'D', next_probe_at: iso(now + DAY) },
    { slug: 'e', name: 'E', is_target: true },
    { slug: 'f', name: 'F', board_kind: 'ashby', board_token: 'f', board_fail_count: 14 },
    { slug: 'g', name: 'G', board_kind: 'ashby', board_token: 'g', board_fail_count: 2 },
  ];
  assert.deepEqual(pickCompanies(list, { now }).map((c) => c.slug), ['b', 'e', 'a', 'f']);
  assert.deepEqual(pickCompanies(list, { now, limit: 2 }).map((c) => c.slug), ['b', 'e']);
  assert.deepEqual(pickCompanies(list, { now, requestedOnly: true }).map((c) => c.slug), ['b']);
  assert.ok(probeRank({ probe_requested_at: 'x' }) < probeRank({ priority: true }));
});

// --- the worker ---------------------------------------------------------------
const longHtml = (extra) => `<p>${'We build tools for teams and we are hiring. '.repeat(8)}${extra}</p>`;
const gh = (name, titles, link) => ({ status: 200, json: { jobs: titles.map((t, i) => ({ id: 100 + i, title: t, absolute_url: `https://example.invalid/${i}`, location: { name: 'Berlin' }, content: longHtml(link), company_name: name, first_published: iso(Date.now() - 3 * DAY) })) } });
const ash = (extra, titles) => ({ status: 200, json: { jobs: titles.map((t, i) => ({ id: `id-${i}`, title: t, jobUrl: `https://example.invalid/${i}`, descriptionHtml: longHtml(extra), isListed: true })) } });

function world() {
  const t = {
    allowed_user: [{ user_id: A, is_primary: true, label: 'canarylabel-a' }, { user_id: B, is_primary: false, label: 'canarylabel-b' }],
    settings: [{ owner: B, key: 'jobfit_profile', value: { roles: ['support engineer'], skills: { core: ['api'] } } }],
    companies: [
      { owner: A, slug: 'initech-canarycorp', name: 'Initech Canarycorp', is_target: true },
      { owner: A, slug: 'zeta-staffing-partners', name: 'Zeta Staffing Partners' },
      { owner: A, slug: 'unmatched-widgets', name: 'Unmatched Widgets' },
      { owner: A, slug: 'parked-widgets', name: 'Parked Widgets' },
      { owner: A, slug: 'reviewed-widgets', name: 'Reviewed Widgets' },
      { owner: A, slug: 'flaky-co', name: 'Flaky Co' },
      { owner: A, slug: 'shared-co', name: 'Shared Co' },
      { owner: B, slug: 'shared-co', name: 'Shared Co' },
      { owner: B, slug: 'beta-owner-co', name: 'Beta Owner Co' },
    ],
    board_candidates: [{ owner: A, company_slug: 'unmatched-widgets', kind: 'ashby', token: 'unmatchedwidgets', status: 'rejected' }],
    jobs: [], notifications: [], runs: [],
  };
  return { tables: t };
}

const U = (kind, token) =>
  ({
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`,
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  })[kind];

const fixtures = {
  [U('greenhouse', 'initechcanarycorp')]: gh('Initech Canarycorp', ['Technical Support Engineer'], 'Visit https://initechcanarycorp.com'),
  [U('ashby', 'unmatchedwidgets')]: ash('About Unmatched Widgets', ['Technical Support Engineer']),
  [U('ashby', 'parkedwidgets')]: ash('About Parked Widgets', ['Backend Engineer']),
  [U('ashby', 'reviewedwidgets')]: ash('About Reviewed Widgets', ['Technical Support Engineer']),
  [U('ashby', 'flaky')]: { status: 503, text: 'busy' },
  [U('ashby', 'flakyco')]: { status: 503, text: 'busy' },
  [U('ashby', 'zetastaffingpartners')]: ash('About Zeta Staffing Partners', ['Technical Support Engineer']),
  [U('ashby', 'betaownerco')]: ash('About Beta Owner Co', ['Support Engineer']),
};

test('probe: confirms, parks, reviews, keeps her decisions, blocks staffing, spaces the next look', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(BOARDS, ['--owner', 'canarylabel-a'], { url: stub.url, fixtures });
    assert.equal(r.code, 0, r.out);
    const co = (slug, owner = A) => st.tables.companies.find((c) => c.slug === slug && c.owner === owner);
    const cand = (slug) => st.tables.board_candidates.find((c) => c.company_slug === slug && c.owner === A);
    // confirmed: name and its own domain agree
    assert.equal(co('initech-canarycorp').board_kind, 'greenhouse');
    assert.equal(co('initech-canarycorp').board_token, 'initechcanarycorp');
    assert.equal(co('initech-canarycorp').board_baselined_at, null, 'first poll is protected');
    // a mention alone never enables a board
    assert.equal(co('reviewed-widgets').board_kind, undefined);
    assert.equal(cand('reviewed-widgets').status, 'review');
    assert.equal(cand('parked-widgets').status, 'parked');
    // her earlier decision survives
    assert.equal(cand('unmatched-widgets').status, 'rejected');
    // staffing: blocked, never fetched
    assert.equal(co('zeta-staffing-partners').board_block, 'staffing');
    assert.ok(!r.asked.some((u) => u.includes('zetastaffing')));
    // clean miss: a month out. Transport failure: a day.
    const clean = Date.parse(co('shared-co').next_probe_at) - Date.now();
    assert.ok(clean > 29 * DAY && clean < 33.1 * DAY, `clean ${clean / DAY}`);
    const flaky = Date.parse(co('flaky-co').next_probe_at) - Date.now();
    assert.ok(flaky > 0.9 * DAY && flaky < 1.1 * DAY, `flaky ${flaky / DAY}`);
    assert.equal(co('flaky-co').probe_requested_at, null);
    // the other person is untouched by her run
    assert.equal(co('beta-owner-co', B).next_probe_at, undefined);
    assert.equal(co('shared-co', B).next_probe_at, undefined);
    assert.ok(!r.asked.some((u) => u.includes('betaownerco')));
    // no domain and not marked: no request to any company site
    assert.ok(!r.asked.some((u) => u.includes('robots.txt')), r.asked.join(' '));
    // every database request for a company is scoped to an owner
    for (const q of st.requests.filter((q) => ['companies', 'board_candidates'].includes(q.table) && q.method !== 'POST')) {
      assert.match(q.query, /owner=eq\./, `${q.method} ${q.table} ${q.query}`);
    }
    for (const q of st.requests.filter((q) => q.method === 'POST' && ['companies', 'board_candidates'].includes(q.table))) {
      assert.ok(q.body.every((row) => row.owner === A), 'rows carry her owner only');
    }
    assert.equal(st.tables.notifications.filter((n) => n.kind === 'boards_review').length, 1);
    assert.equal(st.tables.runs.at(-1).ok, true);
  } finally {
    await stub.close();
  }
}, { timeout: 60000 });

test('probe: a second person is probed only in their own rows', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(BOARDS, ['--owner', 'canarylabel-b'], { url: stub.url, fixtures });
    assert.equal(r.code, 0, r.out);
    assert.ok(st.tables.companies.find((c) => c.slug === 'beta-owner-co' && c.owner === B).next_probe_at);
    assert.equal(st.tables.companies.find((c) => c.slug === 'shared-co' && c.owner === A).next_probe_at, undefined);
    assert.ok(!r.asked.some((u) => u.includes('initechcanarycorp')));
  } finally {
    await stub.close();
  }
}, { timeout: 60000 });

test('in Actions the probe prints no company, token, domain or owner label', async () => {
  const st = world();
  const stub = await startStub(st);
  try {
    const r = await runWorker(BOARDS, [], { url: stub.url, fixtures, env: { GITHUB_ACTIONS: 'true' } });
    assert.equal(r.code, 0, r.out);
    for (const canary of ['canarycorp', 'initech', 'widgets', 'flaky', 'staffing', 'canarylabel', 'ashbyhq', 'greenhouse.io', 'example.invalid']) {
      assert.ok(!r.out.toLowerCase().includes(canary), `output contains ${canary}:\n${r.out}`);
    }
    assert.match(r.out, /probed \d+, confirmed \d+/);
    assert.ok(st.tables.companies.find((c) => c.slug === 'initech-canarycorp' && c.owner === A).board_kind, 'the run did work');
  } finally {
    await stub.close();
  }
}, { timeout: 90000 });
