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
console.log('rank.test: ok');
