#!/usr/bin/env node
// Local leak scan, PC only. Looks for private strings in tracked files, or in a
// downloaded run log: identifying strings from the master CV, private strings she
// keeps outside the repo (saved answers, for example), and recent application
// form labels and cover letter sentences from the database.
//
//   node scripts/check-no-cv-leak.mjs --file "<master html>"                   git grep over tracked files
//   node scripts/check-no-cv-leak.mjs --file "<master html>" --log <run.log>   scan a log file
//   node scripts/check-no-cv-leak.mjs --private-strings <file>                 one private string per line, kept outside the repo
//   node scripts/check-no-cv-leak.mjs --drafts [--log <run.log>]               recent labels and cover sentences, needs the local service key
//
// The sources can be combined. Prints "check N: count" only, never the strings.
// Expected: every count is 0 for a log. Over tracked files, a count above 0 means
// a private string is in the repo.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs, primaryOwner, forOwner } from '../workers/lib/db.mjs';
import { parseMaster } from '../workers/lib/resume/parse-master.mjs';

const args = parseArgs();
const have = (k) => args[k] && args[k] !== true;
if (!have('file') && !have('private-strings') && !args.drafts) {
  console.error('usage: --file "<master html>" | --private-strings <file> | --drafts   [--log <file>]');
  process.exit(2);
}

const needles = [];
if (have('file')) {
  const doc = parseMaster(readFileSync(String(args.file), 'utf8'));
  needles.push(
    doc.name,
    ...doc.contact.map((c) => c.label),
    ...doc.contact.map((c) => (c.href || '').replace(/^mailto:/, '')),
    ...doc.experience.map((r) => r.company),
    ...doc.projects.map((p) => p.title),
  );
}
if (have('private-strings')) {
  needles.push(...readFileSync(String(args['private-strings']), 'utf8').split('\n'));
}
if (args.drafts) {
  // Labels and cover sentences are long enough to be specific and short enough to grep.
  const db = forOwner((await primaryOwner()).id);
  for (const f of await db.select('application_forms', '?select=form&order=updated_at.desc&limit=60')) {
    for (const q of f.form?.questions || []) needles.push(q.label);
  }
  for (const d of await db.select('application_drafts', '?select=cover_text&order=updated_at.desc&limit=60')) {
    for (const s of String(d.cover_text || '').split(/(?<=[.!?])\s+/)) if (s.length >= 25) needles.push(s);
  }
}
const unique = [...new Set(needles.map((s) => String(s || '').trim()).filter((s) => s.length >= 4))];

const log = have('log') ? readFileSync(String(args.log), 'utf8').toLowerCase() : null;
let bad = 0;
unique.forEach((n, i) => {
  let count = 0;
  if (log !== null) {
    count = log.split(n.toLowerCase()).length - 1;
  } else {
    const r = spawnSync('git', ['grep', '-c', '-i', '-F', '-e', n], { encoding: 'utf8' });
    count = (r.stdout || '').split('\n').filter(Boolean).reduce((s, line) => s + Number(line.split(':').pop()), 0);
  }
  if (count) bad++;
  console.log(`check ${i + 1}: ${count}`);
});
process.exit(bad ? 1 : 0);
