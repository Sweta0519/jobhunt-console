// Every company, board and link below is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, core, tokensFor, linkedRoots } from './classify.mjs';
import { validToken } from './hosts.mjs';

const long = (extra) => `<p>${'We help teams run reliable software and we are hiring. '.repeat(8)}${extra}</p>`;
const posts = (extra, n = 3) => Array.from({ length: n }, (_, i) => ({ title: `Support Engineer ${i}`, html: long(extra) }));

test('exact name plus a link to its own domain is confirmed', () => {
  const r = classify({ name: 'Initech Widgets GmbH', domain: null }, { name: 'Initech Widgets', posts: posts('See https://www.initechwidgets.com/about') });
  assert.equal(r.verdict, 'confirmed');
});

test('no board name (Ashby shape): mentions and a domain whose label equals the name confirm', () => {
  const r = classify({ name: 'Globex', domain: null }, { name: null, posts: posts('About Globex. Visit https://globex.com today') });
  assert.equal(r.verdict, 'confirmed');
  const r2 = classify({ name: 'Globex', domain: null }, { name: null, posts: posts('About Globex. Visit https://globexcorp.com today') });
  assert.equal(r2.verdict, 'review', 'mention only: the label is not exactly the name');
});

test('a look-alike domain does not count: substring is never a match', () => {
  const r = classify({ name: 'Hooli', domain: null }, { name: 'Hooli', posts: posts('Visit https://hoolicomms.com') });
  assert.equal(r.verdict, 'review');
});

test('a board with no postings is empty, whatever its name', () => {
  assert.equal(classify({ name: 'Hooli', domain: null }, { name: 'Hooli', posts: [] }).verdict, 'empty');
});

test('a different name with no mention is rejected; a rebrand that is mentioned goes to review', () => {
  assert.equal(classify({ name: 'Hooli', domain: null }, { name: 'Umbrella', posts: posts('Nothing relevant') }).verdict, 'rejected');
  assert.equal(classify({ name: 'Hooli', domain: null }, { name: 'Umbrella', posts: posts('Formerly Hooli, now Umbrella') }).verdict, 'review');
});

test('a known domain that no posting links to leaves an exact name in review', () => {
  const r = classify({ name: 'Hooli', domain: 'hooli.com' }, { name: 'Hooli', posts: posts('No links here') });
  assert.equal(r.verdict, 'review');
});

test('a job URL that proves the link confirms a near name; nothing matching stays in review', () => {
  assert.equal(classify({ name: 'Initech', domain: null }, { name: 'Initech Software Labs', posts: posts('x') }, { viaUrl: true }).verdict, 'confirmed');
  assert.equal(classify({ name: 'Hooli', domain: null }, { name: 'Umbrella', posts: posts('x') }, { viaUrl: true }).verdict, 'rejected');
});

test('core drops legal and generic words; tokensFor gives at most 3 valid tokens', () => {
  assert.equal(core('Acme Technologies GmbH'), 'acme');
  const t = tokensFor('The Big Acme Group Inc.');
  assert.ok(t.length <= 3 && t.length > 0);
  for (const x of t) assert.ok(validToken('greenhouse', x), x);
  assert.deepEqual(tokensFor('!!'), []);
});

test('linkedRoots ignores social and job-board hosts', () => {
  const r = linkedRoots([{ html: 'https://linkedin.com/x https://jobs.lever.co/a https://www.acme-corp.co.uk/careers' }]);
  assert.deepEqual(r, ['acme-corp.co.uk']);
});
