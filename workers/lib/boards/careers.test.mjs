// Invented sites only. A recording fetch stands in for the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, parseRobots, robotsAllows, scanCareersPage, checkCareers } from './careers.mjs';

const D = 'acme.example';

test('inScope allows only the homepage, careers paths and career hosts on that domain', () => {
  for (const ok of [`https://${D}/`, `https://${D}/careers`, `https://www.${D}/en/careers/open`, `https://careers.${D}/x`, `https://${D}/about/careers`]) assert.equal(inScope(ok, D), true, ok);
  for (const bad of [`https://${D}/blog`, `https://${D}/about`, `https://${D}/pricing`, `https://${D}/careers/../admin`, 'https://other.example/careers', `http://${D}/careers`, 'https://127.0.0.1/careers', `https://${D}:8443/careers`, `https://user@${D}/careers`]) {
    assert.equal(inScope(bad, D), false, bad);
  }
});

test('robots: Disallow stops a path, longest match wins, our own group beats *, empty Disallow allows', () => {
  const r = parseRobots('User-agent: *\nDisallow: /careers\nAllow: /careers/open\n');
  assert.equal(robotsAllows(r, '/careers'), false);
  assert.equal(robotsAllows(r, '/careers/open/1'), true);
  assert.equal(robotsAllows(r, '/jobs'), true);
  const own = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: jobhunt-console\nAllow: /\n');
  assert.equal(robotsAllows(own, '/careers'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:\n'), '/x'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$\n'), '/a.pdf'), false);
});

const res = (status, body = '', headers = {}) => new Response(body, { status, headers });
function site(map) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    const hit = map[String(url)];
    if (hit === undefined) return res(404);
    return typeof hit === 'function' ? hit() : hit;
  };
  return { asked, fetchImpl };
}
const opts = (fetchImpl) => ({ fetchImpl, gap: 0 });

test('a homepage that links everywhere: only robots.txt, the homepage and careers paths are requested, within budget', async () => {
  const links = Array.from({ length: 500 }, (_, i) => `<a href="/careers/role-${i}">Support Engineer ${i}</a><a href="/blog/${i}">Post ${i}</a><a href="/pricing">Pricing</a>`).join('');
  const s = site({
    [`https://${D}/robots.txt`]: res(200, 'User-agent: *\nDisallow:\n'),
    [`https://${D}/`]: res(200, `<html><body><a href="/careers">Careers</a>${links}</body></html>`),
    [`https://${D}/careers`]: res(200, `<html><body>${links}</body></html>`),
  });
  const r = await checkCareers(D, opts(s.fetchImpl));
  for (const u of s.asked) assert.ok(u.endsWith('/robots.txt') || u === `https://${D}/` || inScope(u, D), `out of scope: ${u}`);
  assert.ok(s.asked.length <= 1 + 1 + 4 + 1, `requests ${s.asked.length}`);
  assert.equal(r.status, 'hint');
  assert.ok(r.hints.length <= 5);
});

test('robots Disallow on careers makes no request to that path; a 403 on robots.txt stops everything; a 404 allows', async () => {
  const s = site({ [`https://${D}/robots.txt`]: res(200, 'User-agent: *\nDisallow: /careers\nDisallow: /jobs\nDisallow: /join-us\nDisallow: /company\nDisallow: /about\nDisallow: /karriere\nDisallow: /en\n'), [`https://${D}/`]: res(200, '<html>home</html>') });
  const r = await checkCareers(D, opts(s.fetchImpl));
  assert.ok(!s.asked.some((u) => /\/(careers|jobs|join-us|karriere)/.test(u)), s.asked.join(' '));
  assert.equal(r.status, 'disallowed');
  const s2 = site({ [`https://${D}/robots.txt`]: res(403) });
  assert.equal((await checkCareers(D, opts(s2.fetchImpl))).status, 'blocked');
  assert.equal(s2.asked.length, 1);
  const s3 = site({ [`https://${D}/robots.txt`]: res(404), [`https://${D}/`]: res(200, '<html>home</html>'), [`https://${D}/careers`]: res(200, '<a href="https://jobs.lever.co/acme">Jobs</a>') });
  const r3 = await checkCareers(D, opts(s3.fetchImpl));
  assert.deepEqual(r3.embeds, [{ kind: 'lever', token: 'acme', unsupported: false }]);
  assert.equal(r3.status, 'board');
});

test('a block (403, cf-mitigated, challenge page) is one request to that page and no retry', async () => {
  for (const blocked of [() => res(403), () => res(200, '<html>x</html>', { 'cf-mitigated': 'challenge' }), () => res(200, '<title>Just a moment...</title>')]) {
    const s = site({ [`https://${D}/robots.txt`]: res(404), [`https://${D}/`]: res(200, '<html>home</html>'), [`https://${D}/careers`]: blocked });
    const r = await checkCareers(D, opts(s.fetchImpl));
    assert.equal(r.status, 'blocked');
    assert.equal(s.asked.filter((u) => u.endsWith('/careers')).length, 1);
    assert.ok(!s.asked.some((u) => u.endsWith('/jobs')), 'no other path after a block');
  }
});

test('a redirect off-site is not followed; a redirect to a board host becomes a token with no fetch of that page', async () => {
  const off = site({ [`https://${D}/robots.txt`]: res(404), [`https://${D}/`]: res(200, 'x'), [`https://${D}/careers`]: res(302, '', { location: 'https://parent.example/careers' }) });
  const r = await checkCareers(D, opts(off.fetchImpl));
  assert.equal(r.status, 'moved');
  assert.equal(r.moved, 'parent.example');
  assert.ok(!off.asked.some((u) => u.includes('parent.example')));
  const board = site({ [`https://${D}/robots.txt`]: res(404), [`https://${D}/`]: res(200, 'x'), [`https://${D}/careers`]: res(302, '', { location: 'https://jobs.ashbyhq.com/acme' }) });
  const r2 = await checkCareers(D, opts(board.fetchImpl));
  assert.deepEqual(r2.embeds, [{ kind: 'ashby', token: 'acme' }]);
  assert.ok(!board.asked.some((u) => u.includes('ashbyhq')));
});

test('scanCareersPage finds every embed shape and rejects hostile tokens', () => {
  const html = [
    '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>',
    '<a href="https://jobs.ashbyhq.com/acme-two">x</a>',
    "<script>var ASHBY_BOARD = 'acme-three';</script>",
    '<a href="https://apply.workable.com/acme-four/">x</a>',
    '<a href="https://acme-five.recruitee.com/o/x">x</a>',
    '<a href="https://acme-six.jobs.personio.de/">x</a>',
    '<a href="https://acme-seven.teamtailor.com/jobs">x</a>',
    '<a href="https://jobs.smartrecruiters.com/AcmeEight">x</a>',
    '<a href="https://acme-nine.wd5.myworkdayjobs.com/en">x</a>',
    '<a href="https://jobs.gem.com/acme-ten">x</a>',
    '<a href="https://www.gem.com/form">not a board</a>',
    '<a href="https://jobs.lever.co/..">hostile</a>',
  ].join('');
  const { embeds } = scanCareersPage(html, 'https://acme.example/careers');
  const tokens = embeds.map((e) => `${e.kind}:${e.token}`);
  for (const t of ['greenhouse:acme', 'ashby:acme-two', 'ashby:acme-three', 'workable:acme-four', 'recruitee:acme-five', 'personio:acme-six', 'teamtailor:acme-seven.teamtailor.com', 'smartrecruiters:AcmeEight', 'workday:acme-nine', 'gem:acme-ten']) assert.ok(tokens.includes(t), t);
  assert.ok(!tokens.some((t) => t.startsWith('lever:')), 'hostile token rejected');
  assert.ok(!tokens.some((t) => t.includes('form')));
});

test('plain HTML titles become hints, JSON-LD is only counted, and a thin page is a shell', () => {
  const page = scanCareersPage('<a href="/careers/1">Support Engineer</a><a href="/x">Read more</a><script type="application/ld+json">{"@type":"JobPosting"}</script>', 'https://acme.example/careers', (t) => /support/i.test(t));
  assert.deepEqual(page.titles.map((t) => t.title), ['Support Engineer']);
  assert.equal(page.ldSeen, 1);
  assert.equal(scanCareersPage('<div id="app"></div><script>boot()</script>', 'https://acme.example/careers').jsShell, true);
});
