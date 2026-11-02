import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAtsUrl, resolveFull } from './resolve.mjs';

const UUID = '0a1b2c3d-1111-4222-8333-444455556666';

test('both ATS url shapes parse', () => {
  assert.deepEqual(parseAtsUrl('https://boards.greenhouse.io/acme/jobs/12345'), { kind: 'greenhouse', token: 'acme', id: '12345' });
  assert.deepEqual(parseAtsUrl('https://job-boards.greenhouse.io/acme/jobs/12345?gh_src=x'), { kind: 'greenhouse', token: 'acme', id: '12345' });
  assert.deepEqual(parseAtsUrl(`https://jobs.ashbyhq.com/acme/${UUID}`), { kind: 'ashby', token: 'acme', id: UUID });
});

test('look-alike, plain http, userinfo and traversal urls return null', () => {
  for (const u of [
    'https://evil.com/boards.greenhouse.io/x/jobs/1',
    'http://boards.greenhouse.io/acme/jobs/1',
    'https://boards.greenhouse.io@evil.com/acme/jobs/1',
    'https://boards.greenhouse.io.evil.com/acme/jobs/1',
    'https://boards.greenhouse.io/../acme/jobs/1',
    'https://boards.greenhouse.io/acme/jobs/1/../../x',
    `https://jobs.ashbyhq.com/../${UUID}`,
    `https://jobs.ashbyhq.com.evil.com/acme/${UUID}`,
    '',
    null,
  ]) {
    assert.equal(parseAtsUrl(u), null, String(u));
  }
});

test('resolveFull only ever calls the two fixed API hosts', async () => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('greenhouse')) return new Response(JSON.stringify({ content: '&lt;p&gt;Hello&lt;/p&gt;' }));
    return new Response(JSON.stringify({ jobs: [{ id: UUID, descriptionHtml: '<p>Ashby text</p>' }] }));
  };
  try {
    assert.equal(await resolveFull('https://boards.greenhouse.io/acme/jobs/12345'), 'Hello');
    assert.equal(await resolveFull(`https://jobs.ashbyhq.com/acme/${UUID}`), 'Ashby text');
    assert.equal(await resolveFull('https://evil.com/x'), null);
    assert.equal(calls.length, 2);
    for (const c of calls) assert.match(c, /^https:\/\/(boards-api\.greenhouse\.io|api\.ashbyhq\.com)\//);
  } finally {
    globalThis.fetch = real;
  }
});

test('a failing fetch returns null instead of throwing', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network'); };
  try {
    assert.equal(await resolveFull('https://boards.greenhouse.io/acme/jobs/12345'), null);
  } finally {
    globalThis.fetch = real;
  }
});
