#!/usr/bin/env node
// Finds new roles at her target companies, straight from their job boards.
//
//   node workers/jobs.mjs [--dry-run] [--company vercel] [--min 70]
//
// Greenhouse, Ashby and Lever all publish open JSON. That is better than
// scraping LinkedIn in three ways: it is allowed, it carries the full
// description so scoring is honest, and a role appears here before it reaches
// LinkedIn. It is also how she would hear the day Vercel reopens the
// Germany-remote support role she interviewed for.

import { pathToFileURL } from 'node:url';
import { select, upsert, updateEach, startRun, parseArgs } from './lib/db.mjs';
import { UA, sleep } from './lib/sources.mjs';
import { loadProfile, scoreJob } from './lib/jobfit/jobfit.mjs';

/** Titles worth scoring at all. Everything else on a 600-job board is noise. */
const RELEVANT =
  /(support|solutions?|success|technical account|implementation|onboarding|service desk|helpdesk|escalation)/i;
const CLEARLY_NOT =
  /(intern|working student|werkstudent|praktik|sales development|account executive|recruiter|designer|marketing manager|data scientist|frontend|backend engineer|software engineer)/i;

const strip = (html) =>
  String(html || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/** Each board, normalised to one shape. */
const BOARDS = {
  async greenhouse(token) {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    return (j.jobs || []).map((x) => ({
      nativeId: String(x.id),
      title: x.title,
      url: x.absolute_url,
      location: x.location?.name || '',
      description: strip(x.content),
      postedAt: x.updated_at || x.first_published || null,
    }));
  },
  async ashby(token) {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`);
    return (j.jobs || []).map((x) => ({
      nativeId: String(x.id),
      title: x.title,
      url: x.jobUrl,
      location: [x.location, x.isRemote ? 'Remote' : ''].filter(Boolean).join(' '),
      description: strip(x.descriptionHtml || x.descriptionPlain),
      postedAt: x.publishedAt || null,
    }));
  },
  async lever(token) {
    const j = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
    return (j || []).map((x) => ({
      nativeId: String(x.id),
      title: x.text,
      url: x.hostedUrl,
      location: x.categories?.location || '',
      description: strip(x.descriptionPlain || x.description),
      postedAt: x.createdAt ? new Date(x.createdAt).toISOString() : null,
    }));
  },
};

/**
 * Remote Rocketship, an aggregator, filtered to her titles and Germany. Its
 * listing page is server-rendered Next.js with the jobs in __NEXT_DATA__, and
 * robots.txt allows the path. Pagination is client-side and ?page= is ignored
 * by the server, so this reads the first page only: sorted newest first and
 * with about fourteen additions a week, twenty a day covers everything that
 * arrives. Descriptions are not in the payload; the two summaries, the tech
 * stack and the language flags stand in, and requiredLanguages is a cleaner
 * German signal than any regex over prose.
 */
const RR_URL =
  'https://www.remoterocketship.com/remote-jobs/?page=1&sort=DateAdded' +
  '&jobTitle=Customer%2520Support%2520Engineer%2CTechnical%2520Support%2520Engineer%2CSupport%2520Engineer' +
  '%2CTechnical%2520Support%2520Specialist%2CCustomer%2520Success%2520Engineer%2CClient%2520Support%2520Engineer' +
  '&locations=Germany';

async function fetchRemoteRocketship() {
  const r = await fetch(RR_URL, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`remoterocketship -> ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('remoterocketship: __NEXT_DATA__ not found (page layout changed?)');
  const jobs = JSON.parse(m[1])?.props?.pageProps?.initialJobOpenings || [];
  return jobs.map((x) => {
    const langs = Array.isArray(x.requiredLanguages) ? x.requiredLanguages : [];
    return {
      nativeId: String(x.id),
      title: x.roleTitle || '',
      url: x.url,
      location: [x.location, x.locationType === 'remote' ? 'Remote' : x.locationType || ''].filter(Boolean).join(' '),
      description: [x.jobDescriptionSummary, x.twoLineJobDescriptionSummary, (x.techStack || []).join(', ')].filter(Boolean).join(' '),
      postedAt: x.created_at || null,
      company: { name: x.company?.name || '', slug: x.company?.slug || '', homepage: x.company?.homePageURL || null },
      remote: x.locationType === 'remote',
      // The aggregator read the posting; trust its language flags over our regex.
      germanFlag: langs.includes('de') || x.descriptionLanguage === 'de',
      languageNote:
        x.descriptionLanguage === 'de'
          ? 'posting written in German (Remote Rocketship)'
          : langs.length
            ? `required languages per Remote Rocketship: ${langs.join(', ')}`
            : '',
      senior: !!x.isSenior,
      ghostScore: x.ghostScore ?? null,
    };
  });
}

/**
 * Her rule, applied to a board posting. Same shape as the import's check:
 * Germany or an EU/EMEA-wide posting, or a bare "Remote" that names no country
 * yet. A single non-German country never qualifies, whatever "remote" it adds.
 */
export function eligibleFrom(location, remote, germanRequired) {
  if (germanRequired) return false;
  const loc = String(location || '').toLowerCase();
  if (/german|deutschland|berlin|hamburg|münchen|munich|frankfurt|köln|cologne|stuttgart|düsseldorf/.test(loc)) return true;
  if (/\beu\b|\beea\b|european union|\beurope\b|emea/.test(loc)) return true;
  const rest = loc
    .replace(/remote|hybrid|on-?site|full-?time|part-?time|contract|permanent|anywhere/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return rest === '' && remote !== false;
}

async function main() {
  const args = parseArgs();
  const min = Number(args.min || 70);
  const finish = args['dry-run'] ? async () => {} : await startRun('jobs');
  const profile = loadProfile();

  let companies = await select(
    'companies',
    '?select=slug,name,board_kind,board_token&board_token=not.is.null&board_kind=not.is.null'
  );
  if (args.company) companies = companies.filter((c) => c.slug === args.company);
  if (!companies.length) {
    console.log('no companies have a job board configured');
    await finish(true, { polled: 0 });
    return;
  }

  const known = await select('jobs', '?select=id,url');
  const existing = new Set(known.map((j) => j.id));
  // The aggregator relays postings the board pollers may already hold; the
  // employer URL is the same in both, so it is the dedupe key across sources.
  const knownUrls = new Set(known.map((j) => (j.url || '').replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  const rows = [];
  const fresh = [];
  const status = {};

  for (const c of companies) {
    const fetcher = BOARDS[c.board_kind];
    if (!fetcher) continue;
    let postings;
    try {
      postings = await fetcher(c.board_token);
      status[c.slug] = postings.length;
    } catch (e) {
      status[c.slug] = `failed: ${e.message.slice(0, 80)}`;
      console.warn(`  ${c.slug}: ${e.message}`);
      continue;
    }

    let kept = 0;
    for (const p of postings) {
      if (!RELEVANT.test(p.title) || CLEARLY_NOT.test(p.title)) continue;
      const scored = scoreJob(
        { title: p.title, company: c.name, location: p.location, description: p.description },
        profile
      );
      const id = `${c.board_kind}:${c.board_token}:${p.nativeId}`;
      const eligible = eligibleFrom(p.location, scored.remote, scored.germanRequired);
      const row = {
        id,
        source: c.board_kind,
        company_slug: c.slug,
        company: c.name,
        title: p.title,
        url: p.url,
        location: p.location || null,
        workplace_type: /remote/i.test(p.location || '') ? 'Remote' : null,
        posted_date: p.postedAt ? p.postedAt.slice(0, 10) : null,
        excerpt: p.description.slice(0, 400) || null,
        score: scored.total,
        score_breakdown: scored.breakdown,
        score_notes: scored.notes,
        german_required: scored.germanRequired,
        remote: scored.remote ?? null,
        eligible,
        closed: false,
        last_seen_at: new Date().toISOString(),
      };
      rows.push(row);
      kept++;
      if (!existing.has(id) && eligible && scored.total >= min) fresh.push(row);
    }
    console.log(`  ${c.slug.padEnd(18)} ${String(postings.length).padStart(4)} posting(s), ${kept} relevant`);
    await sleep(600);
  }

  // Remote Rocketship: newest twenty across many employers, most of them not on
  // any board we poll. Companies it names that the console has never seen are
  // created minimally so the foreign key holds; logos can follow.
  const newCompanies = new Map();
  try {
    const rr = await fetchRemoteRocketship();
    let kept = 0;
    let dup = 0;
    for (const p of rr) {
      if (!RELEVANT.test(p.title) || CLEARLY_NOT.test(p.title)) continue;
      const urlKey = (p.url || '').replace(/\/+$/, '').toLowerCase();
      const id = `rr:${p.nativeId}`;
      if (urlKey && knownUrls.has(urlKey) && !existing.has(id)) { dup++; continue; }
      const slug = (p.company.slug || p.company.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!slug) continue;
      const scored = scoreJob({ title: p.title, company: p.company.name, location: p.location, description: p.description }, profile);
      const germanRequired = p.germanFlag || scored.germanRequired;
      const eligible = eligibleFrom(p.location, p.remote, germanRequired);
      newCompanies.set(slug, { slug, name: p.company.name || slug, domain: p.company.homepage ? p.company.homepage.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null });
      const row = {
        id,
        source: 'remoterocketship',
        company_slug: slug,
        company: p.company.name || slug,
        title: p.title,
        url: p.url,
        location: p.location || null,
        workplace_type: p.remote ? 'Remote' : null,
        posted_date: p.postedAt ? p.postedAt.slice(0, 10) : null,
        excerpt: p.description.slice(0, 400) || null,
        score: scored.total,
        score_breakdown: scored.breakdown,
        score_notes: { ...scored.notes, language: p.languageNote ? `${p.languageNote}${germanRequired ? ' (GERMAN REQUIRED)' : ''}` : scored.notes.language, ghost: p.ghostScore != null ? `Remote Rocketship ghost score ${p.ghostScore}` : undefined },
        german_required: germanRequired,
        remote: p.remote,
        eligible,
        closed: false,
        last_seen_at: new Date().toISOString(),
      };
      rows.push(row);
      kept++;
      if (!existing.has(id) && eligible && scored.total >= min) fresh.push(row);
    }
    status.remoterocketship = `${rr.length} listed, ${kept} relevant, ${dup} already known from a board`;
    console.log(`  ${'remoterocketship'.padEnd(18)} ${String(rr.length).padStart(4)} listing(s), ${kept} relevant, ${dup} duplicate(s) of board postings`);
  } catch (e) {
    status.remoterocketship = `failed: ${e.message.slice(0, 80)}`;
    console.warn(`  remoterocketship: ${e.message}`);
  }

  rows.sort((a, b) => b.score - a.score);
  if (args['dry-run']) {
    console.log(`\n${rows.length} relevant, ${fresh.length} new and eligible at ${min}+`);
    for (const r of rows.filter((x) => x.eligible).slice(0, 12)) {
      console.log(`  ${String(r.score).padStart(3)}  ${r.company.padEnd(14)} ${r.title.slice(0, 48).padEnd(50)} ${r.location.slice(0, 26)}`);
    }
    return;
  }

  // A row already in the table keeps whatever she decided in the console.
  // Every row must carry an explicit status, not only the known ones: the
  // batch upsert gives all rows the same key set, so a new posting sitting
  // beside preserved rows would otherwise be sent with status null, and an
  // explicit null beats the column default. That is how the first genuinely
  // new posting after the import (a Stripe role on 22 Sep) failed the whole
  // daily run with "null value in column status".
  // Companies first, or the jobs insert fails its foreign key. Only slugs the
  // console has never seen are written, so nothing existing is overwritten.
  if (newCompanies.size) {
    const have = new Set((await select('companies', '?select=slug')).map((c) => c.slug));
    const missing = [...newCompanies.values()].filter((c) => !have.has(c.slug));
    if (missing.length) await upsert('companies', missing, { onConflict: 'slug' });
  }

  const keep = await select('jobs', '?select=id,status,applied_at,notes');
  const byId = new Map(keep.map((k) => [k.id, k]));
  for (const r of rows) {
    const prev = byId.get(r.id);
    r.status = prev?.status ?? 'found';
    r.applied_at = prev?.applied_at ?? null;
    r.notes = prev?.notes ?? null;
  }
  await upsert('jobs', rows);

  // A board posting that disappeared is closed, not deleted: she may have applied.
  const seen = new Set(rows.map((r) => r.id));
  const stale = keep
    .filter((k) => /^(greenhouse|ashby|lever):/.test(k.id) && !seen.has(k.id))
    .map((k) => ({ id: k.id, closed: true }));
  if (stale.length) await updateEach('jobs', 'id', stale);

  if (fresh.length) {
    await upsert(
      'notifications',
      fresh.slice(0, 10).map((r) => ({
        kind: 'new_job',
        severity: 'action',
        title: `${r.company}: ${r.title}`,
        body: `${r.location} · score ${r.score}`,
        url: '/jobs',
        entity_ref: r.id,
        dedupe_key: `job:${r.id}`,
      })),
      { onConflict: 'dedupe_key' }
    );
  }

  console.log(`\n${rows.length} relevant role(s), ${fresh.length} new above ${min}, ${stale.length} closed`);
  await finish(true, { relevant: rows.length, new: fresh.length, closed: stale.length, boards: status });
}

// Run only when invoked directly. scripts/rescore-linkedin.mjs imports
// eligibleFrom from here, and importing must not start a board poll. Compared
// through pathToFileURL because on Windows import.meta.url is file:///C:/...
// while argv[1] is a bare path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => setTimeout(() => process.exit(0), 200))
    .catch((e) => {
      console.error(e.message);
      setTimeout(() => process.exit(1), 200);
    });
}
