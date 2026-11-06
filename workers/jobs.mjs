#!/usr/bin/env node
// Finds new roles at her target companies, straight from their job boards.
//
//   node workers/jobs.mjs [--dry-run] [--company vercel] [--min 70] [--owner <label|uuid>]
//                         [--only-new-boards]
//
// Runs once per person in the console. Her profile is the committed
// lib/jobfit/profile.json; anyone else's lives in their own `settings` row
// `jobfit_profile`, so a second person's skills and rules never reach the
// public repo. A person without one is skipped.
//
// Greenhouse, Ashby, Lever, Teamtailor, Workable, Recruitee and Personio all
// publish openly. That is better than scraping LinkedIn in three ways: it is
// allowed, it carries the full description so scoring is honest, and a role
// appears here before it reaches LinkedIn. Feeds (lib/feeds) add roles from
// aggregators, and an employer's own board always wins over a feed's copy.
//
// This repository and its Actions logs are public. In Actions this prints
// counts only: never a company, slug, board token, title, URL or owner label.
// See lib/publiclog.mjs; locally everything is printed as before.

import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { owners, forOwner, parseArgs } from './lib/db.mjs';
import { sleep } from './lib/sources.mjs';
import { DEFAULT_PROFILE, loadProfile, scoreJob } from './lib/jobfit/jobfit.mjs';
import { resolveFull } from './lib/resume/resolve.mjs';
import { BOARDS, fetchBoard } from './lib/boards/fetch.mjs';
import { byHost } from './lib/boards/pace.mjs';
import { hostKey, gapMs } from './lib/boards/hosts.mjs';
import { core } from './lib/boards/classify.mjs';
import { isStaffing } from './lib/boards/noise.mjs';
import { isRecent, otherRegionTitle, normTitle, urlKeyOf, FEED_FIRST_RUN_MAX_FRESH } from './lib/boards/policy.mjs';
import { FEEDS, memoFeed } from './lib/feeds/index.mjs';
import { detail, detailWarn, who, isLocal } from './lib/publiclog.mjs';
import { safeCode } from './lib/resume/safelog.mjs';

export { BOARDS };

/**
 * Titles worth scoring at all. Everything else on a 600-job board is noise.
 *
 * "customer engineer" and "forward deployed" are here because Reap's Technical
 * Customer Engineer (EMEA) matched none of the original words and was dropped,
 * although the description is L2/L3 escalation work and the posting names
 * Germany. Several fintechs now use those titles for what everyone else calls
 * a support or solutions engineer.
 */
// 'solutions' is deliberately not matched on its own: Reap's "Senior Software
// Engineer, Card Solutions" and "Engineering Manager, Card Solutions" are a
// product line, not a role family, and both registered as relevant. Solutions
// Engineer, Solutions Architect and Solutions Consultant are the real targets.
export const RELEVANT =
  /(support|solutions? (engineer|architect|consultant)|success|technical account|customer engineer|forward deployed|implementation|onboarding|service desk|helpdesk|escalation)/i;
export const CLEARLY_NOT =
  /(intern|working student|werkstudent|praktik|sales development|account executive|recruiter|designer|marketing manager|data scientist|frontend|backend engineer|software engineer)/i;

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

/**
 * A stored profile, completed from the defaults. Skills are taken whole, not
 * merged: the defaults are her support-engineering skills, and a person in
 * another field must not inherit them. `feeds` is never filled in: a person
 * gets a feed only from a `feeds` block of their own.
 */
export function withDefaults(p) {
  const base = structuredClone(DEFAULT_PROFILE);
  return {
    ...base,
    ...p,
    skills: p.skills || base.skills,
    locations: { ...base.locations, ...(p.locations || {}) },
    scan: { ...base.scan, ...(p.scan || {}) },
  };
}

/**
 * Title filters from the profile, as regex sources, or her defaults. Another
 * field needs its own: CLEARLY_NOT drops "software engineer", which is exactly
 * what a developer would be looking for.
 */
export function titleFilters(profile) {
  const t = profile.titles || {};
  return {
    relevant: t.relevant ? new RegExp(t.relevant, 'i') : RELEVANT,
    exclude: t.exclude ? new RegExp(t.exclude, 'i') : CLEARLY_NOT,
  };
}

/**
 * eligibleFrom, narrowed by a profile. Her rule passes any German city, on-site
 * included. `eligibility: "remote-or-home"` keeps only remote postings and
 * ones in a hybridOkCities city, so a Berlin office job stops counting for
 * someone who wants Germany-remote or Hamburg hybrid.
 */
export function eligibleFor(location, remote, germanRequired, profile) {
  if (!eligibleFrom(location, remote, germanRequired)) return false;
  if (profile.eligibility !== 'remote-or-home') return true;
  const loc = String(location || '').toLowerCase();
  const home = (profile.locations?.hybridOkCities || []).some((c) => loc.includes(c));
  return home || remote === true || /\bremote\b/.test(loc);
}

/**
 * scoreJob, with one switch for engineers. codeExpectation() docks up to ten
 * points from a posting that wants production code, which is the right
 * warning for her support-family search and exactly backwards for a software
 * engineer. The jobfit code stays as copied from the skill; the switch lives
 * here, set by `codePenalty: false` in a profile.
 */
export function scoreFor(job, profile) {
  const s = scoreJob(job, profile);
  if (profile.codePenalty !== false || !s.breakdown.code) return s;
  return {
    ...s,
    total: Math.min(100, s.total - s.breakdown.code),
    breakdown: { ...s.breakdown, code: 0 },
    notes: { ...s.notes, code: '' },
  };
}

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const MAX_STORED_CHARS = 60000;

/**
 * Keeps the full posting text of every relevant role in job_descriptions, apart
 * from jobs, because /jobs selects * over 400 rows. Aggregator listings are
 * resolved to the employer's own posting when they link to Greenhouse or Ashby
 * (at most `maxResolve` lookups a run), otherwise kept as the thin summary they
 * are, which the drafting worker skips. A feed that carries full text keeps it
 * as kind `aggregator`.
 *
 * Returns counts only.
 */
export async function storeDescriptions(db, rows, fullById, { resolve = resolveFull, wait = sleep, maxResolve = 10 } = {}) {
  const have = new Map(
    (await db.selectAll('job_descriptions', '?select=job_id,sha,kind&order=job_id.asc')).map((d) => [d.job_id, d])
  );
  const out = [];
  const counts = { stored: 0, resolved: 0, summary: 0 };
  let lookups = 0;
  for (const r of rows) {
    const entry = fullById.get(r.id);
    if (!entry) continue;
    const prev = have.get(r.id);
    let text = entry.text || null;
    let kind = entry.kind && entry.kind !== 'summary' ? entry.kind : 'board';
    if (!text) {
      if (prev?.kind === 'resolved') continue;
      kind = 'summary';
      text = entry.summary || null;
      if (lookups < maxResolve && r.url) {
        if (lookups > 0) await wait(500);
        lookups++;
        const full = await resolve(r.url);
        if (full) { text = full; kind = 'resolved'; }
      }
    }
    if (!text) continue;
    text = text.slice(0, MAX_STORED_CHARS);
    const sha = sha256(text);
    if (prev && prev.sha === sha && prev.kind === kind) continue;
    out.push({ job_id: r.id, description: text, kind, sha, fetched_at: new Date().toISOString() });
    counts.stored++;
    if (kind === 'resolved') counts.resolved++;
    if (kind === 'summary') counts.summary++;
  }
  if (out.length) await db.upsert('job_descriptions', out, { onConflict: 'owner,job_id' });
  return counts;
}

const APPLIED = ['applied', 'shortlisted', 'interview', 'rejected'];
const FEED_PREFIXES = FEEDS.map((f) => f.idPrefix);
const isFeedId = (id) => FEED_PREFIXES.some((p) => String(id).startsWith(`${p}:`));
/** Job title as a URL slug: lowercase, trimmed, non-alphanumerics to hyphens. */
export const slugifyTitle = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The employer's own page for a posting, from the company's template. Display
 * only, never fetched: a wrong slug lands on the employer's generic careers page.
 * Needs an https template with {slug}; anything else gives null.
 */
export function careersUrlFor(template, title) {
  if (typeof template !== 'string' || !template.startsWith('https://') || !template.includes('{slug}')) return null;
  const slug = slugifyTitle(title);
  if (!slug) return null;
  try { return new URL(template.split('{slug}').join(slug)).href; } catch { return null; }
}

export const coTitleKey = (companyName, title) => `${core(companyName)}|${normTitle(title)}`;

/**
 * One posting to one stored row, or a reason to skip it. Pure.
 *
 * ctx   { profile, relevant, exclude, min, now }
 * input { id, source, company {slug,name}, posting, prev, twin, drafted, appliedKeys, firstRun, label }
 *   prev   the stored row with this id, if any
 *   twin   a stored feed row for the same posting under another id
 *
 * Backlog rows are stored and visible ("Already open") but never notify and
 * never draft: that is what keeps a newly read board from announcing weeks of
 * old roles as news.
 */
export function decideRow(ctx, { id, source, company, posting: p, prev, twin, drafted, appliedKeys, firstRun = false, label = '' }) {
  const title = String(p.title || '').trim();
  if (!title || !ctx.relevant.test(title) || ctx.exclude.test(title)) return { skip: 'filter' };
  const scored = scoreFor({ title, company: company.name, location: p.location, description: p.description }, ctx.profile);
  const germanRequired = !!p.germanFlag || scored.germanRequired;
  const remote = p.remote !== undefined ? p.remote : scored.remote;
  const eligible = eligibleFor(p.location, remote, germanRequired, ctx.profile) && !otherRegionTitle(title);
  const isNew = !prev;
  // Most relevant titles on a big board are other countries. Keep what a view can show.
  if (isNew && !eligible && !germanRequired) return { skip: 'ineligible' };

  let backlog = false;
  let notified = false;
  let superseded = null;
  let status = prev?.status ?? 'found';
  let notes = prev?.notes ?? null;
  const applied_at = prev?.applied_at ?? null;
  if (prev) backlog = !!prev.backlog;
  else {
    if (twin) {
      // She acted on the aggregator row: no second copy.
      if (!['found', 'saved'].includes(twin.status)) return { skip: 'acted' };
      superseded = twin.id;
      status = twin.status;
      notes = twin.notes ?? null;
      // A finished draft exists, or the twin was already set aside: do not draft or announce twice.
      backlog = !!twin.backlog || !!drafted?.has(twin.id);
      notified = true;
    }
    if (appliedKeys?.has(`${company.slug}|${normTitle(title)}`)) backlog = true; // applied via LinkedIn export
    if (isStaffing(company.name)) backlog = true;
    if (firstRun && !isRecent(p.postedAt, ctx.now)) backlog = true;
  }

  const row = {
    id,
    source,
    company_slug: company.slug,
    company: company.name,
    title,
    url: p.url,
    // Display link to the employer's own page. A hand-set value survives when the company has no template.
    careers_url: careersUrlFor(company.careers_url_template, title) ?? prev?.careers_url ?? null,
    location: p.location || null,
    workplace_type: p.remote !== undefined ? (p.remote ? 'Remote' : null) : /remote/i.test(p.location || '') ? 'Remote' : null,
    posted_date: p.postedAt ? p.postedAt.slice(0, 10) : null,
    excerpt: (p.description || '').slice(0, 400) || null,
    score: scored.total,
    score_breakdown: scored.breakdown,
    score_notes: {
      ...scored.notes,
      language: p.languageNote ? `${p.languageNote}${germanRequired ? ' (GERMAN REQUIRED)' : ''}` : scored.notes.language,
      ghost: p.ghostScore != null ? `${label} ghost score ${p.ghostScore}` : undefined,
    },
    german_required: germanRequired,
    remote: remote ?? null,
    eligible,
    closed: false,
    last_seen_at: new Date(ctx.now).toISOString(),
    backlog,
    status,
    applied_at,
    notes,
    // Never add first_seen_at here: rows are squared off for the batch upsert, and
    // a null for the others would break it. The column default sets it.
  };
  const fresh = isNew && eligible && !backlog && !notified && scored.total >= ctx.min;
  return { row, fresh, superseded, isNew, backlog, eligible, notified };
}

/** Everything one owner's poll needs to remember between boards and feeds. */
export function newState(ctx, known, drafted) {
  const byId = new Map();
  const byUrl = new Map();
  const byCo = new Map();
  const appliedKeys = new Set();
  for (const k of known) {
    byId.set(k.id, k);
    const u = urlKeyOf(k.url);
    if (u) byUrl.set(u, k);
    byCo.set(coTitleKey(k.company, k.title), k);
    if (APPLIED.includes(k.status)) appliedKeys.add(`${k.company_slug}|${normTitle(k.title)}`);
  }
  return {
    ctx, known, drafted, byId, byUrl, byCo, appliedKeys,
    boardKeys: new Set(), // url and company+title of every board posting read this run
    rows: [], fresh: [], fullById: new Map(), superseded: [], newCompanies: new Map(),
    counts: { skippedIneligible: 0, backlogNew: 0 },
  };
}

/** One board's postings into rows. Exported so the decisions can be tested without a database. */
export function processBoard(st, c, postings) {
  let kept = 0;
  const firstRun = !c.board_baselined_at;
  for (const p of postings) {
    const title = String(p.title || '').trim();
    if (!st.ctx.relevant.test(title) || st.ctx.exclude.test(title)) continue;
    const u = urlKeyOf(p.url);
    const co = coTitleKey(c.name, title);
    st.boardKeys.add(`u:${u}`);
    st.boardKeys.add(`c:${co}`);
    const id = `${c.board_kind}:${c.board_token}:${p.nativeId}`;
    const twinRow = (u && st.byUrl.get(u)) || st.byCo.get(co);
    const twin = twinRow && twinRow.id !== id && isFeedId(twinRow.id) ? twinRow : null;
    const d = decideRow(st.ctx, {
      id, source: c.board_kind, company: { slug: c.slug, name: c.name, careers_url_template: c.careers_url_template }, posting: p,
      prev: st.byId.get(id), twin, drafted: st.drafted, appliedKeys: st.appliedKeys, firstRun,
    });
    if (d.skip) { if (d.skip === 'ineligible') st.counts.skippedIneligible++; continue; }
    st.rows.push(d.row);
    st.fullById.set(id, { text: p.fullText || null });
    if (d.superseded) st.superseded.push(d.superseded);
    if (d.isNew && d.eligible && d.backlog && !d.notified) st.counts.backlogNew++;
    if (d.fresh) st.fresh.push(d.row);
    kept++;
  }
  return kept;
}

const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
const NEW_COMPANIES_PER_FEED = 20;

/**
 * A feed's listings into rows. The employer's own board is the reference: a
 * listing it already covers is dropped, eligible or not. Counts by reason.
 *
 * st.haveSlugs is the set of company slugs the owner already has.
 */
export function ingestFeed(feed, listings, st, { firstRun = false } = {}) {
  const counts = { listed: listings.length, relevant: 0, board: 0, known: 0, copy: 0, kept: 0, newCompanies: 0 };
  const sameFeedKeys = new Set();
  const made = [];
  for (const l of listings) {
    const title = String(l.title || '').trim();
    if (!st.ctx.relevant.test(title) || st.ctx.exclude.test(title)) continue;
    counts.relevant++;
    const slug = slugOf(l.company?.slug || l.company?.name);
    if (!slug) continue;
    const name = l.company?.name || slug;
    const id = `${feed.idPrefix}:${l.nativeId}`;
    const u = urlKeyOf(l.url);
    const co = coTitleKey(name, title);
    const own = st.byId.has(id); // a listing's own stored id is never dropped
    if (!own) {
      if (st.boardKeys.has(`u:${u}`) && u || st.boardKeys.has(`c:${co}`)) { counts.board++; continue; }
      if ((u && st.byUrl.has(u)) || st.byCo.has(co)) { counts.known++; continue; }
      if (sameFeedKeys.has(co) || (u && sameFeedKeys.has(`u:${u}`))) { counts.copy++; continue; }
    }
    sameFeedKeys.add(co);
    if (u) sameFeedKeys.add(`u:${u}`);

    if (!st.haveSlugs.has(slug)) {
      if (!st.newCompanies.has(slug)) {
        if (counts.newCompanies >= NEW_COMPANIES_PER_FEED) continue;
        counts.newCompanies++;
        const staffing = isStaffing(name);
        const host = l.company?.homepage ? l.company.homepage.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
        st.newCompanies.set(slug, {
          slug, name, origin: 'aggregator', next_probe_at: null,
          domain: host, domain_source: host ? 'aggregator' : null,
          board_block: staffing ? 'staffing' : null,
        });
      }
    }
    // A listing never sets board_kind or board_token: slug probing and classify decide that.
    const d = decideRow(st.ctx, {
      id, source: feed.id, company: { slug, name }, posting: l, prev: st.byId.get(id), twin: null,
      drafted: st.drafted, appliedKeys: st.appliedKeys, firstRun, label: feed.label,
    });
    if (d.skip) { if (d.skip === 'ineligible') st.counts.skippedIneligible++; continue; }
    made.push({ d, entry: { text: l.fullText || null, summary: l.description, kind: feed.textKind } });
  }
  if (firstRun) {
    // A first read of a whole feed must not fill a day's notifications.
    const fresh = made.filter((m) => m.d.fresh).sort((a, b) => b.d.row.score - a.d.row.score);
    for (const m of fresh.slice(FEED_FIRST_RUN_MAX_FRESH)) {
      m.d.row.backlog = true;
      m.d.fresh = false;
      m.d.backlog = true;
    }
  }
  for (const { d, entry } of made) {
    st.rows.push(d.row);
    st.fullById.set(d.row.id, entry);
    if (d.fresh) st.fresh.push(d.row);
    if (d.isNew && d.eligible && d.backlog && !d.notified) st.counts.backlogNew++;
    counts.kept++;
  }
  return counts;
}

/** The profile one person is polled with, or null when they have none yet. */
export async function loadOwnerProfile(db, o) {
  if (o.primary) return loadProfile();
  const [row] = await db.select('settings', '?select=value&key=eq.jobfit_profile');
  return row?.value ? withDefaults(row.value) : null;
}

async function main() {
  const args = parseArgs();
  let list = await owners();
  if (args.owner) list = list.filter((o) => o.id === args.owner || o.label === args.owner);
  let failed = 0;
  for (const o of list) {
    const db = forOwner(o.id);
    const profile = await loadOwnerProfile(db, o);
    if (!profile) {
      console.log(`\n${who(o)}: no jobfit_profile in settings, skipped`);
      continue;
    }
    console.log(`\n== ${who(o)}`);
    // One person's failure must not cost the other their morning's jobs.
    try {
      await runFor(db, profile, o.primary, args);
    } catch (e) {
      failed++;
      console.error(`  ${who(o)}: ${isLocal() ? e.message : safeCode(e)}`);
    }
  }
  if (failed) throw new Error(`${failed} owner(s) failed`);
}

async function runFor(db, profile, primary, args) {
  const min = Number(args.min || 70);
  const { relevant, exclude } = titleFilters(profile);
  let finish = async () => {};
  if (!args['dry-run']) finish = await db.startRun('jobs');
  try {
    await pollFor(db, profile, primary, args, min, relevant, exclude, finish);
  } catch (e) {
    await finish(false, null, e.message); // database only, per person
    throw e;
  }
}

const BOARD_ID = new RegExp(`^(${Object.keys(BOARDS).join('|')}):`);

async function pollFor(db, profile, primary, args, min, relevant, exclude, finish) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ctx = { profile, relevant, exclude, min, now };

  let companies = await db.selectAll(
    'companies',
    '?select=slug,name,careers_url_template,board_kind,board_token,board_baselined_at,board_fail_count&board_token=not.is.null&board_kind=not.is.null&board_block=is.null' +
      (args['only-new-boards'] ? '&board_baselined_at=is.null' : '') +
      '&order=slug.asc'
  );
  if (args.company) companies = companies.filter((c) => c.slug === args.company);
  const feedsOn = !args.company && !args['only-new-boards'];
  const activeFeeds = feedsOn ? FEEDS.map((f) => [f, f.config(profile, primary)]).filter(([, cfg]) => cfg) : [];
  if (!companies.length && !activeFeeds.length) {
    detail('no companies have a job board configured');
    await finish(true, { polled: 0 });
    return;
  }

  // One read of everything known, in pages: a plain select stops at 1000 rows,
  // and a row missing here would have its status reset to found.
  const known = await db.selectAll(
    'jobs',
    '?select=id,url,company_slug,company,title,status,applied_at,notes,backlog,source,closed,last_seen_at,careers_url&order=id.asc'
  );
  const drafted = primary
    ? new Set((await db.select('resume_drafts', '?select=job_id&status=in.(draft,approved)')).map((d) => d.job_id))
    : new Set();
  const st = newState(ctx, known, drafted);
  st.haveSlugs = new Set((await db.selectAll('companies', '?select=slug&order=slug.asc')).map((c) => c.slug));
  const status = {};

  // Boards first, always: their postings are the reference for every feed.
  const fetchable = companies.filter((c) => BOARDS[c.board_kind]);
  const fetched = await byHost(fetchable, (c) => hostKey(c.board_kind, c.board_token), (c) => fetchBoard(c.board_kind, c.board_token), {
    gapOf: (host) => gapMs(host),
  });
  let answered = 0;
  let failedBoards = 0;
  const firstPolled = [];
  for (const [c, res] of fetched) {
    if (res.error) {
      failedBoards++;
      // The message names the board's URL; it goes to the database (per person, protected), never the Actions log.
      status[c.slug] = `failed: ${String(res.error.message || res.error.code || 'error').slice(0, 80)}`;
      detailWarn(`  ${c.slug}: ${res.error.message}`);
      continue;
    }
    answered++;
    const postings = res.value;
    status[c.slug] = postings.length;
    if (!c.board_baselined_at) firstPolled.push(c);
    const kept = processBoard(st, c, postings);
    detail(`  ${c.slug.padEnd(18)} ${String(postings.length).padStart(4)} posting(s), ${kept} relevant`);
  }

  // Feeds. One failing never stops another or the boards, and a failed feed's rows are untouched.
  const [stateRow] = activeFeeds.length ? await db.select('settings', '?select=value&key=eq.feed_state') : [];
  const feedState = { ...(stateRow?.value || {}) };
  const feedsFirst = [];
  const feedAnswered = [];
  for (const [feed, cfg] of activeFeeds) {
    try {
      const listings = await memoFeed(feed, cfg);
      const firstRun = !feedState[feed.id]?.baselined_at && !known.some((k) => k.source === feed.id);
      const counts = ingestFeed(feed, listings, st, { firstRun });
      status[`feed:${feed.id}`] = `${counts.listed} listed, ${counts.kept} kept, ${counts.board} on a board, ${counts.known} known, ${counts.copy} copies`;
      detail(`  ${feed.id.padEnd(18)} ${String(counts.listed).padStart(4)} listing(s), ${counts.relevant} relevant, ${counts.kept} kept, ${counts.board} on an employer board`);
      feedAnswered.push(feed);
      if (firstRun) feedsFirst.push(feed);
    } catch (e) {
      status[`feed:${feed.id}`] = `failed: ${String(e.message || 'error').slice(0, 80)}`;
      detailWarn(`  ${feed.id}: ${e.message}`);
    }
  }

  const { fullById } = st;
  // One id twice in a batch upsert fails the whole poll with a 500 ("ON CONFLICT
  // DO UPDATE command cannot affect row a second time"). A board or feed can list
  // the same posting twice; after the sort the first copy is the best scored.
  const uniq = (list) => { const ids = new Set(); return list.filter((r) => !ids.has(r.id) && ids.add(r.id)); };
  const byScore = (a, b) => b.score - a.score;
  const rows = uniq(st.rows.sort(byScore));
  const fresh = uniq(st.fresh.sort(byScore)); // the cap keeps the best, not the first
  if (rows.length < st.rows.length) console.log(`  ${st.rows.length - rows.length} duplicate posting(s) dropped`);

  if (args['dry-run']) {
    console.log(`\n${rows.length} relevant, ${fresh.length} new and eligible at ${min}+, ${st.counts.backlogNew} already open`);
    console.log(`boards: ${answered} answered, ${failedBoards} failed`);
    for (const r of rows.filter((x) => x.eligible).slice(0, 12)) {
      detail(`  ${String(r.score).padStart(3)}  ${r.company.padEnd(14)} ${r.title.slice(0, 48).padEnd(50)} ${(r.location || '').slice(0, 26)}${r.backlog ? '  (already open)' : ''}`);
    }
    return;
  }

  // Companies first, or the jobs insert fails its foreign key. Only slugs the
  // console has never seen are written, so nothing existing is overwritten.
  const missing = [...st.newCompanies.values()].filter((c) => !st.haveSlugs.has(c.slug));
  if (missing.length) await db.upsert('companies', missing, { onConflict: 'owner,slug' });

  // Every row carries an explicit status and backlog (decideRow): the batch
  // upsert gives all rows the same key set, so a new posting beside preserved
  // rows would otherwise be sent with null, and an explicit null beats the
  // column default.
  await db.upsert('jobs', rows, { onConflict: 'owner,id' });

  // A board posting that disappeared is closed, not deleted: she may have applied.
  // Only when its board actually answered this run: a Datadog timeout once
  // closed all 25 of its open roles, because "not seen" was read as "gone".
  // A failed, timed out or paused board has a string status, so it closes nothing.
  const seen = new Set(rows.map((r) => r.id));
  const answeredSlugs = new Set(Object.entries(status).filter(([k, v]) => typeof v === 'number' && !k.startsWith('feed:')).map(([k]) => k));
  const stale = known
    .filter((k) => BOARD_ID.test(k.id) && !k.closed && !seen.has(k.id) && answeredSlugs.has(k.company_slug))
    .map((k) => ({ id: k.id, closed: true }));
  const staleIds = new Set(stale.map((s) => s.id));
  for (const id of st.superseded) if (!staleIds.has(id)) { stale.push({ id, closed: true }); staleIds.add(id); }
  // A feed's own rows close after staleDays unseen, and only when that feed answered this run.
  for (const feed of feedAnswered) {
    if (!feed.staleDays) continue;
    const cutoff = now - feed.staleDays * 86_400_000;
    for (const k of known) {
      if (k.source !== feed.id || k.closed || seen.has(k.id) || staleIds.has(k.id)) continue;
      if (!['found', 'saved'].includes(k.status)) continue;
      if (Date.parse(k.last_seen_at) < cutoff) { stale.push({ id: k.id, closed: true }); staleIds.add(k.id); }
    }
  }
  if (stale.length) await db.updateEach('jobs', 'id', stale);

  // Failure streaks: counted on change only. At 14 the company asks to be probed again,
  // since the board may have moved.
  const streaks = [];
  for (const [c, res] of fetched) {
    const n = c.board_fail_count || 0;
    if (res.error && !['host_paused'].includes(res.error.code)) {
      streaks.push({ slug: c.slug, board_fail_count: n + 1, ...(n + 1 === 14 ? { next_probe_at: nowIso } : {}) });
    } else if (!res.error && n > 0) streaks.push({ slug: c.slug, board_fail_count: 0 });
  }
  if (streaks.length) await db.updateEach('companies', 'slug', streaks);

  // Boards read for the first time are protected from now on.
  if (firstPolled.length) await db.updateEach('companies', 'slug', firstPolled.map((c) => ({ slug: c.slug, board_baselined_at: nowIso })));
  if (feedAnswered.length) {
    for (const f of feedAnswered) feedState[f.id] = { baselined_at: feedState[f.id]?.baselined_at || nowIso };
    await db.upsert('settings', [{ key: 'feed_state', value: feedState, updated_at: nowIso }], { onConflict: 'owner,key' });
  }

  // Full posting text for the resume drafts: hers only, and never allowed to fail the poll.
  if (primary) {
    try {
      status.descriptions = await storeDescriptions(db, rows.filter((r) => r.eligible && r.score >= min), fullById);
    } catch (e) {
      // db errors carry the failing row; print the status only.
      const code = /-> (\d{3})/.exec(e.message)?.[1] || 'error';
      status.descriptions = `failed: ${code}`;
      console.warn(`  descriptions: store failed (${code})`);
    }
  }

  if (fresh.length) {
    await db.upsert(
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
      { onConflict: 'owner,dedupe_key' }
    );
  }
  const sources = firstPolled.length + feedsFirst.length;
  if (sources) {
    const n = st.counts.backlogNew;
    await db.upsert(
      'notifications',
      [{
        kind: 'boards_added',
        severity: 'news',
        title: `${sources} new job source${sources === 1 ? '' : 's'} added`,
        body: `${n} role${n === 1 ? '' : 's'} there were already open, so they did not ping you.`,
        url: n ? '/jobs?view=backlog' : '/jobs',
        entity_ref: 'boards',
        dedupe_key: `boards_added:${nowIso.slice(0, 10)}`,
      }],
      { onConflict: 'owner,dedupe_key' }
    );
  }

  console.log(`boards: ${answered} answered, ${failedBoards} failed`);
  console.log(`${rows.length} relevant role(s), ${fresh.length} new above ${min}, ${stale.length} closed, ${st.counts.backlogNew} already open`);
  await finish(true, {
    relevant: rows.length, new: fresh.length, closed: stale.length, backlog: st.counts.backlogNew,
    skipped_ineligible: st.counts.skippedIneligible, boards: status,
  });
}

// Run only when invoked directly. scripts/rescore-linkedin.mjs imports
// eligibleFrom from here, and importing must not start a board poll. Compared
// through pathToFileURL because on Windows import.meta.url is file:///C:/...
// while argv[1] is a bare path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => setTimeout(() => process.exit(0), 200))
    .catch((e) => {
      console.error(isLocal() ? e.message : safeCode(e));
      setTimeout(() => process.exit(1), 200);
    });
}
