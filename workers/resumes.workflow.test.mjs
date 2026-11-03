// Static guards for the resume drafting feature. The repository and its Actions
// logs are public, so these fail loudly if someone adds a way for CV text, a
// draft or a secret to escape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Git may check these out with CRLF on Windows; the guards match on \n.
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const yaml = read('.github/workflows/resumes.yml');
// Comments may name the forbidden things (that is how they warn about them).
const code = yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('resumes.yml has none of the forbidden constructs', () => {
  for (const bad of ['pull_request', 'upload-artifact', 'ANTHROPIC_API_KEY', 'OPENROUTER', 'set -x', '--debug', 'npm ci', 'npm install']) {
    assert.ok(!code.includes(bad), `resumes.yml contains ${bad}`);
  }
  assert.ok(!/\btee\b/.test(code), 'resumes.yml pipes through tee');
});

test('no ${{ inputs }} is interpolated into a run: block', () => {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const block = [m[2]];
    if (m[2] === '|' || m[2] === '>') {
      for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > indent); j++) block.push(lines[j]);
    }
    assert.ok(!/\$\{\{\s*(inputs|github\.event)/.test(block.join('\n')), `run block at line ${i + 1} interpolates an input`);
  }
});

test('the dispatched job id is never passed through env or printed: the worker reads the event file', () => {
  // Actions prints a step's env block. Only dry_run (a boolean) may come from inputs.
  const used = [...code.matchAll(/\$\{\{\s*(inputs|github\.event)[^}]*\}\}/g)].map((m) => m[0].replace(/\s+/g, ' '));
  assert.deepEqual([...new Set(used)], ['${{ inputs.dry_run }}']);
  assert.ok(!/\bJOB_ID\b/.test(code), 'resumes.yml sets JOB_ID');
  const worker = read('workers/resumes.mjs');
  assert.ok(!/process\.env\.JOB_ID/.test(worker), 'the worker reads the job id from env');
  assert.match(worker, /process\.env\.GITHUB_EVENT_PATH/);
  assert.match(worker, /inputs\?\.job/);
});

test('permissions are contents: read and nothing else', () => {
  const m = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(code + '\n');
  assert.ok(m, 'a top-level permissions block exists');
  assert.deepEqual(m[1].trim().split('\n').map((l) => l.trim()), ['contents: read']);
  assert.ok(!/^[ \t]+permissions:/m.test(code), 'no per-job permissions widen it');
});

test('only schedule and workflow_dispatch trigger it', () => {
  const on = /^on:\n((?:[ \t]+.*\n|\n)+?)(?=^\S)/m.exec(code + '\nx:')?.[1] || '';
  const triggers = [...on.matchAll(/^  (\w+):/gm)].map((x) => x[1]);
  assert.deepEqual(triggers.sort(), ['schedule', 'workflow_dispatch']);
});

test('the OAuth token appears in one step only', () => {
  // the line names it twice (env key and secret name); count lines
  assert.equal(code.split('\n').filter((l) => l.includes('CLAUDE_CODE_OAUTH_TOKEN')).length, 1);
  const draft = code.slice(code.indexOf('- name: Draft'));
  assert.ok(draft.includes('CLAUDE_CODE_OAUTH_TOKEN'));
});

test('the Claude version is an exact pin and the download is checked', () => {
  assert.match(code, /CC_VERSION: '\d+\.\d+\.\d+'/);
  assert.match(code, /CC_SHA512: '[A-Za-z0-9+/=]{80,}'/);
  assert.match(code, /test "\$\(openssl dgst -sha512 -binary cc\.tgz \| base64 -w0\)" = "\$CC_SHA512"/);
});

test('actions stay at the same pin style as the other workflows', () => {
  for (const m of code.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /^actions\/[\w-]+@v4$/, m[1]);
  assert.match(code, /persist-credentials: false/);
});

const PURE = ['facts', 'diff', 'compose', 'schema', 'text', 'prompt'];
test('pure modules import no db, child_process or env', () => {
  for (const name of PURE) {
    const src = read(`workers/lib/resume/${name}.mjs`);
    for (const line of src.split('\n')) {
      if (/^\s*import\b/.test(line)) {
        assert.ok(!/db\.mjs|child_process|node:fs|node:os|node:net|node:http/.test(line), `${name}: ${line}`);
      }
    }
    assert.ok(!/process\.env/.test(src), `${name} reads env`);
  }
});

test('nothing in the drafting code can print: no console calls', () => {
  const files = ['workers/resumes.mjs', ...walk(join(root, 'workers/lib/resume')).filter((p) => /\.mjs$/.test(p) && !/\.test\.mjs$|fixtures/.test(p)).map((p) => relative(root, p))];
  for (const f of files) {
    const src = read(f).replace(/\r/g, '');
    assert.ok(!/console\.(log|info|warn|error|debug|trace)\s*\(/.test(src), `${f} calls console`);
  }
});

test('the browser side never uses dangerouslySetInnerHTML or the service role key', () => {
  const files = [...walk(join(root, 'app/resumes')), join(root, 'app/lib/resumes.ts'), join(root, 'app/actions.ts')];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('dangerouslySetInnerHTML'), `${relative(root, f)} uses dangerouslySetInnerHTML`);
  }
  for (const f of walk(join(root, 'app')).filter((p) => /\.(ts|tsx)$/.test(p))) {
    assert.ok(!readFileSync(f, 'utf8').includes('SERVICE_ROLE'), `${relative(root, f)} mentions the service role key`);
  }
});

test('the migration locks all three tables to the primary owner', () => {
  const sql = read('supabase/migrations/0013_resume_drafts.sql');
  for (const t of ['master_cv', 'job_descriptions', 'resume_drafts']) {
    assert.match(sql, new RegExp(`alter table jobhunt\\.${t}\\s+force\\s+row level security`));
    assert.match(sql, new RegExp(`create policy ${t}_select on jobhunt\\.${t} for select to authenticated\\s+using \\(owner = auth\\.uid\\(\\) and \\(select jobhunt\\.is_primary\\(\\)\\)\\)`));
  }
  assert.match(sql, /revoke all on jobhunt\.master_cv, jobhunt\.job_descriptions, jobhunt\.resume_drafts from public, anon, authenticated/);
  assert.ok(!/grant (insert|delete|all)[^;]*to authenticated/i.test(sql));
  // the browser can write only the decision columns
  assert.match(sql, /grant update \(doc, fact_flags, status, edited_at, approved_at, discarded_at, updated_at\)/);
  assert.ok(!/generated_doc[^;]*to authenticated/.test(sql));
});

test('no fixture or test contains a real name from the optional leak list', () => {
  const names = (process.env.CV_LEAK_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
  if (!names.length) return; // opt-in: the list lives on the PC, never in the repo
  const files = [
    ...walk(join(root, 'workers/lib/resume')),
    join(root, 'workers/resumes.test.mjs'),
    join(root, 'workers/resumes.workflow.test.mjs'),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').toLowerCase();
    for (const n of names) assert.ok(!src.includes(n), `${relative(root, f)} contains a listed name`);
  }
});
