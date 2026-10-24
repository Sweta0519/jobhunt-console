#!/usr/bin/env node
// Bring another person into the console, and keep their setup current.
//
//   node scripts/owner.mjs list
//   node scripts/owner.mjs add --email <email> --label <name>
//   node scripts/owner.mjs profile --owner <name> --file <profile.json>
//   node scripts/owner.mjs companies --owner <name> --file <companies.json>
//
// Their files belong outside this public repo, e.g. ~/.jobhunt-owners/<name>/.
// The profile goes to their own `settings` row (key jobfit_profile), which only
// they and the workers can read; companies.json is an array of
// { slug, name, board_kind, board_token, domain? }.
//
// `add` creates the sign-in through the admin API, because sign-ups are closed
// on this project, and prints a one-time password for them to change in
// Settings. It runs on her PC with the service role key from .env.local and
// never on Vercel.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { owners, forOwner, upsert, parseArgs } from '../workers/lib/db.mjs';

const args = parseArgs();
const cmd = args._[0];

async function findOwner(name) {
  const o = (await owners()).find((x) => x.label === name || x.id === name);
  if (!o) throw new Error(`no allowed user "${name}" (run: node scripts/owner.mjs list)`);
  return o;
}

async function add() {
  const email = args.email;
  const label = args.label;
  if (!email || !label) throw new Error('add needs --email and --label');
  if ((await owners()).some((o) => o.label === label)) throw new Error(`label "${label}" is taken`);

  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = randomBytes(12).toString('base64url');
  const r = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`create user -> ${r.status}: ${body.msg || body.message || JSON.stringify(body)}`);

  await upsert('allowed_user', [{ user_id: body.id, label, is_primary: false, note: email }], {
    onConflict: 'user_id',
  });
  console.log(`added ${label} <${email}> as ${body.id}`);
  console.log(`one-time password: ${password}`);
  console.log('they sign in at https://jobhunt-console.vercel.app/login and change it under Settings');
}

async function profile() {
  const o = await findOwner(args.owner);
  if (o.primary) throw new Error('the primary profile is lib/jobfit/profile.json, not a settings row');
  const value = JSON.parse(readFileSync(args.file, 'utf8'));
  if (!Array.isArray(value.roles) || !value.skills) throw new Error('profile needs roles[] and skills{}');
  for (const k of ['relevant', 'exclude']) if (value.titles?.[k]) new RegExp(value.titles[k], 'i');
  await forOwner(o.id).upsert(
    'settings',
    [{ key: 'jobfit_profile', value, updated_at: new Date().toISOString() }],
    { onConflict: 'owner,key' }
  );
  console.log(`profile stored for ${o.label}: ${value.roles.length} role(s), ${Object.keys(value.skills).length} skill group(s)`);
}

async function companies() {
  const o = await findOwner(args.owner);
  const list = JSON.parse(readFileSync(args.file, 'utf8'));
  const rows = list.map((c) => ({
    slug: c.slug,
    name: c.name || c.slug,
    board_kind: c.board_kind || null,
    board_token: c.board_token || null,
    domain: c.domain || null,
    is_target: true,
    updated_at: new Date().toISOString(),
  }));
  await forOwner(o.id).upsert('companies', rows, { onConflict: 'owner,slug' });
  console.log(`${rows.length} compan${rows.length === 1 ? 'y' : 'ies'} stored for ${o.label}`);
}

async function list() {
  for (const o of await owners()) console.log(`${o.primary ? '*' : ' '} ${String(o.label || '').padEnd(14)} ${o.id}`);
}

const COMMANDS = { add, profile, companies, list };
if (!COMMANDS[cmd]) {
  console.error('usage: node scripts/owner.mjs list | add | profile | companies  (see the header)');
  process.exit(2);
}
COMMANDS[cmd]()
  .then(() => setTimeout(() => process.exit(0), 150))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 150);
  });
