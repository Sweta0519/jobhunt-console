#!/usr/bin/env node
// Seeds, adds and lists job boards for one person. Runs on her PC with the
// service role key from .env.local, never on Vercel. Writes only for the owner
// named with --owner, so a second person gets nothing unless asked for.
//
//   node scripts/boards.mjs seed --owner <label> [--file <seed.json>] [--dry-run]
//   node scripts/boards.mjs add  --owner <label> --name "Acme" [--domain acme.com] [--priority]
//   node scripts/boards.mjs list --owner <label>
//
// The seed list is a local, gitignored file (default scripts/boards-seed.local.json),
// an array of { name, kind, token, domain }. This repository and its Actions logs
// are public: no seed, company list or token belongs in a committed file.
//
// `seed` checks every entry live and classifies it like the probe does:
// confirmed boards are enabled (first poll protected, so old roles do not
// notify), the rest become a review candidate.

import { readFileSync, existsSync } from 'node:fs';
import { owners, forOwner, parseArgs } from '../workers/lib/db.mjs';
import { fetchProbe } from '../workers/lib/boards/fetch.mjs';
import { classify } from '../workers/lib/boards/classify.mjs';
import { validToken } from '../workers/lib/boards/hosts.mjs';
import { titleFilters, loadOwnerProfile } from '../workers/jobs.mjs';
import { boardUrl, candidateStatus } from '../workers/boards.mjs';
import { sleep } from '../workers/lib/sources.mjs';

const args = parseArgs();
const cmd = args._[0];

async function findOwner(name) {
  const o = (await owners()).find((x) => x.label === name || x.id === name);
  if (!o) throw new Error(`no allowed user "${name}" (run: node scripts/owner.mjs list)`);
  return o;
}

const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

async function seed() {
  const o = await findOwner(args.owner);
  const db = forOwner(o.id);
  const file = args.file || new URL('./boards-seed.local.json', import.meta.url);
  if (!existsSync(file)) throw new Error(`seed file not found: ${file}`);
  const list = JSON.parse(readFileSync(file, 'utf8'));
  const profile = await loadOwnerProfile(db, o);
  const { relevant, exclude } = titleFilters(profile || {});
  const have = new Map((await db.selectAll('companies', '?select=slug,board_kind,board_token&order=slug.asc')).map((c) => [c.slug, c]));
  const companies = [];
  const candidates = [];
  const tally = { confirmed: 0, review: 0, parked: 0, none: 0, skipped: 0 };
  for (const e of list) {
    const slug = slugOf(e.name);
    if (!slug || !validToken(e.kind, e.token)) { tally.skipped++; continue; }
    if (have.get(slug)?.board_token) { tally.skipped++; continue; } // already has a board
    let probe;
    try { probe = await fetchProbe(e.kind, e.token); } catch { tally.skipped++; continue; }
    await sleep(e.kind === 'lever' ? 1100 : 300);
    if (!probe) { tally.none++; continue; }
    const company = { name: e.name, domain: e.domain || null };
    const { verdict, evidence } = classify(company, probe);
    const rel = probe.posts.filter((p) => relevant.test(String(p.title || '').trim()) && !exclude.test(String(p.title || ''))).length;
    const status = candidateStatus(verdict, rel, {});
    if (!status) { tally.none++; continue; }
    tally[status]++;
    const row = { slug, name: e.name, origin: 'seed', domain: e.domain || null, domain_source: e.domain ? 'seed' : null, is_target: false, priority: false };
    if (status === 'confirmed') Object.assign(row, { board_kind: e.kind, board_token: e.token, board_added_at: new Date().toISOString(), board_baselined_at: null });
    companies.push(row);
    candidates.push({
      company_slug: slug, kind: e.kind, token: e.token, status, board_name: probe.name || null, board_url: boardUrl(e.kind, e.token),
      postings: probe.posts.length, relevant: rel, sample_titles: probe.posts.map((p) => String(p.title).trim()).slice(0, 5), evidence, last_checked_at: new Date().toISOString(),
    });
    console.log(`  ${status.padEnd(9)} ${e.name} (${e.kind}, ${probe.posts.length} open, ${rel} relevant)`);
  }
  console.log(`\n${list.length} entries: ${JSON.stringify(tally)}`);
  if (args['dry-run']) { console.log('dry run, nothing written'); return; }
  if (companies.length) await db.upsert('companies', companies, { onConflict: 'owner,slug' });
  if (candidates.length) await db.upsert('board_candidates', candidates, { onConflict: 'owner,company_slug,kind,token' });
  console.log(`wrote ${companies.length} company row(s) for ${o.label}`);
}

async function add() {
  const o = await findOwner(args.owner);
  const name = String(args.name || '').trim();
  const slug = slugOf(name);
  if (!slug) throw new Error('add needs --name');
  const domain = args.domain ? String(args.domain).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null;
  await forOwner(o.id).upsert(
    'companies',
    [{
      slug, name, domain, domain_source: domain ? 'manual' : null, origin: 'manual', is_target: true, priority: !!args.priority,
      probe_requested_at: new Date().toISOString(), next_probe_at: new Date().toISOString(),
    }],
    { onConflict: 'owner,slug' }
  );
  console.log(`added ${name} for ${o.label}; the next boards run probes it first`);
}

async function list() {
  const o = await findOwner(args.owner);
  const db = forOwner(o.id);
  const watched = await db.selectAll('companies', '?select=slug,name,board_kind,board_token,board_block&board_token=not.is.null&order=slug.asc');
  console.log(`watching ${watched.length}`);
  for (const c of watched) console.log(`  ${c.board_block ? 'stopped' : 'watching'}  ${c.name}  ${c.board_kind}:${c.board_token}`);
  const cands = await db.selectAll('board_candidates', '?select=company_slug,kind,token,status,postings,relevant&status=in.(review,parked,unsupported,hint)&order=company_slug.asc');
  console.log(`\ncandidates ${cands.length}`);
  for (const r of cands) console.log(`  ${r.status.padEnd(11)} ${r.company_slug}  ${r.kind}:${r.token}  ${r.postings} open, ${r.relevant} relevant`);
}

try {
  if (cmd === 'seed') await seed();
  else if (cmd === 'add') await add();
  else if (cmd === 'list') await list();
  else {
    console.error('usage: node scripts/boards.mjs seed|add|list --owner <label> ...');
    process.exit(2);
  }
  setTimeout(() => process.exit(0), 150);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
