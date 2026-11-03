// Static guards for the board-coverage work. The repository and its Actions logs
// are public, so these fail loudly if a workflow, a worker or a committed file
// could expose a company list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validToken } from './lib/boards/hosts.mjs';
import { startStub } from './lib/resume/fixtures/stub-db.mjs';
import { selectAll } from './lib/db.mjs';
import { hashId } from './lib/resume/safelog.mjs';
import { UA } from './lib/sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const noComments = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('boards.yml has none of the forbidden constructs', () => {
  const code = noComments(read('.github/workflows/boards.yml'));
  for (const bad of ['pull_request', 'upload-artifact', 'git push', 'set -x', '--debug', 'npm ci', 'npm install']) {
    assert.ok(!code.includes(bad), `boards.yml contains ${bad}`);
  }
  assert.match(code, /persist-credentials: false/);
  const m = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(code + '\n');
  assert.deepEqual(m[1].trim().split('\n').map((l) => l.trim()), ['contents: read']);
  assert.ok(!/\$\{\{\s*(inputs|github\.event)/.test(code.split('\n').filter((l) => /run:/.test(l)).join('\n')), 'no input interpolated into a run line');
});

test('no workflow interpolates an input or event field into a run line', () => {
  for (const f of ['boards.yml', 'daily.yml', 'resumes.yml']) {
    const code = noComments(read(`.github/workflows/${f}`));
    const runs = code.split('\n').filter((l) => /run:/.test(l)).join('\n');
    assert.ok(!/\$\{\{\s*(inputs|github\.event)/.test(runs), `${f}: input interpolated into a run line`);
  }
});

test('daily.yml retries the keep-alive push on top of main, and survives a failed poll', () => {
  const y = read('.github/workflows/daily.yml');
  assert.match(y, /pull --rebase origin main/);
  assert.match(y, /fetch-depth: 0/);
  assert.match(y, /timeout-minutes: 25/);
  assert.equal((y.match(/if: \$\{\{ !cancelled\(\) \}\}/g) || []).length, 2);
});

test('no seed list or company list is committed; local lists are ignored', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\*\.local\.json$/m);
  assert.match(ignore, /boards-seed\.local\.json/);
  const files = walk(join(root, 'workers')).concat(walk(join(root, 'scripts'))).map((p) => relative(root, p).replace(/\\/g, '/'));
  assert.ok(!files.some((f) => /seed\.json$/.test(f)), 'a seed.json is committed');
  // opt-in: names from the PC-only list must appear in no committed file
  const names = (process.env.BOARD_LEAK_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
  if (names.length) {
    for (const f of files.filter((f) => !/\.local\.json$/.test(f))) {
      const src = readFileSync(join(root, f), 'utf8').toLowerCase();
      for (const n of names) assert.ok(!src.includes(n), `${f} contains a listed name`);
    }
  }
});

test('a local seed file, when present, holds only valid, unique tokens', () => {
  const p = join(root, 'scripts/boards-seed.local.json');
  if (!existsSync(p)) return;
  const list = JSON.parse(readFileSync(p, 'utf8'));
  const seen = new Set();
  for (const e of list) {
    assert.ok(validToken(e.kind, e.token), `bad token for kind ${e.kind}`);
    const k = `${e.kind}:${e.token}`;
    assert.ok(!seen.has(k), 'duplicate token');
    seen.add(k);
  }
});

test('in the workers that run in Actions, a console call never prints a company, token or title unguarded', () => {
  const files = ['workers/jobs.mjs', 'workers/boards.mjs', 'workers/logos.mjs', 'workers/notify.mjs', 'workers/questions.mjs', 'workers/render.mjs'];
  const risky = /\b(slug|token|label|\.name|\.company|\.title|\.message|\.url|domain)\b/;
  for (const f of files) {
    for (const [i, line] of read(f).split('\n').entries()) {
      if (!/console\.(log|info|warn|error)\s*\(/.test(line) || /^\s*\/\//.test(line)) continue;
      if (!risky.test(line)) continue;
      assert.ok(/isLocal\(\)|who\(/.test(line), `${f}:${i + 1} prints something that may name a company: ${line.trim()}`);
    }
  }
});

test('resumes.mjs logs a keyed hash of the job id, never the id', () => {
  const src = read('workers/resumes.mjs');
  assert.ok(!/event\('draft', \{ job: row\.job_id/.test(src));
  assert.equal((src.match(/hashId\(row\.job_id\)/g) || []).length, 3);
  assert.notEqual(hashId('ashby:acme:1', 'k1'), hashId('ashby:acme:1', 'k2'));
  assert.match(hashId('ashby:acme:1', 'k1'), /^[0-9a-f]{10}$/);
});

test('every request names the project repository, not a personal profile', () => {
  assert.equal(UA, 'jobhunt-console (personal job digest; +https://github.com/Sweta0519/jobhunt-console)');
  for (const f of walk(join(root, 'workers')).concat(walk(join(root, 'scripts'))).filter((p) => /\.mjs$/.test(p) && !/\.test\.mjs$/.test(p))) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/github\.com\/Sweta0519\)/.test(src), `${relative(root, f)} carries the old profile User-Agent`);
    for (const m of src.matchAll(/'User-Agent':\s*([^,}\s]+)/g)) assert.equal(m[1], 'UA', `${relative(root, f)}: ${m[0]}`);
  }
});

test('migrations 0014 and 0015 keep board data away from the browser', () => {
  const sql = read('supabase/migrations/0014_board_coverage.sql');
  assert.match(sql, /alter table jobhunt\.board_candidates force row level security/);
  assert.match(sql, /revoke all on jobhunt\.board_candidates from public, anon, authenticated/);
  assert.ok(!/grant (insert|delete|all)[^;]*board_candidates[^;]*to authenticated/i.test(sql));
  for (const fn of ['add_company', 'decide_board_candidate', 'set_company_watch']) {
    assert.match(sql, new RegExp(`function jobhunt\\.${fn}[\\s\\S]*?security definer set search_path = jobhunt, pg_catalog`));
    assert.match(sql, new RegExp(`revoke all on function jobhunt\\.${fn}`));
  }
  assert.ok(!/grant update[^;]*(board_kind|board_token|board_block|priority)[^;]*to authenticated/i.test(sql));
  assert.match(read('supabase/migrations/0015_boards_clock.sql'), /cron\.schedule\('jobhunt-boards'/);
});

test('the boards page has no en or em dash, and no app file reads the service role key', () => {
  const page = read('app/companies/boards/page.tsx');
  assert.ok(!/[–—]/.test(page), 'a dash in user-facing copy');
  for (const f of walk(join(root, 'app')).filter((p) => /\.(ts|tsx)$/.test(p))) {
    assert.ok(!readFileSync(f, 'utf8').includes('SERVICE_ROLE'), `${relative(root, f)} mentions the service role key`);
  }
});

test('selectAll reads every row over several pages', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0'), owner: 'o' }));
  const stub = await startStub({ tables: { things: rows } });
  const keep = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = stub.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
  try {
    const out = await selectAll('things', '?select=id&order=id.asc');
    assert.equal(out.length, 2500);
    assert.equal(out[2499].id, '02499');
  } finally {
    process.env.SUPABASE_URL = keep.u;
    process.env.SUPABASE_SERVICE_ROLE_KEY = keep.k;
    await stub.close();
  }
});
