#!/usr/bin/env node
// Renders and publishes today's approved post. Runs in GitHub Actions, so a
// post goes out whether or not her laptop is on.
//
//   node workers/publish.mjs [--dry-run] [--id p_0004] [--force]
//
// The rendering code is the content skill's, copied unchanged into
// lib/publish/ so posters look exactly like the ones she has been publishing.
// Only the surrounding plumbing is new: state comes from Supabase instead of
// posts.json, and the two brand assets are fetched into a scratch directory
// that `lib/publish/paths.mjs` points at.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { select, patch, upsert, getSecret, startRun, parseArgs } from './lib/db.mjs';
import { DATA_DIR } from './lib/publish/paths.mjs';
import { renderItem } from './lib/publish/render.mjs';
import { openRenderer } from './lib/publish/browser.mjs';
import { captionForApi, captionForHumans } from './lib/publish/caption.mjs';
import { makeClient, retryable, sleep } from './lib/publish/linkedin-api.mjs';

/** Chrome on the Actions runner, or whatever CHROME_PATH points at locally. */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ]) {
    if (existsSync(p)) return p;
  }
  throw new Error('no Chrome found; set CHROME_PATH');
}

async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 3 || !retryable(e)) throw e;
      console.warn(`  ${label}: ${e.message}; retry ${attempt}`);
      await sleep([10000, 30000, 60000][attempt - 1]);
    }
  }
}

const berlinToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

/** The poster template reads these from disk; fetch them once per run. */
async function fetchAssets() {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  for (const name of ['avatar.jpg', 'app-logo.png']) {
    const r = await fetch(`${base}/storage/v1/object/public/logos/_assets/${name}`);
    if (!r.ok) {
      console.warn(`  asset ${name} unavailable (${r.status}); the poster will render without it`);
      continue;
    }
    writeFileSync(join(DATA_DIR, name), Buffer.from(await r.arrayBuffer()));
  }
}

/** Keep the rendered image, so the console can show what actually went out. */
async function storeRender(id, file) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const path = `${id}/${file.split(/[\\/]/).pop()}`;
  const r = await fetch(`${base}/storage/v1/object/posts/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: readFileSync(file),
  });
  return r.ok ? path : null;
}

/** posts.json shape, which the render code expects. */
function toItem(row) {
  return {
    id: row.id,
    date: row.post_date,
    format: row.format,
    pillar: row.pillar,
    title: row.title,
    size: row.size,
    card: row.card,
    slides: row.slides,
    caption: row.caption,
    altText: row.alt_text,
    documentTitle: row.title,
  };
}

async function main() {
  const args = parseArgs();
  const today = berlinToday();
  const finish = args['dry-run'] ? async () => {} : await startRun('publish');

  const filter = args.id
    ? `?id=eq.${args.id}`
    : `?post_date=eq.${today}&status=in.(approved,rendered)`;
  const rows = await select('posts', filter);
  const row = rows?.[0];

  if (!row) {
    console.log(`nothing to publish for ${today}`);
    await finish(true, { published: 0, reason: 'nothing approved for today' });
    return;
  }
  // A dry run publishes nothing, so it may preview a draft. Only the real
  // publish path insists on an approval.
  const preview = !!args['dry-run'];
  if (row.status === 'published' && !args.force && !preview) {
    console.log(`${row.id} is already published: ${row.published_url}`);
    await finish(true, { published: 0, reason: 'already published' });
    return;
  }
  if (!['approved', 'rendered'].includes(row.status) && !args.force && !preview) {
    console.log(`${row.id} is ${row.status}, not approved; refusing`);
    await finish(true, { published: 0, reason: `status ${row.status}` });
    return;
  }

  console.log(`${row.id} — ${row.title || '(untitled)'} (${row.format})`);
  await fetchAssets();

  const item = toItem(row);
  // The minimal card templates read colours from config; the poster templates
  // carry their own palette. Both must be present or a `tool` card throws.
  const cfg = {
    author: { name: 'Sweta Sahoo', title: 'Senior Customer Support Engineer' },
    theme: { accent: '#0F6E56', bg: '#FFFFFF', panel: '#F5F7FA', text: '#0F172A', muted: '#5B6472' },
    chromePath: chromePath(),
  };
  mkdirSync(join(DATA_DIR, 'out', row.id), { recursive: true });

  let rendered = { files: [], pdf: null };
  if (row.format !== 'text') {
    const renderer = await openRenderer(cfg);
    try {
      rendered = await renderItem(item, cfg, renderer.page);
    } finally {
      await renderer.close();
    }
  }
  const files = rendered.files || [];
  console.log(`  rendered ${files.length} file(s)${rendered.pdf ? ' + pdf' : ''}`);

  if (args['dry-run']) {
    console.log('  dry run, nothing uploaded or published');
    console.log(`  caption:\n${captionForHumans(row.caption || {}).slice(0, 500)}`);
    if (files.length) console.log(`  files: ${files.join(', ')}`);
    return;
  }

  const assetPaths = [];
  for (const f of files) {
    const p = await storeRender(row.id, f);
    if (p) assetPaths.push(p);
  }

  const secret = await getSecret('linkedin_token');
  if (!secret?.access_token) throw new Error('no LinkedIn token in secrets; reconnect from Settings');
  if (secret.expires_at && new Date(secret.expires_at) < new Date()) {
    throw new Error(`LinkedIn token expired on ${secret.expires_at}; reconnect from Settings`);
  }

  const client = makeClient({ token: secret.access_token, apiVersion: secret.api_version || '202608' });
  const author = secret.person_urn;
  const commentary = captionForApi(row.caption || {});

  let result;
  try {
    // Media first, then the post. LinkedIn needs a moment to process an upload
    // before a post may reference it, which is what the sleeps and the
    // not-ready retry below are for.
    let content;
    if (row.format === 'card' && files.length) {
      const init = await withRetry(() => client.initImage(author), 'initImage');
      await withRetry(() => client.putBinary(init.uploadUrl, files[0]), 'upload');
      await sleep(3000);
      content = { media: { id: init.image, altText: (row.alt_text || row.title || '').slice(0, 4000) } };
    } else if (row.format === 'deck' && rendered.pdf) {
      // renderItem returns the PDF as an object carrying its path; putBinary
      // reads a path. The first deck through this worker (p_0006, 22 Sep)
      // failed on exactly that, after the card path had worked the day before.
      const init = await withRetry(() => client.initDocument(author), 'initDocument');
      await withRetry(() => client.putBinary(init.uploadUrl, rendered.pdf.path), 'upload');
      await sleep(4000);
      content = { media: { id: init.document, title: (row.title || 'Carousel').slice(0, 400) } };
    }

    for (let attempt = 1; ; attempt++) {
      try {
        result = await client.createPost({
          author,
          commentary,
          visibility: secret.visibility || 'PUBLIC',
          content,
        });
        break;
      } catch (e) {
        const notReady =
          e.status === 400 &&
          /not (yet )?(available|ready|processed)|processing|media/i.test(JSON.stringify(e.body || ''));
        if ((notReady || retryable(e)) && attempt <= 4) {
          console.warn(`  createPost: ${e.message}; waiting`);
          await sleep([5000, 10000, 20000, 30000][attempt - 1]);
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    await patch('posts', `?id=eq.${row.id}`, {
      status: 'failed',
      last_error: String(e.message).slice(0, 500),
      updated_at: new Date().toISOString(),
    });
    await finish(false, { published: 0 }, e.message);
    throw e;
  }

  const urn = result.urn;
  const url = result.url || `https://www.linkedin.com/feed/update/${urn}/`;
  const now = new Date().toISOString();

  await patch('posts', `?id=eq.${row.id}`, {
    status: 'published',
    published_urn: urn,
    published_url: url,
    published_at: now,
    asset_paths: assetPaths,
    last_error: null,
    updated_at: now,
  });

  // The record screen is what she pastes into an application, so it goes there too.
  await upsert(
    'contributions',
    [{ kind: 'post', title: row.title || row.id, url, source_ref: row.id, happened_at: now }],
    { onConflict: 'url' }
  );

  console.log(`\npublished ${row.id} -> ${url}`);
  await finish(true, { published: 1, post: row.id, urn });
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 200);
  });
