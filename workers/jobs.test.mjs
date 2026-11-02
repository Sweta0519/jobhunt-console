// Guards the title filter in jobs.mjs.
//
// These import the real RELEVANT and CLEARLY_NOT rather than restating them,
// because a test with its own copy once reported green while the worker was
// quietly dropping a role she wanted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANT, CLEARLY_NOT, titleFilters, withDefaults, scoreFor, eligibleFor, storeDescriptions } from './jobs.mjs';

const keeps = (title) => RELEVANT.test(title) && !CLEARLY_NOT.test(title);

test('keeps the support-family titles she is actually looking for', () => {
  for (const title of [
    'Senior Customer Support Engineer',
    'Technical Support Engineer',
    'Technical Customer Engineer (EMEA)',
    'Customer Success Engineer',
    'Technical Account Manager',
    'Forward Deployed Engineer',
    'Solutions Engineer',
    'Solutions Architect',
    'Solutions Consultant',
    'Implementation Specialist',
    'Onboarding Manager',
    'Service Desk Analyst',
    'Escalation Engineer',
  ]) {
    assert.equal(keeps(title), true, `should keep: ${title}`);
  }
});

test('"Solutions" as a product line is not a role family', () => {
  // Both are live on careers.reap.global and both used to register as relevant,
  // because RELEVANT matched a bare "solutions?". They survived only because
  // the location gate dropped them afterwards.
  assert.equal(RELEVANT.test('Senior Software Engineer, Card Solutions'), false);
  assert.equal(RELEVANT.test('Engineering Manager, Card Solutions (Global Expansion)'), false);
});

test('drops the obvious non-matches', () => {
  for (const title of [
    'Account Executive',
    'Sales Development Representative',
    'Product Designer',
    'Working Student, Marketing',
    'Backend Engineer',
    'Tech Lead, Security and Identity Platform',
    'Senior Site Reliability Engineer (APAC)',
    'Lead, Transaction Monitoring - Financial Crime Operations',
  ]) {
    assert.equal(keeps(title), false, `should drop: ${title}`);
  }
});

test('a profile without titles keeps her filters', () => {
  const f = titleFilters({});
  assert.equal(f.relevant, RELEVANT);
  assert.equal(f.exclude, CLEARLY_NOT);
});

test("another field's titles replace hers, both ways", () => {
  // Her CLEARLY_NOT drops "software engineer", exactly what a developer wants.
  const f = titleFilters({ titles: { relevant: 'software engineer|developer', exclude: 'intern|sales' } });
  assert.equal(f.relevant.test('Senior Software Engineer'), true);
  assert.equal(f.exclude.test('Senior Software Engineer'), false);
  assert.equal(f.relevant.test('Technical Support Engineer'), false);
});

test('remote-or-home drops an office job in another German city', () => {
  const p = withDefaults({ roles: [], skills: {}, eligibility: 'remote-or-home', locations: { hybridOkCities: ['hamburg'] } });
  assert.equal(eligibleFor('Berlin, Germany', false, false, p), false);
  assert.equal(eligibleFor('Germany (Remote)', true, false, p), true);
  assert.equal(eligibleFor('Hamburg, Germany', false, false, p), true);
  assert.equal(eligibleFor('Remote: EMEA', true, true, p), false); // German required
  // Without the switch, her rule is unchanged: any German city passes.
  assert.equal(eligibleFor('Berlin, Germany', false, false, withDefaults({})), true);
});

test('an engineer is not docked for a posting that wants production code', () => {
  const job = {
    title: 'Senior Software Engineer',
    company: 'Acme',
    location: 'Remote, Germany',
    description: 'You will contribute production-quality code to our product. Java, Kafka, AWS.',
  };
  const base = withDefaults({ roles: ['senior software engineer'], skills: { core: ['java', 'kafka', 'aws'] } });
  const docked = scoreFor(job, base);
  const engineer = scoreFor(job, { ...base, codePenalty: false });
  assert.equal(docked.breakdown.code, -10);
  assert.equal(engineer.breakdown.code, 0);
  assert.equal(engineer.total, Math.min(100, docked.total + 10));
});

test("a stored profile does not inherit her support skills", () => {
  const p = withDefaults({ roles: ['data analyst'], skills: { core: ['sql', 'tableau'] } });
  assert.deepEqual(Object.keys(p.skills), ['core']);
  assert.deepEqual(p.roles, ['data analyst']);
  // Unset sections still come from the defaults, so scoring never meets undefined.
  assert.ok(Array.isArray(p.rolePenalties));
  assert.ok(p.locations.remoteRegions.length > 0);
});

// Full posting text for the resume drafts. All data is invented.
function fakeDb(existing = []) {
  const written = [];
  return {
    written,
    select: async () => existing,
    upsert: async (table, rows) => { written.push(...rows.map((r) => ({ table, ...r }))); return rows.length; },
  };
}

test('storeDescriptions keeps board text, resolves aggregator rows, and caps lookups', async () => {
  const rows = [
    { id: 'greenhouse:acme:1', url: 'https://example.invalid/1' },
    { id: 'rr:2', url: 'https://boards.greenhouse.io/acme/jobs/2' },
    { id: 'rr:3', url: 'https://example.invalid/3' },
    { id: 'rr:4', url: 'https://example.invalid/4' },
  ];
  const full = new Map([
    ['greenhouse:acme:1', { text: 'Board text.' }],
    ['rr:2', { text: null, summary: 'Short summary 2.' }],
    ['rr:3', { text: null, summary: 'Short summary 3.' }],
    ['rr:4', { text: null, summary: 'Short summary 4.' }],
  ]);
  const db = fakeDb();
  const asked = [];
  const out = await storeDescriptions(db, rows, full, {
    maxResolve: 2,
    wait: async () => {},
    resolve: async (url) => { asked.push(url); return url.includes('greenhouse') ? 'Resolved full text.' : null; },
  });
  assert.deepEqual(out, { stored: 4, resolved: 1, summary: 2 });
  assert.equal(asked.length, 2, 'at most maxResolve lookups');
  const by = Object.fromEntries(db.written.map((w) => [w.job_id, w]));
  assert.equal(by['greenhouse:acme:1'].kind, 'board');
  assert.equal(by['rr:2'].kind, 'resolved');
  assert.equal(by['rr:2'].description, 'Resolved full text.');
  assert.equal(by['rr:3'].kind, 'summary');
  assert.equal(by['rr:4'].kind, 'summary');
  assert.ok(db.written.every((w) => w.table === 'job_descriptions' && /^[0-9a-f]{64}$/.test(w.sha)));
});

test('storeDescriptions skips unchanged text and already-resolved rows', async () => {
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update('Same text.').digest('hex');
  const db = fakeDb([
    { job_id: 'greenhouse:acme:1', sha, kind: 'board' },
    { job_id: 'rr:2', sha: 'old', kind: 'resolved' },
  ]);
  const full = new Map([
    ['greenhouse:acme:1', { text: 'Same text.' }],
    ['rr:2', { text: null, summary: 'Summary.' }],
  ]);
  let asked = 0;
  const out = await storeDescriptions(db, [{ id: 'greenhouse:acme:1' }, { id: 'rr:2', url: 'x' }], full, {
    wait: async () => {}, resolve: async () => { asked++; return null; },
  });
  assert.deepEqual(out, { stored: 0, resolved: 0, summary: 0 });
  assert.equal(asked, 0);
  assert.equal(db.written.length, 0);
});

test('storeDescriptions caps stored text at 60000 characters', async () => {
  const db = fakeDb();
  await storeDescriptions(db, [{ id: 'ashby:acme:1' }], new Map([['ashby:acme:1', { text: 'x'.repeat(70000) }]]), { wait: async () => {} });
  assert.equal(db.written[0].description.length, 60000);
});
