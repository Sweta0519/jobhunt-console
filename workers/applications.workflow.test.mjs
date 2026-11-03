// Static guards for the application answers feature. The repository and its
// Actions logs are public, so these fail loudly if someone adds a way for a form
// label, an answer, a saved value or a secret to escape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const yaml = read('.github/workflows/applications.yml');
const code = yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('applications.yml has none of the forbidden constructs', () => {
  for (const bad of ['pull_request', 'upload-artifact', 'download-artifact', 'ANTHROPIC_API_KEY', 'OPENROUTER', 'set -x', '--debug', 'npm ci', 'npm install', '--no-sandbox', 'READER_BOX_KEY']) {
    assert.ok(!code.includes(bad), `applications.yml contains ${bad}`);
  }
  assert.ok(!/\btee\b/.test(code), 'applications.yml pipes through tee');
});

test('the only input is dry_run and nothing else from the event is interpolated', () => {
  const inputs = /^ {4}inputs:\n((?: {6,}.*\n)+)/m.exec(code + '\n')?.[1] || '';
  assert.deepEqual([...inputs.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1]), ['dry_run']);
  const used = [...code.matchAll(/\$\{\{\s*(inputs|github\.event)[^}]*\}\}/g)].map((m) => m[0].replace(/\s+/g, ' '));
  assert.deepEqual([...new Set(used)], ['${{ inputs.dry_run }}']);
  assert.ok(!/\bJOB_ID\b/.test(code));
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
    assert.ok(!/\$\{\{/.test(block.join('\n')), `run block at line ${i + 1} interpolates an expression`);
  }
});

test('permissions are contents: read and nothing else', () => {
  const m = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(code + '\n');
  assert.ok(m, 'a top-level permissions block exists');
  assert.deepEqual(m[1].trim().split('\n').map((l) => l.trim()), ['contents: read']);
  assert.ok(!/^[ \t]+permissions:/m.test(code), 'no per-job permissions widen it');
});

test('only schedule and workflow_dispatch trigger it', () => {
  const on = /^on:\n((?:[ \t]+.*\n|\n)+?)(?=^\S)/m.exec(code + '\nx:')?.[1] || '';
  const triggers = [...on.matchAll(/^ {2}(\w+):/gm)].map((x) => x[1]);
  assert.deepEqual(triggers.sort(), ['schedule', 'workflow_dispatch']);
});

test('two jobs on two machines: the Claude token and the database key are not in the plan job', () => {
  const plan = code.slice(code.indexOf('\n  plan:'), code.indexOf('\n  draft:'));
  const draft = code.slice(code.indexOf('\n  draft:'));
  assert.ok(plan.includes('--plan'));
  assert.ok(!plan.includes('CLAUDE'), 'the plan job references a Claude token');
  assert.ok(!/\bcc\b|claude-code/i.test(plan), 'the plan job installs Claude');
  assert.equal(code.split('\n').filter((l) => l.includes('CLAUDE_CODE_OAUTH_TOKEN')).length, 1);
  assert.ok(draft.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.match(draft, /needs: plan/);
  assert.match(draft, /needs\.plan\.outputs\.todo != '0'/);
  // every secret is one of the three the worker needs
  const secrets = [...new Set([...code.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(secrets, ['CLAUDE_CODE_OAUTH_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
});

test('the Claude version is an exact pin and the download is checked, the same pin as resumes.yml', () => {
  assert.match(code, /CC_VERSION: '\d+\.\d+\.\d+'/);
  assert.match(code, /CC_SHA512: '[A-Za-z0-9+/=]{80,}'/);
  assert.match(code, /test "\$\(openssl dgst -sha512 -binary cc\.tgz \| base64 -w0\)" = "\$CC_SHA512"/);
  const pin = (s) => [/CC_VERSION: '([^']+)'/.exec(s)[1], /CC_SHA512: '([^']+)'/.exec(s)[1]];
  assert.deepEqual(pin(code), pin(read('.github/workflows/resumes.yml')));
});

test('actions stay at the same pin style as the other workflows', () => {
  for (const m of code.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /^actions\/[\w-]+@v4$/, m[1]);
  assert.match(code, /persist-credentials: false/);
});

// --- code ---------------------------------------------------------------------
const files = (dir) => walk(join(root, dir)).filter((p) => /\.mjs$/.test(p) && !/\.test\.mjs$|fixtures/.test(p));
const APPLY = files('workers/lib/apply').map((p) => relative(root, p));

test('the answers bank appears nowhere under workers/ except tests that assert it is absent', () => {
  for (const p of walk(join(root, 'workers'))) {
    if (/\.test\.mjs$/.test(p)) continue;
    const src = readFileSync(p, 'utf8');
    assert.ok(!/answer_bank/.test(src), `${relative(root, p)} names answer_bank`);
  }
});

test('the migration gives the service role no grant on the bank', () => {
  const sql = read('supabase/migrations/0017_application_answers.sql');
  assert.match(sql, /revoke all on jobhunt\.answer_bank from public, anon, authenticated, service_role/);
  assert.ok(!/grant[^;]*jobhunt\.answer_bank[^;]*to[^;]*service_role/i.test(sql), 'a grant on answer_bank to service_role');
  assert.ok(!/grant all on[^;]*answer_bank/i.test(sql));
  for (const t of ['answer_bank', 'application_forms', 'application_drafts']) {
    assert.match(sql, new RegExp(`alter table jobhunt\\.${t}\\s+force\\s+row level security`));
    assert.match(sql, new RegExp(`create policy ${t}_select on jobhunt\\.${t} for select to authenticated\\s+using \\(owner = auth\\.uid\\(\\) and \\(select jobhunt\\.is_primary\\(\\)\\)\\)`));
  }
  assert.ok(!/grant (insert|delete|all)[^;]*application_(forms|drafts)[^;]*to authenticated/i.test(sql));
  // the browser can write only the decision columns, never the worker's results
  const upd = (t) => new RegExp(`grant update \\(([^)]*)\\)\\s+on jobhunt\\.${t} to authenticated`).exec(sql)?.[1] || '';
  for (const col of ['form', 'form_sha', 'apply_url', 'completeness', 'read_at']) assert.ok(!new RegExp(`\\b${col}\\b`).test(upd('application_forms')), `forms: browser can write ${col}`);
  for (const col of ['answers', 'generated_cover', 'model', 'suspicious', 'cover_reason', 'master_version']) assert.ok(!new RegExp(`\\b${col}\\b`).test(upd('application_drafts')), `drafts: browser can write ${col}`);
  assert.match(sql, /status in \('queued','read','needs_paste','failed','skipped'\)/);
  assert.match(sql, /status in \('queued','draft','failed','skipped','discarded'\)/);
});

test('the clock function is security definer, closed to the browser, and checks enabled', () => {
  const sql = read('supabase/migrations/0017_application_answers.sql');
  assert.match(sql, /function jobhunt\.dispatch_applications_if_waiting\(\)[\s\S]*security definer/);
  assert.match(sql, /revoke all on function jobhunt\.dispatch_applications_if_waiting\(\) from public, anon, authenticated/);
  assert.match(sql, /application_config/);
  assert.match(sql, /dispatch_workflow\('applications\.yml'\)/);
});

test('nothing in the application code can print: no console calls, no direct stream writes', () => {
  for (const f of ['workers/applications.mjs', ...APPLY]) {
    const src = read(f);
    assert.ok(!/console\.(log|info|warn|error|debug|trace)\s*\(/.test(src), `${f} calls console`);
    assert.ok(!/process\.stdout|process\.stderr/.test(src), `${f} writes to a stream`);
  }
});

test('pure application modules import no db, child_process, fs or env', () => {
  const PURE = ['schema', 'classify', 'bank', 'paste', 'prompt', 'answer-facts', 'compose', 'chars'];
  for (const name of PURE) {
    const src = read(`workers/lib/apply/${name}.mjs`);
    for (const line of src.split('\n')) {
      if (/^\s*import\b/.test(line)) assert.ok(!/db\.mjs|child_process|node:fs|node:os|node:net|node:http/.test(line), `${name}: ${line}`);
    }
    assert.ok(!/process\.env/.test(src), `${name} reads env`);
  }
});

test('the source readers send no mutation, follow no redirect and read no cookie', () => {
  for (const f of files('workers/lib/apply/sources').map((p) => relative(root, p))) {
    const src = read(f);
    assert.ok(!/mutation\s*[{(]/i.test(src.replace(/\/\/.*$/gm, '').replace(/`query[\s\S]*?`/, '')), `${f} sends a mutation`);
    assert.ok(!/redirect:\s*'follow'/.test(src), `${f} follows redirects`);
    assert.ok(!/cookie/i.test(src.replace(/\/\/.*$/gm, '')), `${f} touches cookies`);
  }
  assert.match(read('workers/lib/apply/sources/http.mjs'), /redirect: 'error'/);
});

test('the browser side never uses dangerouslySetInnerHTML or the service role key', () => {
  const dirs = [join(root, 'app/resumes'), join(root, 'app/lib/applications.ts'), join(root, 'app/actions.ts')];
  for (const d of dirs) {
    for (const f of statSync(d).isDirectory() ? walk(d) : [d]) {
      assert.ok(!readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'), `${relative(root, f)} uses dangerouslySetInnerHTML`);
    }
  }
  for (const f of walk(join(root, 'app')).filter((p) => /\.(ts|tsx)$/.test(p))) {
    assert.ok(!readFileSync(f, 'utf8').includes('SERVICE_ROLE'), `${relative(root, f)} mentions the service role key`);
  }
});

test('the new status words live in StatusBadge, the only place a status word is printed', () => {
  const ui = read('app/components/ui.tsx');
  for (const key of ['ans_ready', 'ans_edited', 'ans_needs_you', 'ans_blank', 'ans_upload', 'form_partial']) assert.match(ui, new RegExp(`${key}:`));
  for (const f of walk(join(root, 'app/resumes')).filter((p) => /.tsx$/.test(p))) {
    assert.ok(!/className="badge /.test(readFileSync(f, 'utf8')), `${relative(root, f)} prints its own badge`);
  }
});

test('no em or en dash in the new copy, code comments or docs', () => {
  const dash = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
  const mine = [
    '.github/workflows/applications.yml', 'workers/applications.mjs', 'supabase/migrations/0017_application_answers.sql',
    'app/lib/applications.ts', 'app/resumes/[id]/ApplicationTab.tsx', 'app/resumes/AnswerCard.tsx', 'app/resumes/answers/page.tsx',
    'app/resumes/answers/BankForm.tsx', 'app/resumes/[id]/cover/page.tsx', 'app/resumes/CoverLetter.tsx',
    ...files('workers/lib/apply').map((p) => relative(root, p)),
  ];
  for (const f of mine) assert.ok(!dash.test(read(f)), `${f} holds an em or en dash`);
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## Application answers'), readme.indexOf('## Checks'));
  assert.ok(section.length > 200 && !dash.test(section), 'README section');
});

test('no fixture or test contains a real name from the optional leak list', () => {
  const names = (process.env.CV_LEAK_NAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
  if (!names.length) return; // opt-in: the list lives on the PC, never in the repo
  const list = [...walk(join(root, 'workers/lib/apply')), join(root, 'workers/applications.test.mjs'), join(root, 'workers/applications.workflow.test.mjs')];
  for (const f of list) {
    const src = readFileSync(f, 'utf8').toLowerCase();
    for (const n of names) assert.ok(!src.includes(n), `${relative(root, f)} contains a listed name`);
  }
});
