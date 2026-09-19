import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEligible, slugify, transform } from './import.mjs';

test('slugify normalises company names', () => {
  assert.equal(slugify('ClickHouse'), 'clickhouse');
  assert.equal(slugify('Domino Data Lab'), 'domino-data-lab');
  assert.equal(slugify('Salmon Group Ltd.'), 'salmon-group-ltd');
  assert.equal(slugify(''), '');
});

test('eligibility keeps Germany and EU remote, rejects elsewhere', () => {
  // Her rule: Germany remote, or EU/EMEA-wide remote. Nothing else counts.
  assert.equal(isEligible({ location: 'Germany', remote: true }), true);
  assert.equal(isEligible({ location: 'European Union', remote: true }), true);
  assert.equal(isEligible({ location: 'EMEA', remote: true }), true);
  assert.equal(isEligible({ location: 'Berlin, Germany', workplaceType: 'Remote', remote: true }), true);
  assert.equal(isEligible({ location: 'United States', remote: true }), false);
  assert.equal(isEligible({ location: 'Remote - India', remote: true }), false);
  assert.equal(isEligible({ location: 'Poland', remote: true }), false, 'a single non-German EU country is not EU-wide remote');
});

test('a posting that requires German is flagged, never eligible', () => {
  assert.equal(isEligible({ location: 'Germany', remote: true, germanRequired: true }), false);
});

test('on-site is not eligible however good the location', () => {
  assert.equal(isEligible({ location: 'Germany', remote: false }), false);
});

test('transform maps statuses and never invents one', () => {
  const out = transform({
    jobnet: {
      jobs: [{ id: 'j1', company: 'Acme', companyNorm: 'acme', title: 'TSE', status: 'weird', location: 'Germany', remote: true }],
      people: [],
      connections: [],
      companies: {},
    },
    queue: { items: [{ id: 'q_1', personName: 'A', channel: 'nonsense', status: 'bogus' }] },
    posts: { items: [{ id: 'p_1', format: 'odd', status: 'invented' }] },
    questions: { items: [] },
  });
  assert.equal(out.jobs[0].status, 'found', 'unknown job status falls back to found');
  assert.equal(out.outreach[0].status, 'draft', 'unknown outreach status falls back to draft');
  assert.equal(out.outreach[0].channel, 'message');
  assert.equal(out.posts[0].status, 'draft');
  assert.equal(out.posts[0].format, 'text');
});

test('description is clipped so full job text never reaches the database', () => {
  const long = 'x'.repeat(5000);
  const out = transform({
    jobnet: { jobs: [{ id: 'j1', company: 'Acme', title: 'T', description: long }], people: [], connections: [], companies: {} },
    queue: null,
    posts: null,
    questions: null,
  });
  assert.equal(out.jobs[0].excerpt.length, 400);
});

test('an upstream PR contribution takes its company from the repo owner', () => {
  const out = transform({
    jobnet: { jobs: [], people: [], connections: [], companies: {} },
    queue: null,
    posts: null,
    questions: {
      items: [
        {
          id: 'manual:supabase/supabase#50594',
          source: 'manual',
          title: 'docs PR',
          url: 'https://example.com',
          status: 'answered',
          answerUrl: 'https://github.com/supabase/supabase/pull/50594',
          answeredAt: '2026-09-18T00:00:00Z',
        },
      ],
    },
  });
  assert.equal(out.contributions.length, 1);
  assert.equal(out.contributions[0].kind, 'pr');
  assert.equal(out.contributions[0].company, 'supabase');
  assert.equal(out.contributions[0].company_slug, 'supabase');
});

test('a published post becomes a contribution, a draft does not', () => {
  const out = transform({
    jobnet: { jobs: [], people: [], connections: [], companies: {} },
    queue: null,
    questions: null,
    posts: {
      items: [
        { id: 'p_1', status: 'published', title: 'Live', publishedUrl: 'https://linkedin.com/x', publishedAt: '2026-09-15T00:00:00Z' },
        { id: 'p_2', status: 'draft', title: 'Not yet' },
      ],
    },
  });
  assert.equal(out.contributions.length, 1);
  assert.equal(out.contributions[0].title, 'Live');
});
