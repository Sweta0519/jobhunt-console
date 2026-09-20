#!/usr/bin/env node
// Profile photos for the people she is actually in conversation with.
//
//   node scripts/avatars.mjs [--limit 5] [--dry-run] [--person <id>]
//   node scripts/avatars.mjs --prune            drop photos for closed conversations
//
// Runs on her PC against the Chrome that is already signed in to LinkedIn
// (the same one the outreach skill uses, on port 9224). It opens only the
// profiles of people who have outreach — ten of them today, not the 418
// contacts in the database — reads the photo the page already rendered, and
// stores it in a PRIVATE bucket.
//
// Scope and pacing are the safety story here: she opens these profiles herself
// to send the message, the volume is a couple a week, and nothing about this
// looks different from ordinary use. It needs her laptop, and degrades to an
// initials monogram when it has not run.

import { createRequire } from 'node:module';
import { select, updateEach, parseArgs } from '../workers/lib/db.mjs';

const require = createRequire(import.meta.url);
const CHROME_CDP = 'http://127.0.0.1:9224';
const BUCKET = 'avatars';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  for (const p of [
    'C:/Users/abhij/.claude/skills/linkedin-jobnet/node_modules/playwright-core',
    'C:/Users/abhij/.claude/skills/linkedin-content/node_modules/playwright-core',
    'playwright-core',
  ]) {
    try {
      return require(p);
    } catch {
      /* next candidate */
    }
  }
  throw new Error('playwright-core not found; it ships with the linkedin-jobnet skill');
}

async function upload(path, buf, contentType) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!r.ok) throw new Error(`upload ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

/**
 * Data minimisation: a photo is kept only while the conversation is live.
 * Once it is skipped or closed there is no reason to still hold someone's
 * picture, so it goes.
 */
async function prune(dryRun) {
  const [people, outreach] = await Promise.all([
    select('people', '?select=id,name,avatar_path&avatar_path=not.is.null'),
    select('outreach', '?select=person_id,status&person_id=not.is.null'),
  ]);
  const live = new Set(
    (outreach || []).filter((o) => !['skipped', 'closed'].includes(o.status)).map((o) => o.person_id)
  );
  const stale = (people || []).filter((p) => !live.has(p.id));
  if (!stale.length) {
    console.log('nothing to prune: every stored photo belongs to a live conversation');
    return;
  }
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const p of stale) {
    console.log(`  drop  ${p.name} (${p.avatar_path})`);
    if (dryRun) continue;
    await fetch(`${base}/storage/v1/object/${BUCKET}/${p.avatar_path}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  }
  if (!dryRun) await updateEach('people', 'id', stale.map((p) => ({ id: p.id, avatar_path: null })));
  console.log(`
${stale.length} photo(s) removed`);
}

async function main() {
  const args = parseArgs();
  const limit = Number(args.limit || 5);
  if (args.prune) return prune(!!args['dry-run']);

  // Only people with live outreach. Skipped conversations do not qualify.
  const outreach = await select(
    'outreach',
    '?select=person_id,person_name,person_url&person_url=not.is.null&status=neq.skipped'
  );
  const byUrl = new Map();
  for (const o of outreach || []) if (o.person_id) byUrl.set(o.person_id, o);

  const people = await select(
    'people',
    `?select=id,name,url,avatar_path&id=in.(${[...byUrl.keys()].map(encodeURIComponent).join(',')})`
  );
  let todo = (people || []).filter((p) => p.url && !p.avatar_path);
  if (args.person) todo = todo.filter((p) => p.id === args.person);
  if (!todo.length) {
    console.log('nothing to fetch: every person in an open conversation already has a photo');
    return;
  }
  console.log(`${todo.length} person/people without a photo; fetching up to ${limit}`);

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(CHROME_CDP);
  const page = await browser.contexts()[0].newPage();
  const updates = [];

  try {
    for (const person of todo.slice(0, limit)) {
      const url = person.url.split('?')[0].replace(/\/$/, '') + '/';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3500 + Math.random() * 2500); // read like a person would

      // The photo LinkedIn already rendered on the page she is visiting.
      const src = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')];
        const hit = imgs.find(
          (i) =>
            /profile-displayphoto|profile-photo/.test(i.src || '') &&
            (i.naturalWidth || 0) >= 100
        );
        return hit?.src || null;
      });

      const now = new Date().toISOString();
      if (!src) {
        console.log(`  none  ${person.name} (no public photo on the page)`);
        updates.push({ id: person.id, avatar_checked_at: now });
      } else {
        // The image itself comes from LinkedIn's CDN, an ordinary image request.
        const res = await fetch(src);
        const type = res.headers.get('content-type') || 'image/jpeg';
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || buf.length < 500) {
          console.log(`  fail  ${person.name} (${res.status}, ${buf.length}B)`);
          updates.push({ id: person.id, avatar_checked_at: now });
        } else {
          const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
          const path = `${person.id}.${ext}`;
          if (!args['dry-run']) await upload(path, buf, type);
          updates.push({ id: person.id, avatar_path: path, avatar_checked_at: now });
          console.log(`  ok    ${person.name} (${Math.round(buf.length / 1024)}KB)`);
        }
      }
      await sleep(6000 + Math.random() * 6000); // unhurried between profiles
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!args['dry-run'] && updates.length) await updateEach('people', 'id', updates);
  console.log(`\n${updates.filter((u) => u.avatar_path).length} photo(s) stored`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 200);
  });
