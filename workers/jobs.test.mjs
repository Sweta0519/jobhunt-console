// Guards the title filter in jobs.mjs.
//
// These import the real RELEVANT and CLEARLY_NOT rather than restating them,
// because a test with its own copy once reported green while the worker was
// quietly dropping a role she wanted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANT, CLEARLY_NOT, titleFilters, withDefaults, scoreFor, eligibleFor } from './jobs.mjs';

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
