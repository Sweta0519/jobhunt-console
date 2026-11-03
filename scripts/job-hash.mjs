#!/usr/bin/env node
// Maps a log tag (job=<hash>) back to a job id. Needs the service role key in
// .env.local, the same one the workers hash with.
//
//   node scripts/job-hash.mjs <hash> [<hash> ...]

import { selectAll } from '../workers/lib/db.mjs';
import { hashId } from '../workers/lib/publiclog.mjs';

const wanted = new Set(process.argv.slice(2));
if (!wanted.size) {
  console.error('usage: node scripts/job-hash.mjs <hash> [<hash> ...]');
  process.exit(2);
}
const jobs = await selectAll('jobs', '?select=id,company,title,owner&order=id.asc');
for (const j of jobs) {
  const h = hashId(j.id);
  if (wanted.has(h)) console.log(`${h}  ${j.id}  ${j.company}: ${j.title}`);
}
