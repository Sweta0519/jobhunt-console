#!/usr/bin/env node
// Checks whether anyone has replied on LinkedIn, and raises a notification.
//
//   node scripts/linkedin-replies.mjs [--dry-run] [--limit 10]
//
// This is the one watcher that cannot run in the cloud. LinkedIn's official API
// does not expose message threads, and reading comments on her own posts needs
// partner access she does not have. So this runs on her PC against the Chrome
// that is already signed in, reads the conversation list she can see anyway,
// and writes what it finds to the same notifications table the cloud workers use.
//
// It reads. It never opens a thread it was not already going to show her, never
// sends, and never marks anything as replied on its own — a notification is a
// prompt for her to look, not a state change.

import { createRequire } from 'node:module';
import { select, upsert, parseArgs } from '../workers/lib/db.mjs';

const require = createRequire(import.meta.url);
const CDP = 'http://127.0.0.1:9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  for (const p of [
    'C:/Users/abhij/.claude/skills/linkedin-jobnet/node_modules/playwright-core',
    'playwright-core',
  ]) {
    try {
      return require(p);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright-core not found; it ships with the linkedin-jobnet skill');
}

async function main() {
  const args = parseArgs();
  const limit = Number(args.limit || 10);
  const today = new Date().toISOString().slice(0, 10);

  // Only people she has actually written to and who have not replied yet.
  const waiting = await select(
    'outreach',
    '?select=id,person_name,person_url,status,sent_at&status=in.(sent,accepted)&replied_at=is.null&person_name=not.is.null'
  );
  if (!waiting?.length) {
    console.log('nobody is awaiting a reply');
    return;
  }
  const names = new Map(waiting.map((o) => [o.person_name.toLowerCase(), o]));
  console.log(`${waiting.length} conversation(s) awaiting a reply`);

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(CDP);
  const page = await browser.contexts()[0].newPage();
  const notes = [];

  try {
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(5000);

    // The conversation list as rendered. An unread thread carries LinkedIn's
    // own unread marker; we only read what is already on screen.
    const threads = await page.evaluate(() => {
      const items = [...document.querySelectorAll('li.msg-conversation-listitem, li[class*="conversation"]')];
      return items.slice(0, 40).map((li) => {
        const text = (li.innerText || '').replace(/\s+/g, ' ').trim();
        const name = text.split('·')[0].split('\n')[0].slice(0, 60).trim();
        const unread =
          li.className.includes('unread') ||
          !!li.querySelector('[class*="unread"], .notification-badge--show');
        return { name, unread, preview: text.slice(0, 180) };
      });
    });

    for (const t of threads) {
      if (!t.unread || !t.name) continue;
      const match = [...names.entries()].find(
        ([n]) => n.includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(n.split(' ')[0])
      );
      if (!match) continue;
      const o = match[1];
      if (notes.length >= limit) break;
      notes.push({
        kind: 'linkedin_reply',
        severity: 'action',
        title: `${o.person_name} replied on LinkedIn`,
        body: t.preview.slice(0, 180),
        url: o.person_url || 'https://www.linkedin.com/messaging/',
        entity_ref: o.id,
        // One per person per day; she may take a while to get to it.
        dedupe_key: `linkedin:${o.id}:${today}`,
      });
      console.log(`  reply from ${o.person_name}`);
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!notes.length) {
    console.log('no new replies');
    return;
  }
  if (args['dry-run']) {
    console.log(`${notes.length} notification(s) would be raised`);
    return;
  }
  await upsert('notifications', notes, { onConflict: 'dedupe_key' });
  console.log(`\n${notes.length} notification(s) raised`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 200);
  });
