// Row decisions, feeds and board normalisers. All companies, postings and URLs
// are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANT, CLEARLY_NOT, slugifyTitle, careersUrlFor, withDefaults, processBoard, ingestFeed, newState, BOARDS } from './jobs.mjs';
import { urlKeyOf } from './lib/boards/policy.mjs';
import { parsePersonio, clearBoardMemo, fetchBoard } from './lib/boards/fetch.mjs';
import feedHimalayas from './lib/feeds/himalayas.mjs';
import feedJobicy from './lib/feeds/jobicy.mjs';
import remoterocketship from './lib/feeds/remoterocketship.mjs';
import { FEEDS, memoFeed, clearFeedMemo } from './lib/feeds/index.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const DESC =
  'Join our B2B SaaS support team. You will troubleshoot customer issues with the REST API, SQL, logs and webhooks, using Zendesk and Jira, and escalate bugs to engineers. Debugging, root cause analysis, documentation and clear communication with developers matter. Linux, JavaScript, Python, Docker and AWS are useful. We use AI and automation to triage tickets.';
const posting = (o = {}) => ({ nativeId: '1', title: 'Technical Support Engineer', url: 'https://example.invalid/j/1', location: 'Remote Remote', description: DESC, fullText: DESC, postedAt: daysAgo(3), ...o });
const company = { slug: 'initech-widgets', name: 'Initech Widgets', board_kind: 'ashby', board_token: 'initechwidgets', board_baselined_at: null };
const baselined = { ...company, board_baselined_at: daysAgo(1) };
const ctx = (o = {}) => ({ profile: withDefaults({}), relevant: RELEVANT, exclude: CLEARLY_NOT, min: 70, now: NOW, ...o });
const state = (known = [], c = ctx()) => {
  const st = newState(c, known, new Set());
  st.haveSlugs = new Set(['initech-widgets']);
  return st;
};
const stored = (o = {}) => ({ id: 'ashby:initechwidgets:1', url: 'https://example.invalid/j/1', company_slug: 'initech-widgets', company: 'Initech Widgets', title: 'Technical Support Engineer', status: 'found', backlog: false, closed: false, ...o });

test('first poll: a 30-day-old posting is backlog and silent, a 3-day-old one is fresh', () => {
  const st = state();
  processBoard(st, company, [
    posting({ nativeId: 'old', postedAt: daysAgo(30), url: 'https://example.invalid/old' }),
    posting({ nativeId: 'new', postedAt: daysAgo(3), url: 'https://example.invalid/new' }),
  ]);
  const by = Object.fromEntries(st.rows.map((r) => [r.id, r]));
  assert.equal(by['ashby:initechwidgets:old'].backlog, true);
  assert.equal(by['ashby:initechwidgets:new'].backlog, false);
  assert.deepEqual(st.fresh.map((r) => r.id), ['ashby:initechwidgets:new']);
  assert.equal(st.counts.backlogNew, 1);
});

test('the same 30-day-old posting on a baselined board is fresh', () => {
  const st = state();
  processBoard(st, baselined, [posting({ postedAt: daysAgo(30) })]);
  assert.equal(st.fresh.length, 1);
  assert.equal(st.rows[0].backlog, false);
});

test('no date counts as old on a first poll', () => {
  const st = state();
  processBoard(st, company, [posting({ postedAt: null })]);
  assert.equal(st.rows[0].backlog, true);
  assert.equal(st.fresh.length, 0);
});

test('a stored row keeps its backlog value, status and notes', () => {
  const st = state([stored({ status: 'applied', applied_at: '2026-10-01', notes: 'sent', backlog: true })]);
  processBoard(st, baselined, [posting()]);
  assert.equal(st.rows[0].status, 'applied');
  assert.equal(st.rows[0].notes, 'sent');
  assert.equal(st.rows[0].backlog, true);
  assert.equal(st.fresh.length, 0, 'not new');
});

test('an ineligible new row is not stored; an ineligible stored row is still updated', () => {
  const st = state();
  processBoard(st, baselined, [posting({ location: 'Remote, Brazil' })]);
  assert.equal(st.rows.length, 0);
  assert.equal(st.counts.skippedIneligible, 1);
  const st2 = state([stored()]);
  processBoard(st2, baselined, [posting({ location: 'Remote, Brazil' })]);
  assert.equal(st2.rows.length, 1);
  assert.equal(st2.rows[0].eligible, false);
});

test('a bare Remote whose title names another region is dropped', () => {
  const st = state();
  processBoard(st, baselined, [posting({ title: 'Technical Support Engineer - Americas' })]);
  assert.equal(st.rows.length, 0);
});

test('title is trimmed; the one score bar applies to every company', () => {
  const low = state([], ctx({ min: 100 }));
  processBoard(low, baselined, [posting({ title: '  Technical Support Engineer ' })]);
  assert.equal(low.rows[0].title, 'Technical Support Engineer');
  assert.equal(low.fresh.length, 0, 'below the bar');
  const st = state();
  processBoard(st, baselined, [posting()]);
  assert.ok(st.rows[0].score >= 70, `score ${st.rows[0].score}`);
  assert.equal(st.fresh.length, 1);
});

test('a feed twin with the same URL is replaced by the board row; an acted one blocks the copy', () => {
  const twin = stored({ id: 'rr:55', status: 'saved', notes: 'look at this' });
  const st = state([twin]);
  processBoard(st, baselined, [posting()]);
  assert.equal(st.rows.length, 1);
  assert.equal(st.rows[0].status, 'saved');
  assert.equal(st.rows[0].notes, 'look at this');
  assert.deepEqual(st.superseded, ['rr:55']);
  assert.equal(st.fresh.length, 0, 'it was announced already');
  const st2 = state([{ ...twin, status: 'applied' }]);
  processBoard(st2, baselined, [posting()]);
  assert.equal(st2.rows.length, 0);
});

test('a drafted twin makes the board row backlog so it is not drafted twice', () => {
  const st = newState(ctx(), [stored({ id: 'rr:55' })], new Set(['rr:55']));
  processBoard(st, baselined, [posting()]);
  assert.equal(st.rows[0].backlog, true);
});

test('a title twin of an applied row is backlog', () => {
  const st = state([stored({ id: 'linkedin:9', url: 'https://example.invalid/other', status: 'applied' })]);
  processBoard(st, baselined, [posting()]);
  assert.equal(st.rows[0].backlog, true);
  assert.equal(st.fresh.length, 0);
});

test('a staffing company is backlog', () => {
  const st = state();
  processBoard(st, { ...baselined, name: 'Initech Staffing' }, [posting()]);
  assert.equal(st.rows[0].backlog, true);
});

test('every row has the same keys and none has first_seen_at', () => {
  const st = state();
  processBoard(st, company, [posting({ nativeId: 'a' }), posting({ nativeId: 'b', postedAt: daysAgo(40), url: 'https://example.invalid/b' })]);
  const keys = (r) => Object.keys(r).sort().join();
  assert.equal(new Set(st.rows.map(keys)).size, 1);
  assert.ok(!('first_seen_at' in st.rows[0]));
});

// --- feeds ------------------------------------------------------------------
const feed = { id: 'himalayas', idPrefix: 'him', label: 'Himalayas', textKind: 'aggregator' };
const listing = (o = {}) => ({ ...posting(), company: { name: 'Initech Widgets', slug: 'initech-widgets', homepage: null }, remote: true, germanFlag: false, languageNote: '', ghostScore: null, ...o });

test('a feed listing already covered by a board posting read this run is dropped, eligible or not', () => {
  const st = state();
  processBoard(st, baselined, [posting({ location: 'Remote, Brazil' })]);
  const c = ingestFeed(feed, [listing({ nativeId: 'h1', location: 'Germany Remote' })], st);
  assert.equal(c.board, 1);
  assert.equal(st.rows.filter((r) => r.id.startsWith('him:')).length, 0);
});

test('same role from a stored row, or the same feed twice: no new row', () => {
  const st = state([stored({ url: 'https://example.invalid/stored' })]);
  const c = ingestFeed(feed, [listing({ nativeId: 'a', url: 'https://example.invalid/a' })], st);
  assert.equal(c.known, 1);
  const st2 = state();
  const c2 = ingestFeed(feed, [listing({ nativeId: 'a', url: 'https://example.invalid/a' }), listing({ nativeId: 'b', url: 'https://example.invalid/b' })], st2);
  assert.equal(c2.kept, 1);
  assert.equal(c2.copy, 1);
});

test("a listing's own stored id is updated, not dropped", () => {
  const st = state([stored({ id: 'him:a', url: 'https://example.invalid/a', status: 'saved' })]);
  const c = ingestFeed(feed, [listing({ nativeId: 'a', url: 'https://example.invalid/a' })], st);
  assert.equal(c.kept, 1);
  assert.equal(st.rows[0].status, 'saved');
});

test('first run of a feed: at most 3 fresh rows, the rest are backlog; the second run is normal', () => {
  const many = Array.from({ length: 12 }, (_, i) => listing({ nativeId: `n${i}`, url: `https://example.invalid/n${i}`, title: `Technical Support Engineer ${i}`, company: { name: `Coa${i}`, slug: `coa-${i}`, homepage: null } }));
  const st = state();
  ingestFeed(feed, many, st, { firstRun: true });
  assert.equal(st.fresh.length, 3);
  assert.equal(st.rows.filter((r) => r.backlog).length, 9);
  const st2 = state();
  ingestFeed(feed, many.slice(0, 10), st2, { firstRun: false });
  assert.equal(st2.fresh.length, 10);
});

test('a feed creates unknown companies as aggregator rows and never sets a board', () => {
  const st = state();
  ingestFeed(feed, [listing({ company: { name: 'Hooli', slug: 'hooli', homepage: 'https://www.hooli.example/x' } })], st);
  const c = st.newCompanies.get('hooli');
  assert.equal(c.origin, 'aggregator');
  assert.equal(c.domain, 'www.hooli.example');
  assert.ok(!('board_kind' in c) && !('board_token' in c));
});

test('withDefaults never fills feeds, and an owner without a feeds block asks for no feed', () => {
  const p = withDefaults({ roles: [], skills: {} });
  assert.equal(p.feeds, undefined);
  for (const f of FEEDS.filter((x) => x.id !== 'remoterocketship')) assert.equal(f.config(p, false), null);
  assert.equal(remoterocketship.config(p, false), null);
  assert.ok(remoterocketship.config(p, true));
});

test('feeds map fixture bodies and reach only their own hosts', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const body = String(url).includes('himalayas')
      ? { jobs: [{ guid: 'https://example.invalid/g/1', title: 'Support Engineer', applicationLink: 'https://example.invalid/apply/1', companyName: 'Initech Widgets', companySlug: 'initech-widgets', locationRestrictions: ['Germany'], pubDate: 1793000000, description: '<p>Text</p>' }] }
      : { jobs: [{ id: 77, url: 'https://example.invalid/jobicy/77', jobTitle: 'Support Engineer', companyName: 'Globex', jobGeo: 'Germany', pubDate: '2026-10-30 12:00:00', jobDescription: '<p>Hello</p>' }] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const him = await feedHimalayas.fetch({ queries: ['support engineer'], countries: ['Germany'] }, { wait: async () => {} });
    assert.equal(him.length, 1);
    assert.match(him[0].nativeId, /^[0-9a-f]{16}$/);
    assert.equal(him[0].url, 'https://example.invalid/apply/1');
    assert.match(him[0].location, /Germany/);
    const job = await feedJobicy.fetch({ geo: 'germany' });
    assert.equal(job[0].nativeId, '77');
    assert.equal(job[0].postedAt, '2026-10-30T12:00:00.000Z');
    assert.ok(asked.every((u) => /^https:\/\/(himalayas\.app|jobicy\.com)\//.test(u)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('one feed throwing does not affect another', async () => {
  clearFeedMemo();
  const bad = { id: 'bad', fetch: async () => { throw new Error('down'); } };
  const good = { id: 'good', fetch: async () => [1] };
  await assert.rejects(memoFeed(bad, {}));
  assert.deepEqual(await memoFeed(good, {}), [1]);
});

// --- board normalisers --------------------------------------------------------
async function withFetch(map, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = map[String(url)];
    return hit === undefined ? new Response('no', { status: 404 }) : new Response(typeof hit === 'string' ? hit : JSON.stringify(hit), { status: 200 });
  };
  clearBoardMemo();
  try { return await fn(); } finally { globalThis.fetch = realFetch; clearBoardMemo(); }
}

test('Workable, Recruitee and Personio map to the board shape', async () => {
  const xml = '<?xml version="1.0"?><workzag-jobs><position><id>42</id><subcompany>Initech</subcompany><office>Remote DE</office><additionalOffices><office>Aachen</office><office>Munich</office></additionalOffices><name>Support Engineer</name><jobDescriptions><jobDescription><name>A</name><value><![CDATA[<p>Help customers.</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-10-30T10:00:00+00:00</createdAt></position></workzag-jobs>';
  await withFetch(
    {
      'https://apply.workable.com/api/v1/widget/accounts/acme?details=true': { name: 'Acme', jobs: [{ shortcode: 'AB12', title: 'Support Engineer', url: 'https://apply.workable.com/acme/j/AB12/', city: 'Berlin', country: 'Germany', telecommuting: true, description: '<p>Hi</p>', published_on: '2026-10-30' }] },
      'https://acme.recruitee.com/api/offers/': { offers: [{ id: 9, title: 'Support Engineer', careers_url: 'https://acme.recruitee.com/o/s', location: 'Hamburg', remote: true, description: '<p>A</p>', requirements: '<p>B</p>', published_at: '2026-10-30 16:32:58 UTC', company_name: 'Acme' }] },
      'https://acme.jobs.personio.de/xml?language=en': xml,
    },
    async () => {
      const w = (await BOARDS.workable('acme'))[0];
      assert.equal(w.nativeId, 'AB12');
      assert.match(w.location, /Remote/);
      assert.equal(w.postedAt, '2026-10-30T00:00:00.000Z');
      const r = (await BOARDS.recruitee('acme'))[0];
      assert.equal(r.nativeId, '9');
      assert.equal(r.postedAt, '2026-10-30T16:32:58.000Z');
      assert.match(r.location, /Remote/);
      const p = (await BOARDS.personio('acme'))[0];
      assert.equal(p.nativeId, '42');
      assert.match(p.location, /Germany/);
      assert.doesNotMatch(p.location, /\bDE\b/);
      assert.equal(p.url, 'https://acme.jobs.personio.de/job/42?language=en');
      assert.equal(parsePersonio(xml, 'acme').length, 1);
    }
  );
});

test('a board token that would build a hostile host makes no request', async () => {
  let asked = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { asked++; return new Response('{}'); };
  clearBoardMemo();
  try {
    await assert.rejects(fetchBoard('recruitee', 'a.evil.com'));
    await assert.rejects(fetchBoard('teamtailor', '127.0.0.1'));
    assert.equal(asked, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Greenhouse uses first_published, Ashby drops unlisted postings', async () => {
  await withFetch(
    {
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': { jobs: [{ id: 1, title: 'X', absolute_url: 'u', location: { name: 'Berlin' }, content: '', updated_at: '2026-10-30T00:00:00Z', first_published: '2026-10-01T00:00:00Z', company_name: 'Acme' }] },
      'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=false': { jobs: [{ id: 'a', title: 'Listed', jobUrl: 'u', isListed: true }, { id: 'b', title: 'Hidden', jobUrl: 'u', isListed: false }] },
    },
    async () => {
      assert.equal((await BOARDS.greenhouse('acme'))[0].postedAt, '2026-10-01T00:00:00.000Z');
      assert.deepEqual((await BOARDS.ashby('acme')).map((x) => x.title), ['Listed']);
    }
  );
});

test('slugifyTitle trims a leading space, lowercases, hyphenates', () => {
  assert.equal(slugifyTitle(' Technical Support Engineer'), 'technical-support-engineer');
  assert.equal(slugifyTitle('  Support Eng. (EMEA) / Remote  '), 'support-eng-emea-remote');
});

test('careersUrlFor needs an https template with {slug}', () => {
  assert.equal(careersUrlFor('https://example.invalid/careers/{slug}', ' Support Engineer'), 'https://example.invalid/careers/support-engineer');
  assert.equal(careersUrlFor(null, 'Support Engineer'), null);
  assert.equal(careersUrlFor('http://example.invalid/{slug}', 'Support Engineer'), null);
  assert.equal(careersUrlFor('https://example.invalid/careers', 'Support Engineer'), null);
});

test('careers_url is written only when the company has a template; url and dedupe key stay the board link', () => {
  const withTpl = { ...company, careers_url_template: 'https://example.invalid/careers/{slug}' };
  const a = state();
  processBoard(a, withTpl, [posting({ title: ' Technical Support Engineer' })]);
  assert.equal(a.rows[0].careers_url, 'https://example.invalid/careers/technical-support-engineer');
  assert.equal(a.rows[0].url, 'https://example.invalid/j/1');
  assert.ok(a.boardKeys.has(`u:${urlKeyOf('https://example.invalid/j/1')}`));
  const b = state();
  processBoard(b, company, [posting()]);
  assert.equal(b.rows[0].careers_url, null);
  // A stored careers_url survives a poll for a company without a template.
  const c = state([stored({ careers_url: 'https://example.invalid/hand/set' })]);
  processBoard(c, baselined, [posting()]);
  assert.equal(c.rows[0].careers_url, 'https://example.invalid/hand/set');
});
