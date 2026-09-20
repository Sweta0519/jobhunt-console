#!/usr/bin/env node
// Fetches a company logo once and stores it in Supabase Storage.
//
//   node workers/logos.mjs [--limit 60] [--retry] [--dry-run]
//
// Why store rather than hot-link: rendering `icons.duckduckgo.com/ip3/<domain>`
// straight from the browser would tell that service, on every page view, which
// companies she is tracking. Fetching server-side once leaks nothing.

import { select, updateEach, startRun, parseArgs } from './lib/db.mjs';
import { UA, sleep } from './lib/sources.mjs';

const BUCKET = 'logos';

/** Companies whose name maps to a domain we can reasonably guess. */
function guessDomain(slug, name) {
  const base = String(slug || '')
    .replace(/-(gmbh|inc|ltd|llc|ag|bv|corp|group|technologies|software)$/i, '')
    .replace(/[^a-z0-9-]/g, '');
  if (!base || base.length < 3 || base.includes('--')) return null;
  // A multi-word name rarely maps to a hyphenated domain; skip those.
  if (base.split('-').length > 2) return null;
  return `${base.replace(/-/g, '')}.com`;
}

async function fetchIcon(domain) {
  const urls = [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://${domain}/favicon.ico`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') || '';
      if (!/image|icon/i.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      // Anything tiny is a 1px tracker or an error page served as an image.
      if (buf.length < 100 || buf.length > 250_000) continue;
      return { buf, type: type.split(';')[0].trim() };
    } catch {
      /* try the next source */
    }
  }
  return null;
}

async function upload(path, buf, contentType) {
  const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!r.ok) throw new Error(`upload ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  const args = parseArgs();
  const limit = Number(args.limit || 60);
  const finish = args['dry-run'] ? async () => {} : await startRun('logos');

  // Only companies she actually looks at. Her data carries hundreds of
  // agencies and job boards that will never appear on a screen.
  const [jobs, questions, outreach] = await Promise.all([
    select('jobs', '?select=company_slug&closed=eq.false&company_slug=not.is.null'),
    select('questions', '?select=company_slug&company_slug=not.is.null'),
    select('outreach', '?select=company_slug&company_slug=not.is.null'),
  ]);
  const wanted = new Set(
    [...(jobs || []), ...(questions || []), ...(outreach || [])].map((r) => r.company_slug)
  );

  const filter = args.retry ? '' : '&logo_path=is.null';
  const all = await select(
    'companies',
    `?select=slug,name,domain,logo_path,logo_checked_at&order=is_target.desc,slug.asc${filter}`
  );
  // A company with a known domain is worth trying even without a live row.
  const rows = (all || []).filter((c) => wanted.has(c.slug) || c.domain);

  let done = 0;
  let missed = 0;
  const updates = [];

  for (const c of rows || []) {
    if (done + missed >= limit) break;
    const domain = c.domain || guessDomain(c.slug, c.name);
    if (!domain) continue;

    const icon = await fetchIcon(domain);
    const now = new Date().toISOString();
    if (!icon) {
      missed++;
      updates.push({ slug: c.slug, domain: c.domain || null, logo_checked_at: now });
      console.log(`  miss  ${c.slug.padEnd(28)} ${domain}`);
    } else {
      const ext = icon.type.includes('svg') ? 'svg' : icon.type.includes('png') ? 'png' : 'ico';
      const path = `${c.slug}.${ext}`;
      if (!args['dry-run']) await upload(path, icon.buf, icon.type);
      updates.push({ slug: c.slug, domain, logo_path: path, logo_checked_at: now });
      done++;
      console.log(`  ok    ${c.slug.padEnd(28)} ${domain} (${icon.buf.length}B)`);
    }
    await sleep(250); // be a polite client
  }

  if (!args['dry-run'] && updates.length) await updateEach('companies', 'slug', updates);
  const summary = { fetched: done, missed, considered: updates.length };
  await finish(true, summary);
  console.log(`\n${done} logo(s) stored, ${missed} without one`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 150))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 150);
  });
