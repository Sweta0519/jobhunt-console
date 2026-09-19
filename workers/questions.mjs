#!/usr/bin/env node
// Refreshes the community-question list and writes it to Supabase.
//
//   node workers/questions.mjs [--days 7] [--source discourse] [--dry-run]
//
// Runs daily on a GitHub Actions schedule, so the list is fresh every morning
// whether or not her laptop is on. Ported from the visibility skill; the
// ranking is the same pure function, so results match what she is used to.

import { upsert, select, patch, startRun, parseArgs } from './lib/db.mjs';
import { rankItem } from './lib/rank.mjs';
import { SOURCES, COMPANY_WEIGHT, githubToken, sleep } from './lib/sources.mjs';
import { fetchDiscourse } from './lib/sources/discourse.mjs';
import { fetchStackOverflow } from './lib/sources/stackexchange.mjs';
import { fetchIssues } from './lib/sources/github-issues.mjs';
import { fetchDiscussions } from './lib/sources/github-discussions.mjs';

const RETENTION_DAYS = 14;

/** Shape a fetched item into a `jobhunt.questions` row. */
function toRow(item, cfg) {
  const { rank, why } = rankItem(item, cfg);
  const company = item.company && item.company !== 'general' ? item.company : null;
  return {
    id: item.id,
    source: item.source,
    site: item.site || null,
    company,
    company_slug: company,
    title: item.title || '(untitled)',
    url: item.url,
    excerpt: (item.excerpt || '').slice(0, 400) || null,
    author: item.author || null,
    asked_at: item.createdAt || null,
    score: Number.isFinite(item.score) ? item.score : 0,
    comments: Number.isFinite(item.comments) ? item.comments : 0,
    has_answer: !!item.hasAnswer,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags : null,
    rank,
    why,
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs();
  const days = Number(args.days || 7);
  const only = typeof args.source === 'string' ? args.source : null;
  const since = new Date(Date.now() - days * 86_400_000);
  const cfg = { companies: Object.fromEntries(Object.entries(COMPANY_WEIGHT).map(([k, v]) => [k, { weight: v }])) };
  const token = githubToken();

  const finish = args['dry-run'] ? async () => {} : await startRun('questions');
  const status = {};
  const items = [];

  const run = async (name, fn) => {
    if (only && only !== name) return;
    try {
      const got = await fn();
      items.push(...got);
      status[name] = { ok: true, count: got.length };
      console.log(`${name}: ${got.length} item(s)`);
    } catch (e) {
      status[name] = { ok: false, error: String(e.message).slice(0, 300) };
      console.warn(`${name} FAILED: ${e.message}`);
    }
  };

  await run('discourse', async () => {
    const out = [];
    for (const entry of SOURCES.discourse) {
      const { items: got } = await fetchDiscourse(entry, { since });
      out.push(...got);
    }
    return out;
  });

  await run('stackoverflow', async () => {
    const out = [];
    const sinceUnix = Math.floor(since.getTime() / 1000);
    for (const entry of SOURCES.stackoverflow) {
      const { items: got, backoff } = await fetchStackOverflow(entry, { sinceUnix });
      out.push(...got);
      // The Stack Exchange API asks for this explicitly; ignoring it gets you blocked.
      if (backoff) await sleep(backoff * 1000);
      await sleep(300);
    }
    return out;
  });

  await run('gh-issue', async () => {
    const out = [];
    const sinceDate = since.toISOString().slice(0, 10);
    for (const entry of SOURCES.ghIssues) {
      out.push(...(await fetchIssues(token, entry, { sinceDate })));
      await sleep(2500); // 30 searches/minute with a token
    }
    return out;
  });

  await run('gh-discussion', async () => {
    const out = [];
    for (const entry of SOURCES.ghDiscussions) {
      const { items: got } = await fetchDiscussions(token, entry, { since });
      out.push(...got);
    }
    return out;
  });

  const rows = items.map((i) => toRow(i, cfg));
  const okSources = Object.values(status).filter((s) => s.ok).length;

  if (args['dry-run']) {
    rows.sort((a, b) => b.rank - a.rank);
    console.log(`\ntop 10 of ${rows.length}:`);
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${String(r.rank).padStart(3)}  ${r.site}  ${r.title.slice(0, 70)}`);
    }
    return;
  }

  if (okSources === 0) {
    await finish(false, status, 'every source failed');
    process.exitCode = 3;
    return;
  }

  // Upsert never clears a status she set: the update list below omits `status`,
  // `answered_at`, `answer_url`, `note` and `starred` entirely.
  await upsert('questions', rows);

  // Retire anything stale. Answered rows stay forever: they are her record.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await patch(
    'questions',
    `?status=eq.new&first_seen_at=lt.${encodeURIComponent(cutoff)}`,
    { status: 'skipped', note: 'aged out', updated_at: new Date().toISOString() }
  );

  const open = await select('questions', '?status=eq.new&select=id');
  const summary = { fetched: rows.length, open: open?.length ?? 0, sources: status };
  await finish(true, summary);
  console.log(`\nwrote ${rows.length} row(s); ${summary.open} open; ${okSources}/4 sources ok`);
}

main().catch(async (e) => {
  console.error(e.message);
  process.exit(1);
});
