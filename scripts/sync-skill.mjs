// Refresh the linkedin-content skill's local posts.json from the console.
//
//   node scripts/sync-skill.mjs [--dry-run]
//
// Since 20 Sep the console (jobhunt.posts in Supabase) is the source of truth
// for posts: drafts are written there, approved there, and published from
// there by the cloud worker. The skill's ~/.linkedin-content/posts.json is
// only a local copy, used by status.mjs, validate.mjs and render.mjs --sample.
// It went stale within a day and showed different posts under the same ids.
//
// This is one-way, cloud to local. It never writes to Supabase. The old
// import path (scripts/import.mjs) would push the stale copy back up and
// overwrite live posts, so do not run that for posts any more.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { select, parseArgs } from '../workers/lib/db.mjs';

const args = parseArgs();
const FILE = join(homedir(), '.linkedin-content', 'posts.json');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const rows = await select(
  'posts',
  '?select=id,post_date,format,pillar,title,size,card,slides,caption,alt_text,sources,status,published_urn,published_url,published_at,created_at,last_error&order=post_date.asc'
);

const local = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { items: [] };
const localById = new Map((local.items || []).map((p) => [p.id, p]));

const items = rows.map((r) => {
  const prev = localById.get(r.id) || {};
  const d = r.post_date ? new Date(r.post_date + 'T12:00:00Z') : null;
  return {
    ...prev, // keep local-only fields such as renderedFiles and renderHash
    id: r.id,
    format: r.format,
    pillar: r.pillar,
    title: r.title,
    size: r.size || undefined,
    card: r.card || undefined,
    slides: r.slides || undefined,
    caption: r.caption,
    sources: r.sources || [],
    altText: r.alt_text || '',
    date: r.post_date,
    weekday: d ? DAYS[d.getUTCDay()] : undefined,
    // The console's states map onto the skill's: rendered means approved and
    // already rendered by the cloud worker.
    status: r.status === 'rendered' ? 'approved' : r.status,
    createdAt: r.created_at,
    publishedUrn: r.published_urn || undefined,
    publishedUrl: r.published_url || undefined,
    publishedAt: r.published_at || undefined,
    lastError: r.last_error || undefined,
    syncedFromConsoleAt: new Date().toISOString(),
  };
});

const out = { ...local, items, source: 'jobhunt-console', syncedAt: new Date().toISOString() };
const changed = items.filter((i) => JSON.stringify(localById.get(i.id)?.caption) !== JSON.stringify(i.caption) || localById.get(i.id)?.status !== i.status);
console.log(`${rows.length} post(s) in the console; ${changed.length} differ from the local copy`);
for (const c of changed) console.log(`  ${c.id}  ${c.date}  ${(localById.get(c.id)?.status || 'missing').padEnd(9)} -> ${c.status.padEnd(9)}  ${c.title}`);

if (args['dry-run']) { console.log('(dry run, nothing written)'); process.exit(0); }
if (existsSync(FILE)) copyFileSync(FILE, FILE.replace(/\.json$/, `.before-sync-${Date.now()}.json`));
writeFileSync(FILE, JSON.stringify(out, null, 2));
console.log(`written ${FILE}`);
setTimeout(() => process.exit(0), 150);
