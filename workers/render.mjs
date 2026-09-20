#!/usr/bin/env node
// Renders drafts so the console can show what a post will look like before she
// approves it.
//
//   node workers/render.mjs [--id p_0007] [--all] [--dry-run]
//
// Approving a poster you have not seen is approving a description of it. This
// runs in the daily workflow, so by the time a draft appears in the console it
// already has a picture. Publishing re-renders from the current copy, so this
// is a preview and never the artifact of record.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { select, updateEach, startRun, parseArgs } from './lib/db.mjs';
import { DATA_DIR } from './lib/publish/paths.mjs';
import { renderItem } from './lib/publish/render.mjs';
import { openRenderer } from './lib/publish/browser.mjs';

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

async function fetchAssets() {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  for (const name of ['avatar.jpg', 'app-logo.png']) {
    const r = await fetch(`${base}/storage/v1/object/public/logos/_assets/${name}`);
    if (r.ok) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(DATA_DIR, name), Buffer.from(await r.arrayBuffer()));
    }
  }
}

async function upload(path, file) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  if (!r.ok) throw new Error(`upload ${path} -> ${r.status}`);
  return path;
}

async function main() {
  const args = parseArgs();
  const finish = args['dry-run'] ? async () => {} : await startRun('render');

  const filter = args.id
    ? `?id=eq.${args.id}`
    : args.all
      ? '?format=neq.text&order=post_date'
      : // Anything visual that has no preview yet, or whose copy changed after
        // the last one was made.
        '?format=neq.text&status=in.(draft,approved,rendered)&order=post_date';
  const rows = await select('posts', filter);

  const todo = (rows || []).filter((r) => {
    if (r.format === 'text') return false;
    if (args.id || args.all) return true;
    if (!r.preview_path) return true;
    return r.rendered_at && r.updated_at && r.updated_at > r.rendered_at;
  });

  if (!todo.length) {
    console.log('every visual post already has a current preview');
    await finish(true, { rendered: 0 });
    return;
  }
  console.log(`${todo.length} post(s) to render`);

  await fetchAssets();
  const cfg = {
    author: { name: 'Sweta Sahoo', title: 'Senior Customer Support Engineer' },
    theme: { accent: '#0F6E56', bg: '#FFFFFF', panel: '#F5F7FA', text: '#0F172A', muted: '#5B6472' },
    chromePath: chromePath(),
  };

  const renderer = await openRenderer(cfg);
  const updates = [];
  try {
    for (const row of todo) {
      mkdirSync(join(DATA_DIR, 'out', row.id), { recursive: true });
      const item = {
        id: row.id, date: row.post_date, format: row.format, pillar: row.pillar,
        title: row.title, size: row.size, card: row.card, slides: row.slides,
        caption: row.caption, altText: row.alt_text, documentTitle: row.title,
      };
      try {
        const out = await renderItem(item, cfg, renderer.page);
        const files = out.files || [];
        if (!files.length) {
          console.warn(`  ${row.id}: produced nothing`);
          continue;
        }
        const paths = [];
        if (!args['dry-run']) {
          for (const f of files) paths.push(await upload(`${row.id}/${f.split(/[\\/]/).pop()}`, f));
        }
        updates.push({
          id: row.id,
          preview_path: paths[0] ?? null,
          asset_paths: paths,
          rendered_at: new Date().toISOString(),
        });
        console.log(`  ${row.id.padEnd(8)} ${files.length} file(s)`);
      } catch (e) {
        console.warn(`  ${row.id}: ${e.message}`);
      }
    }
  } finally {
    await renderer.close();
  }

  if (!args['dry-run'] && updates.length) await updateEach('posts', 'id', updates);
  console.log(`\nrendered ${updates.length} post(s)`);
  await finish(true, { rendered: updates.length });
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 200);
  });
