#!/usr/bin/env node
// Reads the application form of each job that has a ready CV draft and drafts
// answers and cover letters for her review. Nothing is ever submitted.
//
//   node workers/applications.mjs --plan                  queue sync and form reads, prints todo=N to $GITHUB_OUTPUT
//   node workers/applications.mjs --claude-bin <path>     draft what is queued
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN, CLAUDE_CODE_OAUTH_TOKEN
// (draft step only). There is no job input: Actions prints a step's env block and
// job ids carry the company token, and this log is public.
//
// console.* is replaced before anything else runs and the only output is event():
// job hashes and counts. Never log a message from the database layer (it carries
// the failing row), anything Claude returned, a form label or a pasted line.
//
// The answers bank is not read here, not by this file and not by any file under
// workers/. The service role has no grant on it. A draft names a bank_key and the
// console joins the value in later, in her own session.
//
// Hers only: the owner is the primary owner, always.

import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { primaryOwner, forOwner, parseArgs } from './lib/db.mjs';
import { installQuietConsole, event, safeCode, hashId } from './lib/resume/safelog.mjs';
import { runClaude, ClaudeError, shouldStop } from './lib/resume/claude.mjs';
import { buildFeedback } from './lib/resume/prompt.mjs';
import { gapMs } from './lib/boards/hosts.mjs';
import { ANSWER_SCHEMA, validateAnswers, formSha } from './lib/apply/schema.mjs';
import { classifyForm } from './lib/apply/classify.mjs';
import { normalizeOutput, composeAnswers, coverText } from './lib/apply/compose.mjs';
import { checkAnswers } from './lib/apply/answer-facts.mjs';
import { SYSTEM_PROMPT, buildUserMessage } from './lib/apply/prompt.mjs';
import { parsePasted, mergeForms } from './lib/apply/paste.mjs';
import { resolveSource, readSource } from './lib/apply/sources/index.mjs';

installQuietConsole('applications');

const STALE_DRAFTING_MS = 30 * 60_000;
const PARK_MS = 4 * 3_600_000; // after a usage limit, stay quiet for a while
const MAX_READS = 20; // form reads per run
const enc = encodeURIComponent;
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utcMidnight = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
const nextMidnight = () => new Date(Date.parse(utcMidnight()) + 86_400_000).toISOString();

function readConfig(raw) {
  if (!raw || raw.enabled !== true) return null;
  const int = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.trunc(Number(v)))) : d);
  const stop = Number(raw.stop_at_utilization);
  const cap = int(raw.daily_cap, 5, 0, 20);
  const on = (k) => raw.sources?.[k] !== false;
  // browser_mode and browser_daily_cap are reserved for a later phase and ignored here.
  return {
    cap,
    hard: Math.max(cap, int(raw.hard_cap, 12, 0, 30)),
    model: /^[a-z0-9][a-z0-9.-]{1,60}$/.test(String(raw.model)) ? String(raw.model) : 'sonnet',
    stopAt: Number.isFinite(stop) && stop > 0 && stop <= 1 ? stop : 0.7,
    sources: { greenhouse: on('greenhouse'), ashby: on('ashby'), lever: on('lever') },
  };
}

async function loadContext(db) {
  const [cfgRow] = await db.select('settings', '?select=value&key=eq.application_config');
  const cfg = readConfig(cfgRow?.value);
  if (!cfg) return null;
  return { cfg };
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function notify(db, dry, n) {
  if (dry) return;
  await db.upsert('notifications', [n], { onConflict: 'owner,dedupe_key' });
}

/** Jobs by id, in chunks so the URL stays short. */
async function jobsById(db, ids, cols) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    for (const j of await db.select('jobs', `?select=${cols}&id=in.(${part.map(enc).join(',')})`)) out.set(j.id, j);
  }
  return out;
}

const isOpen = (j) => !!j && !j.closed && ['found', 'saved'].includes(j.status);
const isRequested = (d) => !!d.cover_requested_at || (d.generation || 0) > 0;

/** Rows the draft step may take: queued and not parked, or drafting for too long. */
function waitingRows(drafts, forms) {
  const stale = Date.now() - STALE_DRAFTING_MS;
  return drafts.filter((d) => {
    const queued = d.status === 'queued' && (!d.not_before || Date.parse(d.not_before) <= Date.now());
    const lost = d.status === 'drafting' && (!d.last_attempt_at || Date.parse(d.last_attempt_at) < stale);
    if (!queued && !lost) return false;
    const f = forms.get(d.job_id);
    return f?.status === 'read' || !!d.cover_requested_at;
  });
}

/** Today's budget. A request she clicked jumps the queue but still counts against the hard cap. */
function budgets(cfg, used, rows) {
  const requested = rows.filter(isRequested).length;
  const normal = rows.length - requested;
  const allowedNormal = Math.min(normal, Math.max(0, cfg.cap - used));
  const todo = Math.min(requested + allowedNormal, Math.max(0, cfg.hard - used));
  return { todo, requested, normal, allowedNormal };
}

// ---------------------------------------------------------------------------
// Plan step: no OAuth token in this process.
// ---------------------------------------------------------------------------
async function plan(db, dry, deps = {}) {
  const ctx = await loadContext(db);
  if (!ctx) {
    event('plan', { todo: 0 });
    setOutput('todo', 0);
    setOutput('browser', 0);
    return 0;
  }
  const { cfg } = ctx;
  const W = async (fn) => { if (!dry) await fn(); };

  // 1. A form row and a draft row for every ready CV draft with an open job.
  const cvs = await db.select('resume_drafts', '?select=id,job_id,master_version,status&status=in.(draft,approved)');
  const load = async () => ({
    forms: new Map((await db.select('application_forms', '?select=id,job_id,status,reason,source,apply_url,form,form_sha,pasted_text,paste_mode,reread_requested_at,attempts')).map((f) => [f.job_id, f])),
    drafts: new Map((await db.select('application_drafts', '?select=id,job_id,resume_draft_id,status,reason,generation,last_attempt_at,not_before,cover_requested_at,attempts')).map((d) => [d.job_id, d])),
  });
  let { forms, drafts } = await load();
  const jobCols = 'id,url,company,title,location,status,closed,score';
  const jobs = await jobsById(db, [...new Set([...cvs.map((c) => c.job_id), ...drafts.keys(), ...forms.keys()])], jobCols);
  const cvByJob = new Map(cvs.map((c) => [c.job_id, c]));

  const newForms = [];
  const newDrafts = [];
  for (const cv of cvs) {
    if (!isOpen(jobs.get(cv.job_id))) continue;
    if (!forms.has(cv.job_id)) newForms.push({ job_id: cv.job_id, status: 'queued' });
    if (!drafts.has(cv.job_id)) newDrafts.push({ job_id: cv.job_id, resume_draft_id: cv.id, master_version: cv.master_version, status: 'queued' });
  }
  await W(async () => {
    await db.upsert('application_forms', newForms, { onConflict: 'owner,job_id' });
    await db.upsert('application_drafts', newDrafts, { onConflict: 'owner,job_id' });
  });
  if (!dry && (newForms.length || newDrafts.length)) ({ forms, drafts } = await load());
  else {
    for (const f of newForms) forms.set(f.job_id, { ...f, id: null, attempts: 0 });
    for (const d of newDrafts) drafts.set(d.job_id, { ...d, id: null, generation: 0, attempts: 0 });
  }

  // A queued draft whose job closed or whose CV is no longer ready is skipped.
  for (const d of drafts.values()) {
    if (!d.id) continue;
    const skip = d.status === 'queued' && (!isOpen(jobs.get(d.job_id)) ? 'job_closed' : !cvByJob.has(d.job_id) ? 'cv_not_ready' : null);
    if (skip) {
      await W(() => db.patch('application_drafts', `?id=eq.${d.id}`, { status: 'skipped', reason: skip, updated_at: now() }));
      d.status = 'skipped';
    } else if (d.status === 'skipped' && d.reason === 'cv_not_ready' && cvByJob.has(d.job_id) && isOpen(jobs.get(d.job_id))) {
      await W(() => db.patch('application_drafts', `?id=eq.${d.id}`, { status: 'queued', reason: null, resume_draft_id: cvByJob.get(d.job_id).id, updated_at: now() }));
      d.status = 'queued';
    }
  }

  // 2. Read each queued form: pasted text first, then a structured source.
  const patchForm = (f, body) => W(() => (f.id ? db.patch('application_forms', `?id=eq.${f.id}`, { ...body, updated_at: now() }) : null));
  const lastRead = new Map();
  const pace = async (kind) => {
    const gap = gapMs(kind);
    const t = lastRead.get(kind);
    if (t && Date.now() - t < gap) await sleep(gap - (Date.now() - t));
    lastRead.set(kind, Date.now());
  };
  let reads = 0;
  let readOk = 0;
  let pasted = 0;
  const shapeBroken = [...forms.values()].filter((f) => f.reason === 'shape_changed' && f.status === 'needs_paste').length;
  let shapeNow = 0;

  for (const f of [...forms.values()].filter((x) => x.status === 'queued')) {
    const job = jobs.get(f.job_id);
    if (!job) continue;
    if (f.pasted_text) {
      pasted++;
      const p = parsePasted(f.pasted_text);
      if (!p.ok) {
        await patchForm(f, { status: 'needs_paste', reason: 'paste_invalid', pasted_text: null, paste_mode: null });
        f.status = 'needs_paste';
        continue;
      }
      const merged = f.paste_mode === 'add' && f.form ? mergeForms(f.form, p.form, 'add') : p.form;
      const sha = formSha(merged);
      await patchForm(f, {
        form: merged, form_sha: sha, source: f.paste_mode === 'add' && f.source ? f.source : 'paste', completeness: merged.completeness,
        status: 'read', reason: null, pasted_text: null, paste_mode: null, reread_requested_at: null, read_at: now(), attempts: 0,
      });
      Object.assign(f, { status: 'read', form: merged, form_sha: sha });
      event('read', { source: 'paste', qs: merged.questions.length, partial: merged.completeness === 'complete' ? 0 : 1 });
      continue;
    }
    if (reads >= MAX_READS) break;
    const src = resolveSource(job, cfg);
    if (src.needs_paste) {
      // A re-read that cannot happen keeps the form she already has.
      await patchForm(f, f.form ? { status: 'read', reason: src.reason, reread_requested_at: null } : { status: 'needs_paste', reason: src.reason });
      f.status = f.form ? 'read' : 'needs_paste';
      continue;
    }
    reads++;
    await pace(src.kind);
    const res = await (deps.readSource || readSource)(src, deps.readDeps || {});
    if (res.ok) {
      readOk++;
      const sha = formSha(res.form);
      await patchForm(f, {
        form: res.form, form_sha: sha, source: res.form.source, completeness: res.form.completeness, apply_url: res.applyUrl,
        status: 'read', reason: null, reread_requested_at: null, read_at: now(), attempts: 0,
      });
      Object.assign(f, { status: 'read', form: res.form, form_sha: sha });
      event('read', { source: src.kind, qs: res.form.questions.length, partial: res.form.completeness === 'complete' ? 0 : 1 });
      continue;
    }
    event('read', { source: src.kind, code: res.reason });
    const transient = ['unreachable', 'http_error', 'too_big'].includes(res.reason);
    const attempts = (f.attempts || 0) + 1;
    if (transient && attempts < 3) {
      await patchForm(f, { attempts });
      f.attempts = attempts;
      continue;
    }
    if (res.reason === 'shape_changed') shapeNow++;
    await patchForm(f, f.form
      ? { status: 'read', reason: res.reason, reread_requested_at: null, attempts: 0 }
      : { status: 'needs_paste', reason: res.reason, attempts: 0 });
    f.status = f.form ? 'read' : 'needs_paste';
  }
  if (!dry && shapeBroken + shapeNow >= 3) {
    const day = now().slice(0, 10);
    await notify(db, dry, {
      kind: 'application_shape', severity: 'action',
      title: 'A form reader may need a fix',
      body: 'Several application forms stopped matching what the reader expects. They are waiting for pasted questions.',
      url: '/resumes', entity_ref: 'form_reader', dedupe_key: `application_shape:${day}`,
    });
  }

  // 3. A draft with no readable form is skipped, unless she asked for a cover letter.
  for (const d of drafts.values()) {
    const f = forms.get(d.job_id);
    if (!d.id || !f) continue;
    if (d.status === 'queued' && ['needs_paste', 'failed', 'skipped'].includes(f.status) && !d.cover_requested_at) {
      await W(() => db.patch('application_drafts', `?id=eq.${d.id}`, { status: 'skipped', reason: 'no_questions', updated_at: now() }));
      d.status = 'skipped';
    } else if (d.status === 'skipped' && d.reason === 'no_questions' && f.status === 'read') {
      await W(() => db.patch('application_drafts', `?id=eq.${d.id}`, { status: 'queued', reason: null, updated_at: now() }));
      d.status = 'queued';
    }
  }

  // 4. How much may run today.
  const used = (await db.select('application_drafts', `?select=id&last_attempt_at=gte.${enc(utcMidnight())}`)).length;
  const rows = waitingRows([...drafts.values()].filter((d) => d.id), forms);
  const b = budgets(cfg, used, rows);
  // What cannot run today is parked until tomorrow, so the clock stays quiet.
  const over = [...rows.filter((d) => !isRequested(d)).slice(b.allowedNormal), ...rows.filter(isRequested).slice(Math.max(0, cfg.hard - used))];
  for (const d of over) await W(() => db.patch('application_drafts', `?id=eq.${d.id}`, { not_before: nextMidnight() }));

  event('plan', { todo: b.todo, queued: rows.length, used, read: readOk, pasted });
  setOutput('todo', b.todo);
  setOutput('browser', 0);
  return b.todo;
}

// ---------------------------------------------------------------------------
// Draft step.
// ---------------------------------------------------------------------------
async function draft(db, { dry, bin, binArgs }) {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Object.assign(new Error('token'), { code: 'no_token' });

  const ctx = await loadContext(db);
  if (!ctx) return 0;
  const { cfg } = ctx;
  const today = now().slice(0, 10);
  const W = async (fn) => { if (!dry) await fn(); };
  const finish = dry ? async () => {} : await db.startRun('applications');
  const summary = { drafted: 0, failed: 0, skipped: 0, left: 0, stopped: null };
  const patchRow = (id, body, extra = '') => W(() => db.patch('application_drafts', `?id=eq.${id}${extra}`, { ...body, updated_at: now() }));

  try {
    const cols = 'id,job_id,resume_draft_id,master_version,attempts,generation,last_attempt_at,status,answers,cover_text,cover_requested_at,fact_flags,not_before';
    const drafts = await db.select('application_drafts', `?select=${cols}&status=in.(queued,drafting)`);
    const forms = new Map((await db.select('application_forms', '?select=id,job_id,status,form,form_sha')).map((f) => [f.job_id, f]));
    const work = waitingRows(drafts, forms);
    const jobs = await jobsById(db, [...new Set(work.map((r) => r.job_id))], 'id,company,title,location,status,closed,score,first_seen_at');
    work.sort((a, b) => Number(isRequested(b)) - Number(isRequested(a))
      || ((jobs.get(b.job_id)?.score ?? -1) - (jobs.get(a.job_id)?.score ?? -1))
      || String(jobs.get(b.job_id)?.first_seen_at).localeCompare(String(jobs.get(a.job_id)?.first_seen_at)));

    const used = (await db.select('application_drafts', `?select=id&last_attempt_at=gte.${enc(utcMidnight())}`)).length;
    const budget = budgets(cfg, used, work).todo;

    const masters = new Map();
    const masterOf = async (v) => {
      if (!masters.has(v)) masters.set(v, (await db.select('master_cv', `?select=doc&version=eq.${v}`))[0]?.doc);
      return masters.get(v);
    };
    // Rows still waiting when the run stops are parked, so the clock does not refire at once.
    const park = async (rows, until) => { for (const r of rows) await patchRow(r.id, { not_before: until }, '&status=eq.queued'); };

    let made = 0;
    let streak = 0;
    let done = 0;
    let exitCode = 0;

    for (const row of work) {
      if (made >= budget) break;
      done++;
      const job = jobs.get(row.job_id);
      if (!isOpen(job)) {
        await patchRow(row.id, { status: 'skipped', reason: 'job_closed' });
        summary.skipped++;
        continue;
      }
      const [cv] = await db.select('resume_drafts', `?select=id,status,master_version&id=eq.${row.resume_draft_id}`);
      if (!cv || !['draft', 'approved'].includes(cv.status)) {
        await patchRow(row.id, { status: 'skipped', reason: 'cv_not_ready' });
        summary.skipped++;
        continue;
      }
      const master = await masterOf(cv.master_version);
      if (!master) throw Object.assign(new Error('master'), { code: 'no_master' });
      const [desc] = await db.select('job_descriptions', `?select=description,sha&job_id=eq.${enc(row.job_id)}`);
      const formRow = forms.get(row.job_id);
      const form = formRow?.status === 'read' ? formRow.form : null;
      const coverOnly = !!row.cover_requested_at;

      made++;
      const attempts = (row.attempts || 0) + 1;
      await patchRow(row.id, { status: 'drafting', last_attempt_at: now(), attempts });

      const classified = form ? classifyForm(form, job) : null;
      const rules = coverOnly || !classified
        ? { items: [], toModel: [], wantsCover: coverOnly, suspicious: false }
        : classified;
      const coverAsk = classified?.coverAsk || '';
      const wantsCover = coverOnly || rules.wantsCover;
      const sent = rules.toModel.map((q) => q.id);
      const checkForm = form && !coverOnly ? form : { questions: [] };

      try {
        let output = null;
        let hard = [];
        let soft = [];
        let rate = null;
        let model = cfg.model;
        if (sent.length || wantsCover) {
          let feedback = '';
          for (let pass = 0; pass < 2; pass++) {
            const nonce = randomBytes(16).toString('hex');
            const res = await runClaude({
              bin, binArgs, token, schema: ANSWER_SCHEMA, system: SYSTEM_PROMPT, model: cfg.model,
              input: buildUserMessage({ master, job, description: desc?.description || '', questions: rules.toModel, nonce, wantsCover, coverAsk, feedback }),
            });
            rate = res.rate;
            model = res.model || model;
            const valid = validateAnswers(res.output);
            if (!valid.ok) {
              output = null;
              hard = [{ code: 'schema_invalid', ref: valid.ref, token: '' }];
              soft = [];
              feedback = buildFeedback(hard);
              continue;
            }
            output = normalizeOutput(res.output);
            const facts = checkAnswers({
              answers: output.answers, cover: wantsCover ? output.cover_letter.paragraphs : [],
              form: checkForm, master, job, description: desc?.description || '', sent,
            });
            hard = facts.hard;
            soft = facts.soft;
            // A tool the CV does not name is forced to needs_you, never retried.
            const retry = hard.filter((h) => h.code !== 'tool_unsupported' && h.code !== 'product_blocked');
            if (!retry.length) break;
            feedback = buildFeedback(retry);
          }
        }

        // One bad answer never loses the rest.
        const failed = new Map();
        let coverFailed = false;
        for (const h of hard) {
          if (h.ref.startsWith('cover.')) coverFailed = true;
          else if (h.ref.startsWith('a.')) {
            const q = h.ref.slice(2);
            if (sent.includes(q) && !['tool_unsupported', 'product_blocked'].includes(failed.get(q))) {
              failed.set(q, ['tool_unsupported', 'product_blocked'].includes(h.code) ? h.code : 'facts_failed');
            }
          }
        }
        if (sent.length && !output) for (const q of sent) failed.set(q, 'schema_invalid');
        const paragraphs = wantsCover && output && !coverFailed ? output.cover_letter.paragraphs : [];
        const cover = paragraphs.length ? coverText(paragraphs) : '';
        const coverReason = wantsCover && !cover ? (coverFailed ? 'facts_failed' : 'no_cover') : null;
        const suspicious = rules.suspicious || output?.suspicious_instructions === true || soft.some((s) => s.code === 'suspicious_posting');
        const generation = (row.generation || 0) + 1;

        let counts = { fixed: 0, drafted: 0, need: 0, blank: 0, product: 0 };
        if (coverOnly) {
          const keep = (row.fact_flags || []).filter((f) => !String(f.ref).startsWith('cover.'));
          await patchRow(row.id, {
            status: 'draft', ...(cover ? { cover_text: cover, generated_cover: cover } : {}), cover_reason: coverReason,
            cover_drafted_at: now(), cover_requested_at: null, fact_flags: [...keep, ...soft.filter((s) => String(s.ref).startsWith('cover.') || s.code === 'suspicious_posting')],
            suspicious: suspicious || undefined, model, generation, reason: null, attempts: 0, not_before: null,
            ...(row.answers ? {} : { answers: [] }),
          }, '&status=eq.drafting');
        } else {
          const composed = composeAnswers({ form: form || { questions: [] }, rules, output, failed, cover });
          counts = composed.counts;
          await patchRow(row.id, {
            status: 'draft', answers: composed.answers, edits: {}, edited_at: null,
            ...(wantsCover ? { cover_text: cover || null, generated_cover: cover || null, cover_drafted_at: cover ? now() : null } : {}),
            cover_reason: coverReason, cover_requested_at: null, fact_flags: soft, suspicious,
            description_sha: desc?.sha ?? null, form_sha: formRow?.form_sha ?? null, master_version: cv.master_version, model,
            drafted_at: now(), generation, reason: null, attempts: 0, not_before: null,
          }, '&status=eq.drafting');
        }
        await notify(db, dry, {
          kind: 'application_ready', severity: 'action',
          title: `Answers ready: ${job.company}: ${job.title}`,
          body: coverOnly ? 'Cover letter ready to read' : `${counts.need} need you, ${counts.fixed} from your saved answers`,
          url: `/resumes/${row.resume_draft_id}?tab=application`, entity_ref: row.id, dedupe_key: `application:${row.id}:${generation}`,
        });
        summary.drafted++;
        event('draft', {
          job: hashId(row.job_id), qs: sent.length, fixed: counts.fixed, drafted_q: counts.drafted, need: counts.need, blank: counts.blank, product_q: counts.product,
          cover: cover ? 1 : 0, hard: hard.length, soft: soft.length,
        });
        streak = 0;

        const stop = shouldStop(rate, cfg.stopAt);
        if (stop) {
          summary.stopped = stop;
          if (stop === 'overage') {
            await notify(db, dry, {
              kind: 'application_overage', severity: 'action',
              title: 'Application drafting stopped: usage credits are in use',
              body: 'Check your Claude usage settings before drafting answers again.',
              url: '/resumes', entity_ref: 'claude_overage', dedupe_key: `application_overage:${today}`,
            });
          }
          await park(work.slice(done), new Date(Date.now() + PARK_MS).toISOString());
          break;
        }
      } catch (e) {
        if (!(e instanceof ClaudeError)) throw e;
        const revert = () => patchRow(row.id, { status: 'queued', attempts: row.attempts || 0, last_attempt_at: null });
        if (e.code === 'usage_limit') {
          await revert();
          await park(work.slice(done - 1), new Date(Date.now() + PARK_MS).toISOString());
          summary.stopped = 'usage_limit';
          break;
        }
        if (e.code === 'auth') {
          await revert();
          await notify(db, dry, {
            kind: 'application_auth', severity: 'action',
            title: 'Application drafting cannot sign in to Claude',
            body: 'Create a new token with claude setup-token and update the repository secret.',
            url: '/resumes', entity_ref: 'claude_token', dedupe_key: `application_auth:${today}`,
          });
          summary.stopped = 'auth';
          exitCode = 1;
          await finish(false, summary, 'claude_auth');
          return exitCode;
        }
        if (e.code === 'tool_drift') {
          await patchRow(row.id, { status: 'failed', reason: 'tool_drift', attempts: 0 });
          summary.failed++;
          summary.stopped = 'tool_drift';
          event('draft', { job: hashId(row.job_id), drift: 1 });
          await finish(false, summary, 'tool_drift');
          return 1;
        }
        // timeout, transient, cli_error, no_output, output_too_large, spawn_failed
        event('draft', { job: hashId(row.job_id), code: e.code });
        if (attempts >= 3) {
          await patchRow(row.id, { status: 'failed', reason: e.code, attempts: 0 });
          summary.failed++;
        } else await patchRow(row.id, { status: 'queued' });
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

async function main() {
  const args = parseArgs();
  const dry = process.env.DRY_RUN === 'true';
  const owner = await primaryOwner(); // hers only, ever
  const db = forOwner(owner.id);
  if (args.plan) {
    await plan(db, dry);
    return 0;
  }
  return draft(db, {
    dry,
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
