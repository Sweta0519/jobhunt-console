#!/usr/bin/env node
// One-time: reads the master CV from a file OUTSIDE this repository and stores
// it for the resume drafts.
//
//   node scripts/seed-master-cv.mjs --file "<path>" --dry-run   writes out/master-cv-preview.json, prints counts
//   node scripts/seed-master-cv.mjs --file "<path>"             inserts the next version for the primary owner
//
// The repository is public and the CV is personal data. This script refuses a
// file inside the repo, never prints CV text, and prints counts and status
// codes only. out/ is gitignored.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { primaryOwner, forOwner, parseArgs } from '../workers/lib/db.mjs';
import { parseMaster } from '../workers/lib/resume/parse-master.mjs';

const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function main() {
  const args = parseArgs();
  if (!args.file || args.file === true) throw new Error('usage: --file "<path to the master html>" [--dry-run]');
  const file = resolve(String(args.file));
  const rel = relative(repo, file);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('refusing: the master CV must live outside this repository');
  }

  const html = readFileSync(file, 'utf8');
  const doc = parseMaster(html);
  const counts = {
    roles: doc.experience.length,
    bullets: doc.experience.reduce((n, r) => n + r.bullets.length, 0),
    skills: doc.skills.length,
    open_source: doc.open_source.length,
    projects: doc.projects.length,
    links: doc.links.length,
  };
  console.log('parsed', JSON.stringify(counts));

  if (args['dry-run']) {
    mkdirSync('out', { recursive: true });
    writeFileSync('out/master-cv-preview.json', JSON.stringify(doc, null, 2));
    console.log('wrote out/master-cv-preview.json (gitignored). Nothing was stored.');
    return;
  }

  const source_sha = createHash('sha256').update(html).digest('hex');
  const owner = await primaryOwner();
  const db = forOwner(owner.id);
  const versions = await db.select('master_cv', '?select=version,source_sha&order=version.desc');
  if (versions.some((v) => v.source_sha === source_sha)) {
    console.log('unchanged: this file is already stored');
    return;
  }
  const version = (versions[0]?.version ?? 0) + 1;
  await db.upsert('master_cv', [{ version, doc, source_sha }], { onConflict: 'owner,version' });
  console.log(`stored master CV version ${version}`);

  // First seed only: the drafting switch. "from" keeps the existing backlog out.
  const [cfg] = await db.select('settings', '?select=key&key=eq.resume_config');
  if (!cfg) {
    await db.upsert(
      'settings',
      [{
        key: 'resume_config',
        value: { enabled: true, daily_cap: 5, min_score: 70, from: new Date().toISOString(), model: 'sonnet', stop_at_utilization: 0.85 },
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'owner,key' }
    );
    console.log('wrote settings.resume_config (enabled)');
  }
}

main().catch((e) => {
  // A database error carries the failing row, which here is the CV: status code only.
  const code = /-> (\d{3})/.exec(String(e?.message))?.[1];
  const known = /^(usage:|refusing:|master CV:)/.test(String(e?.message));
  console.error(known ? e.message : `failed${code ? ` (HTTP ${code})` : ''}`);
  process.exit(1);
});
