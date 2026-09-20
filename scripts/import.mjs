#!/usr/bin/env node
// One-time import: the three skills' JSON files -> Supabase `jobhunt` schema.
//
//   node scripts/import.mjs --dry-run            transform only, write out/import-preview.json
//   node scripts/import.mjs                      transform and upsert
//
// Reads (an allowlist — nothing else is opened):
//   ~/.linkedin-jobnet/data.json      jobs, people, connections, companies
//   ~/.linkedin-jobnet/queue.json     outreach
//   ~/.linkedin-content/posts.json    posts
//   ~/.visibility/questions.json      questions
//
// Never reads any config.json or auth.json: those hold the LinkedIn client
// secret, the LinkedIn access token and the GitHub token.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { upsert, parseArgs } from '../workers/lib/db.mjs';

const HOME = homedir();
const SRC = {
  jobnet: join(HOME, '.linkedin-jobnet', 'data.json'),
  queue: join(HOME, '.linkedin-jobnet', 'queue.json'),
  posts: join(HOME, '.linkedin-content', 'posts.json'),
  questions: join(HOME, '.visibility', 'questions.json'),
};

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const iso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const day = (v) => (iso(v) ? iso(v).slice(0, 10) : null);
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s || null);

/** Slug for a company. Reuses the skills' existing `companyNorm` when present. */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Her hard rule: only Germany-remote or EU/EMEA-wide remote count, and a posting
 * that requires German is kept but flagged rather than dropped.
 */
export function isEligible(job) {
  if (job.germanRequired) return false;
  if (job.remote === false) return false;
  const loc = `${job.location || ''} ${job.workplaceType || ''}`.toLowerCase();
  if (!loc) return job.remote === true;
  const ok = /german|deutschland|\beu\b|europe|european union|emea|remote/.test(loc);
  const excluded = /united states|\busa\b|canada|india|australia|singapore|brazil/.test(loc);
  return ok && !excluded;
}

/** Empty slugs would violate the foreign key, so they become null. */
const nz = (v) => (v && String(v).trim() ? String(v).trim() : null);

export function transform({ jobnet, queue, posts, questions }) {
  const companies = new Map();
  const touch = (slug, name, patch = {}) => {
    if (!slug) return;
    const prev = companies.get(slug) || { slug, name: name || slug, is_target: false, weight: 0 };
    companies.set(slug, { ...prev, ...patch, name: prev.name || name || slug });
  };

  for (const [slug, c] of Object.entries(jobnet?.companies || {})) {
    touch(slug, c.name, { is_target: c.origin === 'applied' || c.origin === 'saved' });
  }

  const jobs = (jobnet?.jobs || []).map((j) => {
    const slug = nz(j.companyNorm) || nz(slugify(j.company));
    touch(slug, j.company);
    return {
      id: j.id,
      source: j.source === 'manual' ? 'manual' : 'linkedin-export',
      company_slug: slug,
      company: j.company || slug || '(unknown company)',
      title: j.title || '(untitled)',
      url: j.url || null,
      location: j.location || null,
      workplace_type: j.workplaceType || null,
      posted_date: day(j.date),
      excerpt: clip(j.description, 400),
      score: typeof j.score === 'number' ? j.score : null,
      score_breakdown: j.scoreBreakdown || null,
      score_notes: j.scoreNotes || null,
      german_required: !!j.germanRequired,
      remote: j.remote ?? null,
      eligible: isEligible(j),
      status: ['saved', 'applied', 'shortlisted', 'interview'].includes(j.status) ? j.status : 'found',
      applied_at: j.status === 'applied' ? day(j.date) : null,
      closed: !!j.closed,
    };
  });

  const people = [];
  const seenPerson = new Set();
  const addPerson = (p) => {
    if (!p.id || seenPerson.has(p.id)) return;
    seenPerson.add(p.id);
    people.push(p);
  };
  for (const p of jobnet?.people || []) {
    const slug = nz(p.companyNorm);
    if (slug) touch(slug, p.companyNorm);
    addPerson({
      id: p.id,
      name: p.name || '(unknown)',
      url: p.url || null,
      headline: clip(p.headline, 300),
      company_slug: slug,
      company: p.companyNorm || null,
      position: null,
      relationship: p.roleKind === 'hr' ? 'recruiter' : p.degree === 1 ? 'connection' : 'found',
      tier: typeof p.tier === 'number' ? p.tier : null,
      notes: p.reason || null,
    });
  }
  for (const c of jobnet?.connections || []) {
    const slug = nz(c.companyNorm) || nz(slugify(c.company));
    if (slug) touch(slug, c.company);
    addPerson({
      id: c.id,
      name: c.name || '(unknown)',
      url: c.url || null,
      headline: null,
      company_slug: slug,
      company: c.company || null,
      position: c.position || null,
      relationship: 'connection',
      tier: 1,
      connected_on: day(c.connectedOn),
      notes: null,
    });
  }

  const outreach = (queue?.items || []).map((q) => ({
    id: q.id,
    person_id: seenPerson.has(q.personId) ? q.personId : null,
    person_name: q.personName || '(unknown)',
    person_url: q.personUrl || null,
    company_slug: nz(q.companyNorm),
    company: q.companyName || null,
    job_id: q.jobId || null,
    channel: ['connect_note', 'connect_blank', 'message'].includes(q.channel) ? q.channel : 'message',
    kind: ['initial', 'intro', 'F1', 'F2'].includes(q.kind) ? q.kind : 'initial',
    parent_id: q.parentId || null,
    body: q.text || null,
    reason: q.reason || null,
    status: ['draft', 'approved', 'sent', 'accepted', 'replied', 'skipped', 'closed'].includes(q.status)
      ? q.status
      : 'draft',
    created_at: iso(q.createdAt),
    approved_at: iso(q.approvedAt),
    sent_at: iso(q.sentAt),
    replied_at: iso(q.repliedAt),
    followup_due_at: iso(q.followupDueAt),
  }));

  const postRows = (posts?.items || []).map((p) => ({
    id: p.id,
    post_date: day(p.date),
    format: ['card', 'deck', 'text'].includes(p.format) ? p.format : 'text',
    pillar: p.pillar || null,
    title: p.title || null,
    size: p.size || null,
    card: p.card || null,
    slides: p.slides || null,
    caption: p.caption || null,
    alt_text: p.altText || null,
    sources: p.sources || null,
    status: ['draft', 'approved', 'rendered', 'published', 'skipped', 'failed'].includes(p.status)
      ? p.status
      : 'draft',
    published_urn: p.publishedUrn || null,
    published_url: p.publishedUrl || null,
    published_at: iso(p.publishedAt),
    last_error: p.lastError || null,
    created_at: iso(p.createdAt),
    approved_at: iso(p.approvedAt),
    rendered_at: iso(p.renderedAt),
  }));

  const questionRows = (questions?.items || []).map((q) => {
    const slug = q.company && q.company !== 'general' ? nz(slugify(q.company)) : null;
    if (slug) touch(slug, q.company, { weight: 10 });
    return {
      id: q.id,
      source: q.source,
      site: q.site || null,
      company_slug: slug,
      company: q.company || null,
      title: q.title || '(untitled)',
      url: q.url,
      excerpt: clip(q.excerpt, 400),
      author: q.author || null,
      asked_at: iso(q.createdAt),
      score: typeof q.score === 'number' ? q.score : null,
      comments: typeof q.comments === 'number' ? q.comments : 0,
      has_answer: !!q.hasAnswer,
      tags: Array.isArray(q.tags) ? q.tags : null,
      rank: typeof q.rank === 'number' ? q.rank : null,
      why: q.why || null,
      status: ['new', 'answered', 'skipped'].includes(q.status) ? q.status : 'new',
      answered_at: iso(q.answeredAt),
      answer_url: q.answerUrl || null,
      note: q.note || null,
    };
  });

  // Evidence list: answered questions with a link, plus published posts.
  const contributions = [];
  for (const q of questionRows) {
    if (q.status === 'answered' && q.answer_url) {
      // A `manual:` id is an upstream PR or issue, recorded as
      // `manual:<owner>/<repo>#<n>`; its company is the repo owner.
      const manual = q.id.startsWith('manual:') ? q.id.slice(7).split('/')[0] : null;
      const slug = q.company_slug || (manual ? slugify(manual) : null);
      if (slug && manual) touch(slug, manual, { weight: 10 });
      contributions.push({
        kind: manual ? 'pr' : 'answer',
        company_slug: slug,
        company: q.company || manual || null,
        title: q.title,
        url: q.answer_url,
        source_ref: q.id,
        happened_at: q.answered_at || new Date().toISOString(),
      });
    }
  }
  for (const p of postRows) {
    if (p.status === 'published' && p.published_url) {
      contributions.push({
        kind: 'post',
        company_slug: null,
        company: null,
        title: p.title || p.id,
        url: p.published_url,
        source_ref: p.id,
        happened_at: p.published_at || new Date().toISOString(),
      });
    }
  }

  return {
    companies: [...companies.values()],
    jobs,
    people,
    outreach,
    posts: postRows,
    questions: questionRows,
    contributions,
  };
}

async function main() {
  const args = parseArgs();
  const data = transform({
    jobnet: readJson(SRC.jobnet),
    queue: readJson(SRC.queue),
    posts: readJson(SRC.posts),
    questions: readJson(SRC.questions),
  });

  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  console.log('transformed:', JSON.stringify(counts));

  if (args['dry-run']) {
    mkdirSync('out', { recursive: true });
    writeFileSync('out/import-preview.json', JSON.stringify(data, null, 2));
    console.log('dry run -> out/import-preview.json (nothing uploaded)');
    return;
  }

  // Order matters: companies and people are referenced by foreign keys.
  // Each table's conflict target is its primary key, which is not always `id`.
  const CONFLICT = { companies: 'slug', contributions: 'url' };
  for (const table of ['companies', 'people', 'jobs', 'outreach', 'posts', 'questions', 'contributions']) {
    const n = await upsert(table, data[table], { onConflict: CONFLICT[table] || 'id' });
    console.log(`${table}: ${n} row(s)`);
  }
}

// Windows: import.meta.url is file:///C:/... so build the comparison properly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => exitSoon(0))
    .catch((e) => {
      console.error(e.message);
      exitSoon(1);
    });
}

// Node 25 trips a libuv assertion when the process exits immediately after a
// fetch; a tick of delay lets the handles close.
function exitSoon(code) {
  setTimeout(() => process.exit(code), 150);
}
