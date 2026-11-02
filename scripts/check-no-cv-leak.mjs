#!/usr/bin/env node
// Local leak scan, PC only. Looks for identifying strings from the master CV
// in tracked files, or in a downloaded run log.
//
//   node scripts/check-no-cv-leak.mjs --file "<master html>"                   git grep over tracked files
//   node scripts/check-no-cv-leak.mjs --file "<master html>" --log <run.log>   scan a log file
//
// Prints "check N: count" only, never the strings. Expected: every count is 0
// for a log. Over tracked files, a count above 0 means a CV string is in the repo.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../workers/lib/db.mjs';
import { parseMaster } from '../workers/lib/resume/parse-master.mjs';

const args = parseArgs();
if (!args.file || args.file === true) {
  console.error('usage: --file "<master html>" [--log <file>]');
  process.exit(2);
}
const doc = parseMaster(readFileSync(String(args.file), 'utf8'));

const needles = [
  doc.name,
  ...doc.contact.map((c) => c.label),
  ...doc.contact.map((c) => (c.href || '').replace(/^mailto:/, '')),
  ...doc.experience.map((r) => r.company),
  ...doc.projects.map((p) => p.title),
].map((s) => String(s || '').trim()).filter((s) => s.length >= 4);
const unique = [...new Set(needles)];

const log = args.log && args.log !== true ? readFileSync(String(args.log), 'utf8').toLowerCase() : null;
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
