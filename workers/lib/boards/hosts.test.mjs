import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validToken, parseBoardUrl, hostKey, gapMs } from './hosts.mjs';
import { isStaffing } from './noise.mjs';
import { isRecent, otherRegionTitle, normTitle, BACKLOG_DAYS } from './policy.mjs';

test('tokens that build a hostname are strict', () => {
  assert.equal(validToken('recruitee', 'a.evil.com'), false);
  assert.equal(validToken('recruitee', 'acme-hr'), true);
  assert.equal(validToken('teamtailor', '127.0.0.1'), false);
  assert.equal(validToken('teamtailor', 'host:8080'), false);
  assert.equal(validToken('teamtailor', 'careers.acme.com'), true);
  assert.equal(validToken('personio', '../x'), false);
  assert.equal(validToken('greenhouse', '..'), false);
  assert.equal(validToken('greenhouse', 'acme_inc'), true);
});

test('parseBoardUrl reads one URL per kind and refuses tricks', () => {
  assert.deepEqual(parseBoardUrl('https://boards.greenhouse.io/acme/jobs/1'), { kind: 'greenhouse', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://jobs.ashbyhq.com/acme/0b1f6a2e-0000-4000-8000-000000000000'), { kind: 'ashby', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://jobs.lever.co/acme/abc'), { kind: 'lever', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://apply.workable.com/acme/j/ABC/'), { kind: 'workable', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://acme.recruitee.com/o/support'), { kind: 'recruitee', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://acme.jobs.personio.de/job/1'), { kind: 'personio', token: 'acme' });
  assert.deepEqual(parseBoardUrl('https://acme.teamtailor.com/jobs/1-x'), { kind: 'teamtailor', token: 'acme.teamtailor.com' });
  assert.equal(parseBoardUrl('https://jobs.smartrecruiters.com/Acme/1')?.unsupported, true);
  assert.equal(parseBoardUrl('https://acme.wd5.myworkdayjobs.com/en/x')?.unsupported, true);
  assert.equal(parseBoardUrl('https://boards.greenhouse.io/acme%2f..%2fx/jobs/1'), null);
  assert.equal(parseBoardUrl('https://boards.greenhouse.io/../x/jobs/1'), null);
  assert.equal(parseBoardUrl('https://greenhouse.io.evil.com/acme/jobs/1'), null);
  assert.equal(parseBoardUrl('http://boards.greenhouse.io/acme/jobs/1'), null);
  assert.equal(parseBoardUrl('https://boards.greenhouse.io:8443/acme/jobs/1'), null);
});

test('host keys and gaps', () => {
  assert.equal(hostKey('greenhouse', 'a'), 'greenhouse');
  assert.equal(hostKey('teamtailor', 'careers.acme.com'), 'careers.acme.com');
  assert.equal(gapMs('lever'), 1100);
  assert.equal(gapMs('ashby'), 300);
});

test('isStaffing flags agencies and not Recruitee', () => {
  for (const n of ['Acme Recruitment GmbH', 'Globex Staffing', 'Randstad', 'Michael Page', 'Initech Talent Acquisition', 'Personaldienstleistungen Nord']) {
    assert.equal(isStaffing(n), true, n);
  }
  for (const n of ['Recruitee', 'Initech Widgets', 'Globex']) assert.equal(isStaffing(n), false, n);
});

test('isRecent: 13 days yes, 15 no, no date no', () => {
  const now = Date.parse('2026-11-03T00:00:00Z');
  assert.equal(BACKLOG_DAYS, 14);
  assert.equal(isRecent('2026-10-21T00:00:00Z', now), true);
  assert.equal(isRecent('2026-10-19T00:00:00Z', now), false);
  assert.equal(isRecent(null, now), false);
  assert.equal(isRecent('garbage', now), false);
});

test('otherRegionTitle', () => {
  assert.equal(otherRegionTitle('Support Engineer - Americas'), true);
  assert.equal(otherRegionTitle('Technical Customer Engineer (EMEA)'), false);
  assert.equal(otherRegionTitle('Support Engineer, Costa Rica'), true);
  assert.equal(otherRegionTitle('Support Engineer'), false);
  assert.equal(otherRegionTitle('Support Engineer - Americas and Europe'), false);
});

test('normTitle drops markers and punctuation', () => {
  assert.equal(normTitle('Support Engineer (m/w/d)'), normTitle('support-engineer'));
});
