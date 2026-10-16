// Guards the title filter in jobs.mjs.
//
// These import the real RELEVANT and CLEARLY_NOT rather than restating them,
// because a test with its own copy once reported green while the worker was
// quietly dropping a role she wanted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANT, CLEARLY_NOT } from './jobs.mjs';

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
