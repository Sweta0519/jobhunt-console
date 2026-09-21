import assert from 'node:assert/strict';
import { rankItem } from './rank.mjs';
import { COMPANY_WEIGHT } from './sources.mjs';

// The ranker only reads company weights from the config.
const cfg = { companies: Object.fromEntries(Object.entries(COMPANY_WEIGHT).map(([k, v]) => [k, { weight: v }])) };

const now = Date.parse('2026-09-18T12:00:00Z');
const fresh = { source: 'gh-discussion', company: 'supabase', title: 'Auth runtime settings out of sync, Google OAuth disabled and custom SMTP ignored', excerpt: 'x'.repeat(200), createdAt: '2026-09-18T06:00:00Z', comments: 0, hasAnswer: false, score: 1 };
const r1 = rankItem(fresh, cfg, now);
assert.ok(r1.rank >= 70, `fresh supabase auth question should rank >= 70, got ${r1.rank} (${r1.why})`);

const hiring = { source: 'discourse', company: 'docker', title: 'Hiring: freelance Docker developer needed', excerpt: '', createdAt: '2026-09-18T10:00:00Z', comments: 0, hasAnswer: false, score: 0 };
assert.ok(rankItem(hiring, cfg, now).rank < 60, 'hiring topic must be penalised');

const billing = { source: 'discourse', company: 'docker', title: 'Card declined on billing page, need refund', excerpt: '', createdAt: '2026-09-18T10:00:00Z', comments: 0, hasAnswer: false, score: 0 };
assert.ok(rankItem(billing, cfg, now).rank < 60, 'billing topic must be penalised');

const old = { ...fresh, createdAt: '2026-09-12T06:00:00Z', comments: 4, hasAnswer: true };
assert.ok(rankItem(old, cfg, now).rank < rankItem(fresh, cfg, now).rank - 30, 'old answered item ranks far lower');

const soDocker = { source: 'stackoverflow', company: 'docker', requireKeyword: true, title: 'Best practice question about dockerfile layers', excerpt: '', createdAt: '2026-09-18T10:00:00Z', comments: 0, hasAnswer: false, score: 0 };
assert.ok(rankItem(soDocker, cfg, now).why.includes('penalty'), 'keyword-less docker SO question gets a penalty');

// A maintainer asking for outside analysis is the opposite of noise, so the
// bug-tracker penalty must not bury it. This is the shape of supabase#34526,
// which sat eighteen months labelled needs-analysis.
const tracker = { source: 'gh-issue', company: 'supabase', bugTracker: true, title: 'Edge functions: invoking an invalid `x-region` re-routes to an available region', excerpt: 'y'.repeat(200), createdAt: '2026-09-17T12:00:00Z', comments: 0, hasAnswer: false, score: 0, tags: ['bug', 'edge functions', 'external-issue'] };
const invited = { ...tracker, tags: [...tracker.tags, 'needs-analysis'] };
const plain = rankItem(tracker, cfg, now);
const asked = rankItem(invited, cfg, now);
assert.ok(plain.why.includes('bug tracker'), `an uninvited tracker issue keeps its penalty (${plain.why})`);
assert.ok(!asked.why.includes('bug tracker'), `needs-analysis waives the bug-tracker penalty (${asked.why})`);
assert.ok(asked.why.includes('invited: needs-analysis'), `the reason names the invitation (${asked.why})`);
assert.ok(asked.rank > plain.rank + 20, `invited issue outranks the same issue unlabelled: ${asked.rank} vs ${plain.rank}`);

// `external-issue` sits on 270 of 297 open Supabase issues, so it must not count.
const notInvited = { ...tracker, tags: ['bug', 'external-issue'] };
assert.ok(!rankItem(notInvited, cfg, now).why.includes('invited'), 'external-issue is not an invitation');
console.log('rank.test: ok');
