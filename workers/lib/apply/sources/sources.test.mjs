import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSource, readSource, denied } from './index.mjs';
import { getLimited, SourceError, MAX_BODY } from './http.mjs';
import { parseLeverApply } from './lever.mjs';
import { mapAshby, QUERY } from './ashby.mjs';

const fx = (n) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');
const GH = JSON.parse(fx('greenhouse.json'));
const ASHBY = JSON.parse(fx('ashby.json'));
const LEVER = fx('lever.html');

/** A fake fetch that answers from a map of url to { status, json | text } and records calls. */
function fakeFetch(map) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const hit = typeof map === 'function' ? map(url, init) : map[url];
    if (!hit) return new Response('nope', { status: 404 });
    const body = hit.json !== undefined ? JSON.stringify(hit.json) : String(hit.text ?? '');
    return new Response(body, { status: hit.status ?? 200 });
  };
  impl.calls = calls;
  return impl;
}

// --- resolver ------------------------------------------------------------------
test('resolver: id prefix with valid parts wins', () => {
  assert.deepEqual(resolveSource({ id: 'greenhouse:exampleco:1001' }), { kind: 'greenhouse', token: 'exampleco', id: '1001' });
  assert.deepEqual(resolveSource({ id: 'ashby:exampleco:00000000-0000-4000-8000-000000000a01' }), { kind: 'ashby', token: 'exampleco', id: '00000000-0000-4000-8000-000000000a01' });
  assert.deepEqual(resolveSource({ id: 'lever:exampleco:00000000-0000-4000-8000-000000000b01' }).kind, 'lever');
});

test('resolver: a bad token or id does not reach a URL', () => {
  for (const id of ['greenhouse:../etc:1', 'greenhouse:a b:1', 'ashby:ok:../x', 'greenhouse:..:1']) {
    const r = resolveSource({ id, url: null });
    assert.equal(r.needs_paste, true, id);
  }
});

test('resolver: a feed row whose URL is a board posting reads that board', () => {
  const g = resolveSource({ id: 'rr:abc', url: 'https://boards.greenhouse.io/exampleco/jobs/1001?gh_src=x' });
  assert.deepEqual(g, { kind: 'greenhouse', token: 'exampleco', id: '1001' });
  const a = resolveSource({ id: 'him:abc', url: 'https://jobs.ashbyhq.com/exampleco/00000000-0000-4000-8000-000000000A01' });
  assert.equal(a.kind, 'ashby');
  assert.equal(a.id, '00000000-0000-4000-8000-000000000a01');
  const l = resolveSource({ id: 'jobicy:abc', url: 'https://jobs.lever.co/exampleco/00000000-0000-4000-8000-000000000b01' });
  assert.equal(l.kind, 'lever');
  assert.equal(resolveSource({ id: 'rr:abc', url: 'https://jobs.lever.co/exampleco/../00000000-0000-4000-8000-000000000b01' }).needs_paste, true);
});

test('resolver: excluded hosts, feed rows and unknown boards go to paste with a reason', () => {
  const r = (id, url) => resolveSource({ id, url });
  assert.equal(r('teamtailor:x:1', 'https://acme.wd3.myworkdayjobs.com/en/job/1').reason, 'excluded');
  assert.equal(r('x:1', 'https://jobs.smartrecruiters.com/Acme/123-job').reason, 'excluded');
  assert.equal(r('x:1', 'https://www.linkedin.com/jobs/view/1').reason, 'excluded');
  assert.equal(r('x:1', 'https://de.indeed.com/viewjob?jk=1').reason, 'excluded');
  assert.equal(r('rr:1', 'https://remoterocketship.com/company/x/jobs/y').reason, 'excluded');
  assert.equal(r('rr:1', 'https://example.invalid/jobs/1').reason, 'feed_listing');
  assert.equal(r('teamtailor:acme.teamtailor.com:5', 'https://acme.teamtailor.com/jobs/5').reason, 'no_reader');
  assert.equal(r('workable:acme:5', null).reason, 'no_reader');
});

test('resolver: a source switched off goes to paste, never to the network', () => {
  const r = resolveSource({ id: 'ashby:exampleco:00000000-0000-4000-8000-000000000a01' }, { sources: { ashby: false } });
  assert.deepEqual(r, { needs_paste: true, reason: 'source_off' });
  assert.equal(resolveSource({ id: 'lever:exampleco:00000000-0000-4000-8000-000000000b01' }, { sources: { lever: false } }).reason, 'source_off');
});

test('denied(): suffix match on a dot boundary', () => {
  assert.equal(denied('https://notlinkedin.com/x'), false);
  assert.equal(denied('https://www.linkedin.com/x'), true);
  assert.equal(denied('https://uk.stepstone.de/x'), true);
});

// --- http ----------------------------------------------------------------------
test('getLimited: fixed host, https only, no redirect, body cap', async () => {
  const f = fakeFetch(() => ({ text: 'ok' }));
  await assert.rejects(getLimited('http://boards-api.greenhouse.io/x', { host: 'boards-api.greenhouse.io', fetchImpl: f }), { code: 'bad_url' });
  await assert.rejects(getLimited('https://evil.example/x', { host: 'boards-api.greenhouse.io', fetchImpl: f }), { code: 'bad_url' });
  await assert.rejects(getLimited('https://boards-api.greenhouse.io:8443/x', { host: 'boards-api.greenhouse.io', fetchImpl: f }), { code: 'bad_url' });
  await assert.rejects(getLimited('https://u:p@boards-api.greenhouse.io/x', { host: 'boards-api.greenhouse.io', fetchImpl: f }), { code: 'bad_url' });
  assert.equal(f.calls.length, 0);
  const r = await getLimited('https://boards-api.greenhouse.io/x', { host: 'boards-api.greenhouse.io', fetchImpl: f });
  assert.equal(r.text, 'ok');
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.ok(f.calls[0].init.signal);
  const big = fakeFetch(() => ({ text: 'x'.repeat(MAX_BODY + 10) }));
  await assert.rejects(getLimited('https://boards-api.greenhouse.io/x', { host: 'boards-api.greenhouse.io', fetchImpl: big }), { code: 'too_big' });
});

test('getLimited: a redirect (fetch throws with redirect:error) is unreachable', async () => {
  const f = async () => { throw new TypeError('redirect'); };
  await assert.rejects(getLimited('https://boards-api.greenhouse.io/x', { host: 'boards-api.greenhouse.io', fetchImpl: f }), { code: 'unreachable' });
});

// --- greenhouse ----------------------------------------------------------------
test('greenhouse: maps questions, files, selects, location, compliance and demographic', async () => {
  const f = fakeFetch({ 'https://boards-api.greenhouse.io/v1/boards/exampleco/jobs/1001?questions=true': { json: GH } });
  const r = await readSource({ kind: 'greenhouse', token: 'exampleco', id: '1001' }, { fetchImpl: f });
  assert.ok(r.ok);
  assert.equal(r.applyUrl, 'https://boards.greenhouse.io/exampleco/jobs/1001');
  const by = Object.fromEntries(r.form.questions.map((q) => [q.label, q]));
  assert.equal(r.form.completeness, 'complete');
  assert.equal(by['Email'].kind, 'email');
  assert.deepEqual([by['Resume/CV'].kind, by['Resume/CV'].role], ['file', 'resume_file']);
  assert.deepEqual([by['Cover Letter'].kind, by['Cover Letter'].role], ['file', 'cover_letter']);
  assert.equal(by['Why do you want to work at Exampleco?'].kind, 'long_text');
  assert.equal(by['Why do you want to work at Exampleco?'].help, 'A few sentences are fine.');
  assert.deepEqual(by['Are you comfortable with on-call shifts?'].options.map((o) => o.label), ['Yes', 'No']);
  assert.equal(by['Which tools have you used?'].kind, 'multi_select');
  assert.equal(by['Location (City)'].group, 'location');
  assert.equal(by['Gender'].group, 'compliance');
  assert.equal(by['Which describes you?'].group, 'demographic');
  assert.ok(!by['Hidden tracking'], 'hidden inputs are dropped');
});

test('greenhouse: 404, a non-200, bad JSON and a wrong shape all degrade to a reason', async () => {
  const src = { kind: 'greenhouse', token: 'exampleco', id: '1001' };
  const url = 'https://boards-api.greenhouse.io/v1/boards/exampleco/jobs/1001?questions=true';
  assert.deepEqual(await readSource(src, { fetchImpl: fakeFetch({}) }), { ok: false, reason: 'not_found' });
  assert.equal((await readSource(src, { fetchImpl: fakeFetch({ [url]: { status: 500, text: 'x' } }) })).reason, 'http_error');
  assert.equal((await readSource(src, { fetchImpl: fakeFetch({ [url]: { text: 'not json' } }) })).reason, 'shape_changed');
  assert.equal((await readSource(src, { fetchImpl: fakeFetch({ [url]: { json: { questions: 'x' } } }) })).reason, 'shape_changed');
  assert.equal((await readSource(src, { fetchImpl: fakeFetch({ [url]: { json: { questions: [] } } }) })).reason, 'shape_changed');
});

test('greenhouse: an unfamiliar absolute_url falls back to the board URL', async () => {
  const url = 'https://boards-api.greenhouse.io/v1/boards/exampleco/jobs/1001?questions=true';
  const bad = { ...GH, absolute_url: 'http://example.invalid:8080/x' };
  const r = await readSource({ kind: 'greenhouse', token: 'exampleco', id: '1001' }, { fetchImpl: fakeFetch({ [url]: { json: bad } }) });
  assert.equal(r.applyUrl, 'https://boards.greenhouse.io/exampleco/jobs/1001');
  const own = await readSource({ kind: 'greenhouse', token: 'exampleco', id: '1001' }, { fetchImpl: fakeFetch({ [url]: { json: { ...GH, absolute_url: 'https://careers.example.invalid/job/1001' } } }) });
  assert.equal(own.applyUrl, 'https://careers.example.invalid/job/1001');
});

// --- ashby ---------------------------------------------------------------------
const ASHBY_SRC = { kind: 'ashby', token: 'exampleco', id: '00000000-0000-4000-8000-000000000a01' };
const ASHBY_URL = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting';

test('ashby: a POST with variables only maps fields by type', async () => {
  const f = fakeFetch({ [ASHBY_URL]: { json: ASHBY } });
  const r = await readSource(ASHBY_SRC, { fetchImpl: f });
  assert.ok(r.ok);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(sent.variables, { organizationHostedJobsPageName: 'exampleco', jobPostingId: ASHBY_SRC.id });
  assert.equal(sent.query, QUERY);
  assert.ok(!sent.query.includes('exampleco') && !sent.query.includes(ASHBY_SRC.id), 'no token or id inside the query text');
  assert.ok(!/mutation/i.test(sent.query));
  const by = Object.fromEntries(r.form.questions.map((q) => [q.label, q]));
  assert.equal(by['Email'].kind, 'email');
  assert.deepEqual([by['Resume'].kind, by['Resume'].role], ['file', 'resume_file']);
  assert.equal(by['Why this role?'].help, 'Keep it short.');
  assert.deepEqual(by['Preferred team'].options.map((o) => o.label), ['Platform', 'Support']);
  assert.equal(by['Can you work in the office twice a week?'].kind, 'yes_no');
  assert.equal(by['Which describes you?'].group, 'demographic', 'a survey section goes to demographic');
  assert.ok(!by['Leave this empty'], 'hidden entries are dropped');
  assert.equal(r.form.completeness, 'complete');
  assert.equal(r.applyUrl, `https://jobs.ashbyhq.com/exampleco/${ASHBY_SRC.id}/application`);
});

test('ashby: non-200, an errors array, a missing path, a renamed field and zero entries all say shape_changed', async () => {
  const read = (v) => readSource(ASHBY_SRC, { fetchImpl: fakeFetch({ [ASHBY_URL]: v }) });
  assert.equal((await read({ status: 500, text: 'x' })).reason, 'shape_changed');
  assert.equal((await read({ json: { errors: [{ message: 'x' }], data: null } })).reason, 'shape_changed');
  assert.equal((await read({ json: { data: {} } })).reason, 'shape_changed');
  assert.equal((await read({ json: { data: { jobPosting: { applicationForm: {} } } } })).reason, 'shape_changed');
  const renamed = structuredClone(ASHBY);
  renamed.data.jobPosting.applicationForm.sections[0].fieldEntries[0].field = { type: 'String', path: 'x', label: 'Renamed' };
  assert.equal((await read({ json: renamed })).reason, 'shape_changed');
  assert.equal((await read({ json: { data: { jobPosting: { applicationForm: { sections: [{ title: 'A', fieldEntries: [] }] } } } } })).reason, 'shape_changed');
  assert.equal((await read({ text: '<html>' })).reason, 'shape_changed');
});

test('ashby: a closed posting is not_found; an unknown field type is kept and marks the form may_be_incomplete', async () => {
  const read = (v) => readSource(ASHBY_SRC, { fetchImpl: fakeFetch({ [ASHBY_URL]: v }) });
  assert.equal((await read({ json: { data: { jobPosting: null } } })).reason, 'not_found');
  const odd = structuredClone(ASHBY);
  odd.data.jobPosting.applicationForm.sections[0].fieldEntries.push({ id: 'z', isRequired: true, field: { type: 'Hologram', path: 'q_h', title: 'Odd field' } });
  const r = await read({ json: odd });
  assert.ok(r.ok);
  assert.equal(r.form.questions.find((q) => q.label === 'Odd field').kind, 'unknown');
  assert.equal(r.form.completeness, 'may_be_incomplete');
  assert.ok(r.form.partial_reasons.length > 0);
});

test('ashby: mapAshby is pure and throws SourceError', () => {
  assert.throws(() => mapAshby(null), SourceError);
  assert.ok(mapAshby(ASHBY).questions.length >= 7);
});

// --- lever ---------------------------------------------------------------------
const LEVER_ID = '00000000-0000-4000-8000-000000000b01';
const LEVER_SRC = { kind: 'lever', token: 'exampleco', id: LEVER_ID };
const leverMap = (robots, page = LEVER) => ({
  'https://jobs.lever.co/robots.txt': robots,
  [`https://jobs.lever.co/exampleco/${LEVER_ID}/apply`]: { text: page },
});

test('lever: robots first, a 1100 ms gap, then the apply page is parsed', async () => {
  const waits = [];
  const f = fakeFetch(leverMap({ text: 'User-agent: *\nDisallow: /search\n' }));
  const r = await readSource(LEVER_SRC, { fetchImpl: f, wait: async (ms) => waits.push(ms) });
  assert.ok(r.ok);
  assert.deepEqual(f.calls.map((c) => c.url), ['https://jobs.lever.co/robots.txt', `https://jobs.lever.co/exampleco/${LEVER_ID}/apply`]);
  assert.deepEqual(waits, [1100]);
  assert.equal(r.applyUrl, `https://jobs.lever.co/exampleco/${LEVER_ID}/apply`);
  const by = Object.fromEntries(r.form.questions.map((q) => [q.label, q]));
  assert.deepEqual([by['Resume/CV'].kind, by['Resume/CV'].role, by['Resume/CV'].required], ['file', 'resume_file', true]);
  assert.deepEqual([by['Full name'].kind, by['Full name'].required], ['short_text', true]);
  assert.equal(by['Email'].kind, 'email');
  assert.equal(by['LinkedIn URL'].required, false);
  assert.equal(by['Why are you interested in Exampleco?'].kind, 'long_text');
  assert.deepEqual(by['Are you open to travel?'].options.map((o) => o.label), ['Yes', 'No']);
  assert.deepEqual(by['Preferred start month'].options.map((o) => o.label), ['January', 'February']);
  assert.equal(by['Gender'].group, 'demographic', 'the EEO block is demographic');
  assert.equal(r.form.questions.some((q) => /baseTemplate|honeypot/i.test(q.label + q.id)), false);
  assert.equal(r.form.questions.length, 8, 'the hidden-only item is not a question');
  assert.equal(r.form.completeness, 'complete');
});

test('lever: a robots Disallow, an unreachable robots or a 404 page stop the read', async () => {
  const wait = async () => {};
  const dis = fakeFetch(leverMap({ text: 'User-agent: *\nDisallow: /exampleco/\n' }));
  assert.equal((await readSource(LEVER_SRC, { fetchImpl: dis, wait })).reason, 'robots_disallowed');
  assert.equal(dis.calls.length, 1, 'the page itself is never requested');
  assert.equal((await readSource(LEVER_SRC, { fetchImpl: fakeFetch(leverMap({ status: 403, text: '' })), wait })).reason, 'robots_unreachable');
  assert.equal((await readSource(LEVER_SRC, { fetchImpl: fakeFetch(leverMap({ status: 503, text: '' })), wait })).reason, 'robots_unreachable');
  // robots 404 means no rules; the page then 404s
  const gone = fakeFetch({ 'https://jobs.lever.co/robots.txt': { status: 404, text: '' } });
  assert.equal((await readSource(LEVER_SRC, { fetchImpl: gone, wait })).reason, 'not_found');
});

test('lever: a page with no labels is shape_changed; fewer parsed than markers is may_be_incomplete', () => {
  assert.throws(() => parseLeverApply('<html><body>Maintenance</body></html>'), { code: 'shape_changed' });
  assert.throws(() => parseLeverApply(''), { code: 'shape_changed' });
  const extra = LEVER.replace('<ul class="application-section">', '<div class="application-label">Stray label</div><ul class="application-section">');
  const r = parseLeverApply(extra);
  assert.equal(r.completeness, 'may_be_incomplete');
  assert.deepEqual(r.partial_reasons, ['unlabelled']);
});

test('lever: div questions, hidden JSON and survey sections keep labels, flags and options apart', () => {
  const r = parseLeverApply(fx('lever-sections.html'));
  const by = Object.fromEntries(r.questions.map((q) => [q.label, q]));
  assert.equal(r.completeness, 'complete');
  assert.equal(by['Other website'].required, false, 'hidden JSON saying required does not leak into the previous question');
  assert.equal(by['Other website'].options.length, 0);
  assert.equal(by['Did you work here before?'].required, true);
  assert.deepEqual(by['Did you work here before?'].options, ['No', 'Yes']);
  assert.deepEqual(by['Where do you live?'].options, ['Country A', 'Country B', 'Country C'], 'the div question owns its select');
  assert.equal(by['Where do you live?'].group, 'demographic');
  assert.equal(by['Which gender do you identify with?'].group, 'demographic');
  assert.equal(by['Which gender do you identify with?'].required, false);
  assert.equal(by['Full name'].group, 'main');
});

test('lever: two labels in one question block are not guessed, the form is may_be_incomplete', () => {
  const html = '<ul><li class="application-question"><div class="application-label">One</div><div class="application-label">Two</div><input type="text" name="x"></li><li class="application-question"><div class="application-label">Fine</div><input type="text" name="y"></li></ul>';
  const r = parseLeverApply(html);
  assert.equal(r.completeness, 'may_be_incomplete');
  assert.deepEqual(r.questions.map((q) => q.label), ['Fine']);
});
