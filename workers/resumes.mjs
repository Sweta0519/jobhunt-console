#!/usr/bin/env node
// Drafts a tailored CV for each new, well-scored job, for her review.
//
//   node workers/resumes.mjs --plan                  queue sync, prints todo=N to $GITHUB_OUTPUT
//   node workers/resumes.mjs --claude-bin <path>     draft what is queued
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN, CLAUDE_CODE_OAUTH_TOKEN
//      (draft step only). One job comes from the workflow_dispatch event payload
//      (GITHUB_EVENT_PATH, inputs.job) or --job <id> on her PC, never from env:
//      Actions prints a step's env block and this log is public.
//
// This repository and its Actions logs are public. console.* is replaced before
// anything else runs, and the only output is event(): job hashes and counts.
// Job ids carry the company token, so events print a keyed hash of the id
// (hashId), never the id. scripts/job-hash.mjs maps a hash back.
// Never log a message from the database layer (it carries the failing row),
// never log anything Claude returned, never write a file.
//
// Hers only: the owner is the primary owner, always. The token that drafts for
// her must never draft for the second person.

import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { primaryOwner, forOwner, parseArgs } from './lib/db.mjs';
import { installQuietConsole, event, safeCode, hashId } from './lib/resume/safelog.mjs';
import { isDraftable } from './lib/resume/text.mjs';
import { DRAFT_SCHEMA, validateDraft } from './lib/resume/schema.mjs';
import { composeDoc, normalizeOutput } from './lib/resume/compose.mjs';
import { checkFacts } from './lib/resume/facts.mjs';
import { SYSTEM_PROMPT, buildUserMessage, buildFeedback } from './lib/resume/prompt.mjs';
import { runClaude, ClaudeError, shouldStop } from './lib/resume/claude.mjs';

installQuietConsole();

const JOB_ID_RE = /^[a-z]+:[A-Za-z0-9._-]+(:[A-Za-z0-9._-]+)?$/;
const STALE_DRAFTING_MS = 30 * 60_000;
const DAY = 86_400_000;
const QUEUE_FACTOR = 3; // queue at most 3 days of drafts
const enc = encodeURIComponent;
const now = () => new Date().toISOString();

function readConfig(raw) {
  if (!raw || raw.enabled !== true) return null;
  const int = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.trunc(Number(v)))) : d);
  const from = Date.parse(raw.from);
  const stop = Number(raw.stop_at_utilization);
  return {
    cap: int(raw.daily_cap, 5, 0, 20),
    min: int(raw.min_score, 70, 0, 100),
    // No usable "from" means the backlog is out of scope: start from now.
    from: Number.isFinite(from) ? from : Date.now(),
    model: /^[a-z0-9][a-z0-9.-]{1,60}$/.test(String(raw.model)) ? String(raw.model) : 'sonnet',
    stopAt: Number.isFinite(stop) && stop > 0 && stop <= 1 ? stop : 0.85,
  };
}

async function loadContext(db) {
  const [cfgRow] = await db.select('settings', '?select=value&key=eq.resume_config');
  const cfg = readConfig(cfgRow?.value);
  if (!cfg) return null;
  const [latest] = await db.select('master_cv', '?select=version&order=version.desc&limit=1');
  if (!latest) return null;
  return { cfg, version: latest.version };
}

const utcMidnight = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

// ---------------------------------------------------------------------------
// Plan step: no OAuth token in this process.
// ---------------------------------------------------------------------------
async function plan(db, dry, jobId) {
  const ctx = await loadContext(db);
  if (!ctx) {
    event('plan', { todo: 0 });
    setOutput('todo', 0);
    return 0;
  }
  const { cfg, version } = ctx;

  if (jobId) {
    if (!JOB_ID_RE.test(jobId)) throw Object.assign(new Error('job id'), { code: 'bad_job_id' });
    const [job] = await db.select('jobs', `?select=id&id=eq.${enc(jobId)}`);
    if (!job) throw Object.assign(new Error('job'), { code: 'job_not_found' });
    const [ex] = await db.select('resume_drafts', `?select=id,status&job_id=eq.${enc(jobId)}`);
    let todo = 1;
    if (!dry) {
      // Never overwrite a draft or an approved one: her edits live there.
      if (ex && ['draft', 'approved'].includes(ex.status)) todo = 0;
      else if (ex) await db.patch('resume_drafts', `?id=eq.${ex.id}`, { status: 'queued', reason: null, updated_at: now() });
      else await db.upsert('resume_drafts', [{ job_id: jobId, master_version: version, status: 'queued' }], { onConflict: 'owner,job_id' });
    }
    event('plan', { todo });
    setOutput('todo', todo);
    return todo;
  }

  const since = new Date(Math.max(cfg.from, Date.now() - 14 * DAY)).toISOString();
  const cols = 'id,score,first_seen_at,backlog,company_slug,draft_requested_at';
  const windowed = await db.selectAll(
    'jobs',
    `?select=${cols}&eligible=is.true&closed=is.false&status=in.(found,saved)&score=gte.${cfg.min}&first_seen_at=gte.${enc(since)}&order=id.asc`
  );
  // A role she asked a draft for jumps the queue, backlog or not.
  const requested = await db.select(
    'jobs',
    `?select=${cols}&closed=is.false&status=in.(found,saved)&draft_requested_at=not.is.null`
  );
  // Backlog rows (already open when their board was first read) are never queued on their own.
  const byId = new Map();
  for (const c of [...requested, ...windowed.filter((c) => !c.backlog)]) if (!byId.has(c.id)) byId.set(c.id, c);
  const cands = [...byId.values()].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.first_seen_at).localeCompare(String(a.first_seen_at))
  );
  const existing = new Map((await db.select('resume_drafts', '?select=id,job_id,status,reason,last_attempt_at')).map((d) => [d.job_id, d]));
  const descs = new Map((await db.selectAll('job_descriptions', '?select=job_id,kind,chars&order=job_id.asc')).map((d) => [d.job_id, d]));

  const inserts = [];
  const requeue = [];
  let skipped = 0;
  for (const c of cands) {
    const ex = existing.get(c.id);
    if (ex && ex.status === 'skipped' && ['thin_description', 'no_description'].includes(ex.reason) && isDraftable(descs.get(c.id))) requeue.push(ex.id);
  }
  // Queue ceiling: a first wave must not fill the queue with weeks of work while
  // a better role arrives tomorrow. Rows left out are looked at again next run,
  // until the 14-day window ends; nothing is marked skipped.
  const all0 = [...existing.values()];
  const stale0 = Date.now() - STALE_DRAFTING_MS;
  const waitingNow =
    all0.filter((d) => d.status === 'queued').length +
    all0.filter((d) => d.status === 'drafting' && (!d.last_attempt_at || Date.parse(d.last_attempt_at) < stale0)).length +
    requeue.length;
  let room = Math.max(0, cfg.cap * QUEUE_FACTOR - waitingNow);
  for (const c of cands) {
    const ex = existing.get(c.id);
    const d = descs.get(c.id);
    if (ex) continue;
    if (isDraftable(d)) {
      if (c.draft_requested_at) inserts.push({ job_id: c.id, master_version: version, status: 'queued' });
      else if (room > 0) { inserts.push({ job_id: c.id, master_version: version, status: 'queued' }); room--; }
    } else if (d) { inserts.push({ job_id: c.id, master_version: version, status: 'skipped', reason: 'thin_description' }); skipped++; }
    else if (Date.now() - Date.parse(c.first_seen_at) >= 3 * DAY) { inserts.push({ job_id: c.id, master_version: version, status: 'skipped', reason: 'no_description' }); skipped++; }
    // else: the description may still arrive; look again next run
  }
  if (!dry) {
    if (inserts.length) await db.upsert('resume_drafts', inserts, { onConflict: 'owner,job_id' });
    for (const id of requeue) await db.patch('resume_drafts', `?id=eq.${id}`, { status: 'queued', reason: null, updated_at: now() });
  }

  const all = [...existing.values()];
  const stale = Date.now() - STALE_DRAFTING_MS;
  const waiting =
    all.filter((d) => d.status === 'queued').length +
    all.filter((d) => d.status === 'drafting' && (!d.last_attempt_at || Date.parse(d.last_attempt_at) < stale)).length +
    inserts.filter((i) => i.status === 'queued').length +
    requeue.length;
  const used = (await db.select('resume_drafts', `?select=id&last_attempt_at=gte.${enc(utcMidnight())}`)).length;
  const todo = Math.max(0, Math.min(waiting, cfg.cap - used));
  event('plan', { todo, queued: waiting, skipped, used });
  setOutput('todo', todo);
  return todo;
}

// ---------------------------------------------------------------------------
// Draft step.
// ---------------------------------------------------------------------------
async function notify(db, dry, n) {
  if (dry) return;
  await db.upsert('notifications', [n], { onConflict: 'owner,dedupe_key' });
}

async function draft(db, { dry, jobId, bin, binArgs }) {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Object.assign(new Error('token'), { code: 'no_token' });

  const ctx = await loadContext(db);
  if (!ctx) return 0;
  const { cfg, version } = ctx;
  const today = now().slice(0, 10);
  const W = async (fn) => { if (!dry) await fn(); };
  const finish = dry ? async () => {} : await db.startRun('resumes');
  const summary = { drafted: 0, failed: 0, skipped: 0, left: 0, stopped: null };
  const patchRow = (id, body) => W(() => db.patch('resume_drafts', `?id=eq.${id}`, { ...body, updated_at: now() }));

  try {
    // Work list.
    let work;
    if (jobId) {
      if (!JOB_ID_RE.test(jobId)) throw Object.assign(new Error('job id'), { code: 'bad_job_id' });
      const [r] = await db.select('resume_drafts', `?select=id,job_id,attempts,generation&job_id=eq.${enc(jobId)}`);
      work = [r || { id: null, job_id: jobId, attempts: 0, generation: 0 }];
    } else {
      const queued = await db.select('resume_drafts', '?select=id,job_id,attempts,generation,last_attempt_at&status=eq.queued');
      const stale = await db.select('resume_drafts', `?select=id,job_id,attempts,generation,last_attempt_at&status=eq.drafting&last_attempt_at=lt.${enc(new Date(Date.now() - STALE_DRAFTING_MS).toISOString())}`);
      work = [...queued, ...stale];
    }
    const jobs = new Map();
    for (const r of work) {
      const [j] = await db.select('jobs', `?select=id,company,title,location,status,closed,score,first_seen_at,draft_requested_at&id=eq.${enc(r.job_id)}`);
      jobs.set(r.job_id, j || null);
    }
    // Retried, requeued or asked-for rows first, then by score, then newest.
    const first = (r, j) => Number(!!(r.last_attempt_at || r.generation || j?.draft_requested_at));
    work.sort((a, b) => first(b, jobs.get(b.job_id)) - first(a, jobs.get(a.job_id))
      || ((jobs.get(b.job_id)?.score ?? -1) - (jobs.get(a.job_id)?.score ?? -1))
      || String(jobs.get(b.job_id)?.first_seen_at).localeCompare(String(jobs.get(a.job_id)?.first_seen_at)));

    const used = jobId ? 0 : (await db.select('resume_drafts', `?select=id&last_attempt_at=gte.${enc(utcMidnight())}`)).length;
    const budget = jobId ? 1 : Math.max(0, cfg.cap - used);

    const masters = new Map();
    const masterOf = async (v) => {
      if (!masters.has(v)) masters.set(v, (await db.select('master_cv', `?select=doc&version=eq.${v}`))[0]?.doc);
      return masters.get(v);
    };
    const master = await masterOf(version);
    if (!master) throw Object.assign(new Error('master'), { code: 'no_master' });

    let made = 0;
    let streak = 0;
    let done = 0;
    let exitCode = 0;

    for (const row of work) {
      if (made >= budget) break;
      done++;
      const job = jobs.get(row.job_id);
      if (!job || job.closed || (!jobId && !['found', 'saved'].includes(job.status))) {
        if (row.id) await patchRow(row.id, { status: 'skipped', reason: 'job_closed' });
        summary.skipped++;
        continue;
      }
      const [desc] = await db.select('job_descriptions', `?select=description,kind,chars,sha&job_id=eq.${enc(row.job_id)}`);
      if (!isDraftable(desc)) {
        if (row.id) await patchRow(row.id, { status: 'skipped', reason: 'thin_description' });
        summary.skipped++;
        continue;
      }

      made++;
      const attempts = (row.attempts || 0) + 1;
      if (row.id) await patchRow(row.id, { status: 'drafting', last_attempt_at: now(), attempts });

      try {
        let feedback = '';
        let result = null;
        let rate = null;
        let model = cfg.model;
        for (let pass = 0; pass < 2; pass++) {
          const nonce = randomBytes(16).toString('hex');
          const res = await runClaude({
            bin, binArgs, token, schema: DRAFT_SCHEMA, system: SYSTEM_PROMPT, model: cfg.model,
            input: buildUserMessage({ master, job, description: desc.description, nonce, feedback }),
          });
          rate = res.rate;
          model = res.model || model;
          const valid = validateDraft(res.output);
          if (!valid.ok) {
            result = { hard: [{ code: 'schema_invalid', ref: valid.ref, token: '' }], soft: [] };
            feedback = buildFeedback(result.hard);
            continue;
          }
          const output = normalizeOutput(res.output);
          const doc = composeDoc(master, output);
          const facts = checkFacts({ doc, master, job, description: desc.description, output });
          result = { ...facts, doc, output };
          if (!facts.hard.length) break;
          feedback = buildFeedback(facts.hard);
        }

        if (result.hard.length) {
          const reason = result.hard.every((h) => h.code === 'schema_invalid') ? 'schema_invalid' : 'facts_failed';
          if (row.id) await patchRow(row.id, { status: 'failed', reason, fact_flags: [...result.hard, ...result.soft], attempts: 0 });
          summary.failed++;
          event('draft', { job: hashId(row.job_id), hard: result.hard.length, soft: result.soft.length });
        } else {
          const gaps = result.output.requirements.filter((r) => r.status === 'gap').map((r) => ({ text: r.text, kind: r.kind, note: r.note }));
          const generation = (row.generation || 0) + 1;
          const suspicious = result.output.suspicious_instructions === true || result.soft.some((s) => s.code === 'suspicious_posting');
          if (row.id) {
            await patchRow(row.id, {
              status: 'draft', doc: result.doc, generated_doc: result.doc,
              requirements: result.output.requirements, gaps, fact_flags: result.soft, suspicious,
              description_sha: desc.sha, model, drafted_at: now(), generation, reason: null,
              master_version: version, edited_at: null, approved_at: null, attempts: 0,
            });
            await notify(db, dry, {
              kind: 'resume_draft', severity: 'action',
              title: `Draft ready: ${job.company}: ${job.title}`,
              body: `${gaps.length} gap${gaps.length === 1 ? '' : 's'} to review`,
              url: `/resumes/${row.id}`, entity_ref: row.id, dedupe_key: `resume:${row.id}:${generation}`,
            });
          }
          summary.drafted++;
          event('draft', { job: hashId(row.job_id), hard: 0, soft: result.soft.length });
        }
        streak = 0;

        const stop = shouldStop(rate, cfg.stopAt);
        if (stop) {
          summary.stopped = stop;
          if (stop === 'overage') {
            await notify(db, dry, {
              kind: 'resume_overage', severity: 'action',
              title: 'Resume drafting stopped: usage credits are in use',
              body: 'Check your Claude usage settings before drafting resumes again.',
              url: '/resumes', entity_ref: 'claude_overage', dedupe_key: `resume_overage:${today}`,
            });
          }
          break;
        }
      } catch (e) {
        if (!(e instanceof ClaudeError)) throw e;
        const revert = row.id ? () => patchRow(row.id, { status: 'queued', attempts: row.attempts || 0, last_attempt_at: null }) : async () => {};
        if (e.code === 'usage_limit') {
          await revert();
          summary.stopped = 'usage_limit';
          break;
        }
        if (e.code === 'auth') {
          await revert();
          await notify(db, dry, {
            kind: 'resume_auth', severity: 'action',
            title: 'Resume drafting cannot sign in to Claude',
            body: 'Create a new token with claude setup-token and update the repository secret.',
            url: '/resumes', entity_ref: 'claude_token', dedupe_key: `resume_auth:${today}`,
          });
          summary.stopped = 'auth';
          exitCode = 1;
          await finish(false, summary, 'claude_auth');
          return exitCode;
        }
        if (e.code === 'tool_drift') {
          if (row.id) await patchRow(row.id, { status: 'failed', reason: 'tool_drift', attempts: 0 });
          summary.failed++;
          summary.stopped = 'tool_drift';
          await finish(false, summary, 'tool_drift');
          return 1;
        }
        // timeout, transient, cli_error, no_output, output_too_large, spawn_failed
        event('draft', { job: hashId(row.job_id), code: e.code });
        if (attempts >= 3) {
          if (row.id) await patchRow(row.id, { status: 'failed', reason: e.code, attempts: 0 });
          summary.failed++;
        } else if (row.id) {
          await patchRow(row.id, { status: 'queued' });
        }
        if (++streak >= 2) { summary.stopped = 'repeated_errors'; break; }
      }
    }

    summary.left = Math.max(0, work.length - done);
    event('done', { drafted: summary.drafted, failed: summary.failed, skipped: summary.skipped, left: summary.left, stopped: summary.stopped ?? 'none' });
    await finish(true, summary);
    return exitCode;
  } catch (e) {
    await finish(false, summary, safeCode(e)).catch(() => {});
    throw e;
  }
}

/** The manually dispatched job id, read from the event file so it is never printed. */
function requestedJob(args) {
  if (typeof args.job === 'string') return args.job.trim();
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return '';
  try {
    return String(JSON.parse(readFileSync(path, 'utf8'))?.inputs?.job ?? '').trim();
  } catch {
    return '';
  }
}

async function main() {
  const args = parseArgs();
  const dry = process.env.DRY_RUN === 'true';
  const jobId = requestedJob(args);
  const owner = await primaryOwner(); // hers only, ever
  const db = forOwner(owner.id);
  if (args.plan) {
    await plan(db, dry, jobId);
    return 0;
  }
  return draft(db, {
    dry, jobId,
    // Test hook: run a fake CLI script through node. The workflow never passes it.
    bin: args['claude-node-script'] ? process.execPath : String(args['claude-bin'] || ''),
    binArgs: args['claude-node-script'] ? [String(args['claude-node-script'])] : [],
  });
}

main()
  .then((code) => setTimeout(() => process.exit(code || 0), 200))
  .catch((e) => {
    event('failed', { code: safeCode(e) });
    setTimeout(() => process.exit(1), 200);
  });
