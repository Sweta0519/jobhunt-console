#!/usr/bin/env node
// Finds the job board of every company in the console, a hundred a day until
// the list is covered, then each company once a month.
//
//   node workers/boards.mjs [--limit 100] [--owner <label|uuid>] [--requested-only] [--dry-run]
//
// Node built-ins only, so the workflow needs no npm install.
//
// This repository and its Actions logs are public. In Actions this prints
// counts only: no company, token, URL or owner label, ever (lib/publiclog.mjs).
// A board is enabled only when its name AND a domain or an employer URL agree
// (lib/boards/classify.mjs). Everything else goes to her for review, or is
// parked when it has no relevant title.

import { pathToFileURL } from 'node:url';
import { owners, forOwner, parseArgs } from './lib/db.mjs';
import { loadOwnerProfile, titleFilters } from './jobs.mjs';
import { fetchProbe, leverName } from './lib/boards/fetch.mjs';
import { classify, tokensFor, core } from './lib/boards/classify.mjs';
import { checkCareers } from './lib/boards/careers.mjs';
import { isStaffing } from './lib/boards/noise.mjs';
import { parseBoardUrl, hostKey, gapMs, validHost } from './lib/boards/hosts.mjs';
import { makeGate, makeLimiter } from './lib/boards/pace.mjs';
import { detail, who, isLocal, safeCode } from './lib/publiclog.mjs';

export const PROBE_ORDER = ['ashby', 'greenhouse', 'lever', 'recruitee', 'personio', 'teamtailor', 'workable'];
const DAY = 86_400_000;
const HARVEST_MAX = 20;
const POOL = 4;

export const boardUrl = (kind, token) =>
  ({
    greenhouse: `https://boards.greenhouse.io/${token}`,
    ashby: `https://jobs.ashbyhq.com/${token}`,
    lever: `https://jobs.lever.co/${token}`,
    workable: `https://apply.workable.com/${token}`,
    recruitee: `https://${token}.recruitee.com`,
    personio: `https://${token}.jobs.personio.de`,
    teamtailor: `https://${token}`,
  })[kind] || null;

/**
 * What a verdict becomes. Pure.
 *   confirmed -> confirmed
 *   review    -> review (a relevant title, or a company she marked), else parked
 *   rejected, empty -> nothing stored
 */
export function candidateStatus(verdict, relevant, company) {
  if (verdict === 'confirmed') return 'confirmed';
  if (verdict === 'review') return relevant > 0 || company.is_target || company.priority ? 'review' : 'parked';
  return null;
}

/** Next look: a month out (with jitter, so 465 companies do not land on one day), or a day after a failure. */
export function nextProbeAt(complete, now = Date.now(), rand = Math.random) {
  return new Date(now + (complete ? 30 * DAY + Math.floor(rand() * 3 * DAY) : DAY)).toISOString();
}

/** Who goes first: asked for, then priority, target, discovered, the rest. */
export const probeRank = (c) =>
  c.probe_requested_at ? 0 : c.priority ? 1 : c.is_target ? 2 : c.origin === 'aggregator' || c.origin === 'discovered' ? 3 : 4;

export function pickCompanies(companies, { limit = 100, requestedOnly = false, now = Date.now() } = {}) {
  const due = (c) => !c.next_probe_at || Date.parse(c.next_probe_at) <= now;
  const picked = companies.filter((c) => {
    if (c.board_block) return false;
    if (requestedOnly) return !!c.probe_requested_at;
    const hasBoard = !!c.board_kind && !!c.board_token;
    if (!hasBoard) return !!c.probe_requested_at || due(c);
    return (c.board_fail_count || 0) >= 14 && due(c);
  });
  return picked.sort((a, b) => probeRank(a) - probeRank(b) || String(a.slug).localeCompare(String(b.slug))).slice(0, limit);
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    })
  );
}

async function main() {
  const args = parseArgs();
  let list = await owners();
  if (args.owner) list = list.filter((o) => o.id === args.owner || o.label === args.owner);
  let failed = 0;
  for (const o of list) {
    const db = forOwner(o.id);
    // One person's failure must not cost the other theirs.
    try {
      const profile = await loadOwnerProfile(db, o);
      if (!profile) {
        console.log(`${who(o)}: no jobfit_profile in settings, skipped`);
        continue;
      }
      console.log(`== ${who(o)}`);
      await runFor(db, profile, args);
    } catch (e) {
      failed++;
      console.error(`  ${who(o)}: ${isLocal() ? e.message : safeCode(e)}`);
    }
  }
  if (failed) throw new Error(`${failed} owner(s) failed`);
}

async function runFor(db, profile, args) {
  const dry = !!args['dry-run'];
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 100));
  const { relevant, exclude } = titleFilters(profile);
  const finish = dry ? async () => {} : await db.startRun('boards');
  const sum = { probed: 0, confirmed: 0, review: 0, parked: 0, incomplete: 0, harvested: 0, enabled: 0, careers: 0, ld_seen: 0 };
  try {
    const gate = makeGate();
    const limiter = makeLimiter({ gapOf: (h) => gapMs(h) });
    const call = (kind, token, fn) => limiter(hostKey(kind, token), () => gate.run(hostKey(kind, token), fn));
    const relevantCount = (posts) => posts.filter((p) => relevant.test(String(p.title || '').trim()) && !exclude.test(String(p.title || ''))).length;
    const sampleOf = (posts) => {
      const rel = posts.filter((p) => relevant.test(String(p.title || '').trim()) && !exclude.test(String(p.title || ''))).map((p) => String(p.title).trim());
      return (rel.length ? rel : posts.map((p) => String(p.title || '').trim())).slice(0, 5);
    };

    const companies = await db.selectAll(
      'companies',
      '?select=slug,name,domain,board_kind,board_token,board_block,board_fail_count,is_target,priority,origin,next_probe_at,probe_requested_at,careers_checked_at&order=slug.asc'
    );
    const bySlug = new Map(companies.map((c) => [c.slug, c]));
    const existing = new Map(
      (await db.selectAll('board_candidates', '?select=company_slug,kind,token,status&order=company_slug.asc')).map((r) => [`${r.company_slug}|${r.kind}|${r.token}`, r.status])
    );
    const candidates = new Map(); // rows to write
    let reviewNow = 0;

    // Never overwrite a decision of hers.
    const keep = (key) => ['rejected', 'accepted'].includes(existing.get(key));
    const record = (company, kind, token, probe, verdict, evidence) => {
      const key = `${company.slug}|${kind}|${token}`;
      if (keep(key)) return null;
      const rel = relevantCount(probe.posts);
      const status = candidateStatus(verdict, rel, company);
      if (!status) return null;
      candidates.set(key, {
        company_slug: company.slug, kind, token, status, board_name: probe.name || null, board_url: boardUrl(kind, token),
        postings: probe.posts.length, relevant: rel, sample_titles: sampleOf(probe.posts), evidence,
        last_checked_at: new Date().toISOString(),
      });
      if (status === 'review' && existing.get(key) !== 'review') reviewNow++;
      return { status, key, postings: probe.posts.length };
    };

    // Step 1: harvest. A job URL from an aggregator names its employer's board,
    // which is better evidence than any name match.
    const hasDecided = new Set([...existing.entries()].filter(([, s]) => ['accepted', 'rejected', 'confirmed'].includes(s)).map(([k]) => k.split('|')[0]));
    const jobs = await db.selectAll('jobs', '?select=url,company_slug&source=in.(remoterocketship,himalayas,jobicy)&order=id.asc');
    const seenHarvest = new Set();
    const toFetch = [];
    const unsupported = [];
    for (const j of jobs) {
      const c = bySlug.get(j.company_slug);
      if (!c || (c.board_kind && c.board_token) || c.board_block || hasDecided.has(c.slug)) continue;
      const hit = parseBoardUrl(j.url);
      if (!hit) continue;
      const key = `${c.slug}|${hit.kind}|${hit.token}`;
      if (seenHarvest.has(key) || keep(key)) continue;
      seenHarvest.add(key);
      if (hit.unsupported) unsupported.push({ c, hit });
      else if (toFetch.length < HARVEST_MAX) toFetch.push({ c, hit });
    }
    for (const { c, hit } of unsupported) {
      candidates.set(`${c.slug}|${hit.kind}|${hit.token}`, {
        company_slug: c.slug, kind: hit.kind, token: hit.token, status: 'unsupported', board_name: null, board_url: null,
        postings: 0, relevant: 0, sample_titles: [], evidence: { viaUrl: true }, last_checked_at: new Date().toISOString(),
      });
    }
    const enable = new Map(); // slug -> best confirmed {kind, token, postings}
    const consider = (slug, kind, token, r) => {
      if (r?.status !== 'confirmed') return;
      const cur = enable.get(slug);
      if (!cur || r.postings > cur.postings) enable.set(slug, { kind, token, postings: r.postings });
    };
    await pool(toFetch, POOL, async ({ c, hit }) => {
      try {
        const probe = await call(hit.kind, hit.token, () => fetchProbe(hit.kind, hit.token));
        sum.harvested++;
        if (!probe) return;
        const { verdict, evidence } = classify(c, probe, { viaUrl: true });
        consider(c.slug, hit.kind, hit.token, record(c, hit.kind, hit.token, probe, verdict, evidence));
      } catch { /* the next run looks again */ }
    });

    // Careers fallback. A stored domain is trusted; a guessed <name>.com is used only for
    // companies she marked or that a feed found, and can never confirm a board by itself.
    const careersStep = async (c) => {
      if (c.careers_checked_at && Date.now() - Date.parse(c.careers_checked_at) < 30 * DAY) return;
      const stored = c.domain ? String(c.domain).toLowerCase().replace(/^www\./, '') : null;
      const guessable = c.is_target || c.priority || c.origin === 'aggregator' || c.origin === 'discovered';
      const guess = !stored && guessable ? `${core(c.name).replace(/ /g, '')}.com` : null;
      const domain = stored || guess;
      if (!domain || !validHost(domain)) return;
      const trusted = !!stored;
      let res;
      try {
        res = await checkCareers(domain, { titleOk: (t) => relevant.test(t) && !exclude.test(t) });
      } catch {
        res = { status: 'unreachable', embeds: [], hints: [], ldSeen: 0 };
      }
      sum.careers++;
      sum.ld_seen += res.ldSeen || 0;
      const when = new Date().toISOString();
      for (const e of res.embeds.slice(0, 3)) {
        const key = `${c.slug}|${e.kind}|${e.token}`;
        if (e.unsupported || ['smartrecruiters', 'workday', 'gem'].includes(e.kind)) {
          if (!keep(key)) candidates.set(key, { company_slug: c.slug, kind: e.kind, token: String(e.token).slice(0, 255), status: 'unsupported', board_name: null, board_url: null, postings: 0, relevant: 0, sample_titles: [], evidence: { careers: true, trustedDomain: trusted }, last_checked_at: when });
          continue;
        }
        try {
          const probe = await call(e.kind, e.token, () => fetchProbe(e.kind, e.token));
          if (!probe) continue; // a linked token must answer with postings
          let { verdict, evidence } = classify({ name: c.name, domain: stored }, probe, { viaUrl: trusted });
          if (!trusted && verdict === 'confirmed') verdict = 'review'; // a guessed domain proves nothing
          consider(c.slug, e.kind, e.token, record(c, e.kind, e.token, probe, verdict, { ...evidence, careers: true, trustedDomain: trusted }));
        } catch { /* looked at again next month */ }
      }
      if (res.status === 'moved' || res.hints.length || (res.status === 'shell' && (c.is_target || c.priority))) {
        const hint = res.hints[0];
        const token = hint ? new URL(hint.url).pathname.slice(0, 255) || '/' : '/';
        const key = `${c.slug}|careers|${token}`;
        if (!keep(key)) {
          candidates.set(key, { company_slug: c.slug, kind: 'careers', token, status: 'hint', board_name: null, board_url: hint?.url || `https://${domain}/`, postings: 0, relevant: res.hints.length, sample_titles: res.hints.map((h) => h.title).slice(0, 5), evidence: { status: res.status, moved: res.moved || null, trustedDomain: trusted }, last_checked_at: when });
        }
      }
      patch(c.slug, { careers_checked_at: when, careers_status: res.status });
    };

    // Steps 3 and 4: pick, then probe.
    const picked = pickCompanies(companies, { limit, requestedOnly: !!args['requested-only'] });
    const patches = new Map();
    const patch = (slug, fields) => patches.set(slug, { ...(patches.get(slug) || {}), ...fields });
    await pool(picked, POOL, async (c) => {
      if (isStaffing(c.name)) { patch(c.slug, { board_block: 'staffing', probe_requested_at: null }); return; }
      if (enable.has(c.slug)) { patch(c.slug, { probe_requested_at: null, next_probe_at: nextProbeAt(true) }); return; }
      sum.probed++;
      let incomplete = false;
      let done = false;
      const name = core(c.name);
      for (const kind of PROBE_ORDER) {
        if (done) break;
        for (const slug of tokensFor(c.name)) {
          const token = kind === 'teamtailor' ? `${slug}.teamtailor.com` : slug;
          try {
            const probe = await call(kind, token, () => fetchProbe(kind, token));
            if (!probe) continue;
            if (kind === 'lever' && !probe.name) probe.name = await call(kind, token, () => leverName(slug));
            const { verdict, evidence } = classify(c, probe);
            const r = record(c, kind, token, probe, verdict, evidence);
            consider(c.slug, kind, token, r);
            if (r?.status === 'confirmed') { done = true; break; }
          } catch (e) {
            if (e?.code === 'bad_token') continue;
            incomplete = true;
          }
        }
      }
      // Last resort: the company's own careers pages, once a month.
      if (!done && !incomplete) await careersStep(c);
      if (incomplete) sum.incomplete++;
      detail(`  probed ${name || c.slug}: ${enable.has(c.slug) ? 'board found' : 'none'}${incomplete ? ' (incomplete)' : ''}`);
      patch(c.slug, { probe_requested_at: null, next_probe_at: nextProbeAt(!incomplete) });
    });

    // Step 5: enable the confirmed board with the most postings. board_baselined_at
    // stays null, so the first poll protects against old roles; rows of a moved
    // board close when the company next answers.
    const nowIso = new Date().toISOString();
    for (const [slug, b] of enable) {
      const c = bySlug.get(slug);
      if (c.board_kind && c.board_token && c.board_kind === b.kind && c.board_token === b.token) continue;
      patch(slug, { board_kind: b.kind, board_token: b.token, board_added_at: nowIso, board_baselined_at: null, board_fail_count: 0 });
      sum.enabled++;
    }
    const rows = [...candidates.values()];
    sum.confirmed = rows.filter((r) => r.status === 'confirmed').length;
    sum.review = rows.filter((r) => r.status === 'review').length;
    sum.parked = rows.filter((r) => r.status === 'parked').length;

    if (!dry) {
      if (rows.length) await db.upsert('board_candidates', rows, { onConflict: 'owner,company_slug,kind,token' });
      const list = [...patches.entries()].map(([slug, fields]) => ({ slug, ...fields }));
      if (list.length) await db.updateEach('companies', 'slug', list);
      // Step 7: one digest, only when something new needs her.
      if (reviewNow > 0) {
        const n = reviewNow;
        await db.upsert(
          'notifications',
          [{
            kind: 'boards_review', severity: 'action',
            title: `${n} job board${n === 1 ? '' : 's'} need a look`,
            body: 'Tell the console whether each one is the right company.',
            url: '/companies/boards', entity_ref: 'boards', dedupe_key: `boards_review:${nowIso.slice(0, 10)}`,
          }],
          { onConflict: 'owner,dedupe_key' }
        );
      }
    }
    console.log(`probed ${sum.probed}, confirmed ${sum.confirmed}, review ${sum.review}, parked ${sum.parked}, incomplete ${sum.incomplete}, harvested ${sum.harvested}`);
    await finish(true, sum);
  } catch (e) {
    await finish(false, null, safeCode(e)).catch(() => {});
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => setTimeout(() => process.exit(0), 200))
    .catch((e) => {
      console.error(isLocal() ? e.message : safeCode(e));
      setTimeout(() => process.exit(1), 200);
    });
}
