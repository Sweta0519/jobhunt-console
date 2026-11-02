'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from './lib/supabase'
import { checkFacts } from '../workers/lib/resume/facts.mjs'
import { splitOutsideParens } from '../workers/lib/resume/parse-master.mjs'
import type { ResumeDoc, MasterDoc, Requirement } from './lib/resumes'

/**
 * Every write in the console goes through here.
 *
 * Two rules hold throughout:
 *   1. Nothing in this file sends anything. Approving a post schedules the
 *      publish worker; approving outreach only marks the text ready for her to
 *      paste into LinkedIn herself.
 *   2. The browser session carries the write, so row level security and the
 *      column grants apply. The service role key is never in this process.
 */

const now = () => new Date().toISOString()

function ok() {
  for (const p of ['/', '/approvals', '/questions', '/outreach', '/posts', '/jobs', '/record', '/companies', '/resumes']) {
    revalidatePath(p)
  }
  return { ok: true as const }
}

function fail(message: string) {
  return { ok: false as const, message }
}

/** Outreach: draft -> approved. Still not sent; she pastes it into LinkedIn. */
export async function approveOutreach(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('outreach')
    .update({ status: 'approved', approved_at: now(), updated_at: now() })
    .eq('id', id)
    .eq('status', 'draft') // refuse to "approve" something already sent
  return error ? fail(error.message) : ok()
}

/**
 * The only place a message becomes "sent", and only because she says so after
 * pasting it into LinkedIn. Nothing automated sets this.
 */
export async function markOutreachSent(id: string) {
  const { supabase } = await requireOwner()
  const sent_at = now()
  // Follow-up lands five days later, matching the skill's f1Days.
  const followup_due_at = new Date(Date.now() + 5 * 86_400_000).toISOString()
  const { error } = await supabase
    .from('outreach')
    .update({ status: 'sent', sent_at, followup_due_at, updated_at: sent_at })
    .eq('id', id)
    .in('status', ['approved', 'draft'])
  return error ? fail(error.message) : ok()
}

export async function markOutreachReplied(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('outreach')
    .update({ status: 'replied', replied_at: now(), updated_at: now() })
    .eq('id', id)
  return error ? fail(error.message) : ok()
}

export async function skipOutreach(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('outreach')
    .update({ status: 'skipped', updated_at: now() })
    .eq('id', id)
    .in('status', ['draft', 'approved'])
  return error ? fail(error.message) : ok()
}

export async function editOutreach(id: string, body: string) {
  const { supabase } = await requireOwner()
  // Editing returns it to draft, matching the skills' behaviour: approval
  // applies to the words she read, not to whatever replaced them.
  const { error } = await supabase
    .from('outreach')
    .update({ body, status: 'draft', approved_at: null, updated_at: now() })
    .eq('id', id)
    .in('status', ['draft', 'approved'])
  return error ? fail(error.message) : ok()
}

/**
 * Posts: approving IS scheduling a real publish, so the caller must show the
 * date on the button, and a post dated today needs an explicit confirmation.
 */
export async function approvePost(id: string, confirmSameDay = false) {
  const { supabase } = await requireOwner()
  const { data: post, error: readError } = await supabase
    .from('posts')
    .select('post_date,status')
    .eq('id', id)
    .maybeSingle()
  if (readError) return fail(readError.message)
  if (!post) return fail('That post no longer exists.')
  if (post.status !== 'draft') return fail(`It is already ${post.status}.`)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
  if (post.post_date === today && !confirmSameDay) {
    return fail('This publishes today. Confirm to approve it.')
  }

  const { error } = await supabase
    .from('posts')
    .update({ status: 'approved', approved_at: now(), updated_at: now() })
    .eq('id', id)
    .eq('status', 'draft')
  return error ? fail(error.message) : ok()
}

export async function skipPost(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('posts')
    .update({ status: 'skipped', updated_at: now() })
    .eq('id', id)
    .in('status', ['draft', 'approved', 'rendered'])
  return error ? fail(error.message) : ok()
}

export async function movePost(id: string, date: string) {
  const { supabase } = await requireOwner()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Use a YYYY-MM-DD date.')
  const { error } = await supabase
    .from('posts')
    .update({ post_date: date, status: 'draft', approved_at: null, updated_at: now() })
    .eq('id', id)
  return error ? fail(error.message) : ok()
}

/**
 * Questions. Recording an answer also writes the evidence row, because the
 * record screen is what she pastes into an application.
 */
export async function markAnswered(id: string, url: string, note?: string) {
  const { supabase } = await requireOwner()
  if (!/^https?:\/\//.test(url)) return fail('Paste the link to your reply.')

  const answered_at = now()
  const { error } = await supabase
    .from('questions')
    .update({ status: 'answered', answered_at, answer_url: url, note: note || null, updated_at: answered_at })
    .eq('id', id)
  if (error) return fail(error.message)

  const { data: q } = await supabase
    .from('questions')
    .select('title,company,company_slug')
    .eq('id', id)
    .maybeSingle()
  if (q) {
    await supabase.from('contributions').insert({
      kind: 'answer',
      company: q.company,
      company_slug: q.company_slug,
      title: q.title,
      url,
      source_ref: id,
      happened_at: answered_at,
    })
  }
  return ok()
}

export async function skipQuestion(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('questions')
    .update({ status: 'skipped', updated_at: now() })
    .eq('id', id)
  return error ? fail(error.message) : ok()
}

/**
 * "Save for desktop". Claude Code is not on her phone, so triage on the train
 * has to leave something behind to pick up at the desk.
 */
export async function toggleStar(id: string, starred: boolean) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('questions')
    .update({ starred, updated_at: now() })
    .eq('id', id)
  return error ? fail(error.message) : ok()
}

export async function setJobStatus(id: string, status: string) {
  const { supabase } = await requireOwner()
  const allowed = ['found', 'saved', 'applied', 'shortlisted', 'interview', 'rejected', 'closed']
  if (!allowed.includes(status)) return fail('Unknown status.')
  const patch: Record<string, unknown> = { status, updated_at: now() }
  if (status === 'applied') patch.applied_at = now().slice(0, 10)
  // An outcome she records by hand is dated today and marked as hers, so a
  // later inbox scan refreshes only what came from the inbox.
  if (status === 'rejected' || status === 'interview') {
    patch.outcome_at = now().slice(0, 10)
    patch.outcome_source = 'manual'
    if (status === 'interview') patch.interviewed = true
  }
  const { error } = await supabase.from('jobs').update(patch).eq('id', id)
  return error ? fail(error.message) : ok()
}

/** Upstream pull requests and issues are recorded by hand. */
export async function addContribution(form: FormData) {
  const { supabase } = await requireOwner()
  const url = String(form.get('url') || '')
  const title = String(form.get('title') || '')
  const kind = String(form.get('kind') || 'pr')
  const company = String(form.get('company') || '') || null
  if (!/^https?:\/\//.test(url) || !title) return fail('A title and a link are required.')
  const { error } = await supabase
    .from('contributions')
    .insert({ kind, title, url, company, happened_at: now() })
  return error ? fail(error.message) : ok()
}

/**
 * Prep drills. "Done" is the only status that asks for anything: a level-3
 * drill produces a public artifact, so it wants the link, the same way an
 * answered question does. Lower levels may be done with a note alone.
 */
export async function setPrepStatus(id: string, status: string, evidence?: string, note?: string) {
  const { supabase } = await requireOwner()
  if (!['todo', 'doing', 'done', 'skipped'].includes(status)) return fail('Unknown status.')
  const url = (evidence || '').trim()
  if (url && !/^https?:\/\//.test(url)) return fail('Evidence should be a link.')

  if (status === 'done') {
    const { data: d } = await supabase.from('prep').select('level').eq('id', id).maybeSingle()
    if (d?.level === 3 && !url) return fail('A public drill needs the link to what you published.')
  }

  const patch: Record<string, unknown> = { status, updated_at: now() }
  if (url) patch.evidence_url = url
  if (note !== undefined) patch.note = note.trim() || null
  patch.done_at = status === 'done' ? now() : null
  const { error } = await supabase.from('prep').update(patch).eq('id', id)
  return error ? fail(error.message) : ok()
}

/** Clear notifications she has looked at. Workers write them; she only reads. */
export async function markNotificationsRead(ids: string[]) {
  const { supabase } = await requireOwner()
  if (!ids.length) return ok()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: now() })
    .in('id', ids)
  return error ? fail(error.message) : ok()
}

/**
 * Resume drafts. Same rules as everywhere here: nothing is sent, the browser
 * session carries the write, and the messages are fixed strings because a draft
 * is personal data and an error message from the database may quote it. Never
 * log a doc: Vercel keeps logs too.
 */
export async function approveResume(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('resume_drafts')
    .update({ status: 'approved', approved_at: now(), updated_at: now() })
    .eq('id', id)
    .eq('status', 'draft')
  return error ? fail('Could not approve this draft.') : ok()
}

export async function rejectResume(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('resume_drafts')
    .update({ status: 'discarded', discarded_at: now(), approved_at: null, updated_at: now() })
    .eq('id', id)
    .in('status', ['draft', 'approved'])
  return error ? fail('Could not reject this draft.') : ok()
}

/** "Draft again": the next worker run picks it up. Her edits are replaced then. */
export async function requeueResume(id: string) {
  const { supabase } = await requireOwner()
  const { error } = await supabase
    .from('resume_drafts')
    .update({ status: 'queued', approved_at: null, updated_at: now() })
    .eq('id', id)
    .in('status', ['draft', 'discarded', 'failed', 'skipped'])
  return error ? fail('Could not queue this draft.') : ok()
}

const MAX_EDIT = 800
const SEG = /^[A-Za-z0-9]{1,12}$/
const IDX = /^\d{1,2}$/

/**
 * Edit one piece of a draft. The path is checked against an allow-list, so a
 * crafted path cannot reach a pinned field (employers, titles, dates, links).
 * Her edits are flagged by the same fact check, never blocked: she is the
 * source of her own facts. Editing returns the draft to "draft" because
 * approval applies to the words she read.
 */
export async function editResumeField(id: string, path: string, text: string) {
  const { supabase } = await requireOwner()
  const value = String(text ?? '').trim()
  if (value.length > MAX_EDIT) return fail('That is too long.')

  const { data: row, error: readError } = await supabase
    .from('resume_drafts')
    .select('doc,updated_at,job_id,master_version,status,requirements')
    .eq('id', id)
    .maybeSingle()
  if (readError || !row || !row.doc) return fail('That draft no longer exists.')
  if (!['draft', 'approved'].includes(row.status)) return fail('This draft cannot be edited now.')

  const doc = structuredClone(row.doc) as ResumeDoc
  const seg = String(path).split('.')
  const [head] = seg

  if ((head === 'tagline' || head === 'summary') && seg.length === 1) {
    if (!value) return fail('This cannot be empty.')
    doc[head] = value
  } else if (head === 'skills' && seg.length === 2 && SEG.test(seg[1])) {
    const group = doc.skills.find((g) => g.id === seg[1])
    if (!group) return fail('Unknown field.')
    const items = splitOutsideParens(value) as string[]
    if (!items.length) return fail('This cannot be empty.')
    group.items = items
  } else if (head === 'open_source' && seg.length === 2 && IDX.test(seg[1])) {
    const list = doc.open_source
    const i = Number(seg[1])
    if (!list[i]) return fail('Unknown field.')
    if (value) list[i] = { ...list[i], text: value }
    else list.splice(i, 1)
  } else if ((head === 'experience' || head === 'projects') && seg.length === 3 && SEG.test(seg[1]) && IDX.test(seg[2])) {
    const owner = (doc[head] as { id: string; bullets: { text: string; from: string[] }[] }[]).find((r) => r.id === seg[1])
    const i = Number(seg[2])
    if (!owner || !owner.bullets[i]) return fail('Unknown field.')
    if (value) owner.bullets[i] = { ...owner.bullets[i], text: value }
    else if (owner.bullets.length > 1) owner.bullets.splice(i, 1)
    else return fail('The last bullet of a role cannot be removed.')
  } else {
    return fail('Unknown field.')
  }

  // Flags are recomputed against the master the draft was made from.
  const [{ data: master }, { data: job }, { data: desc }] = await Promise.all([
    supabase.from('master_cv').select('doc').eq('version', row.master_version).maybeSingle(),
    supabase.from('jobs').select('company,title').eq('id', row.job_id).maybeSingle(),
    supabase.from('job_descriptions').select('description').eq('job_id', row.job_id).maybeSingle(),
  ])
  if (!master) return fail('Could not check this edit.')
  const facts = checkFacts({
    doc,
    master: master.doc as MasterDoc,
    job: job || {},
    description: desc?.description || '',
    requirements: (row.requirements as Requirement[] | null) || null,
  })

  const stamp = now()
  const { data: saved, error } = await supabase
    .from('resume_drafts')
    .update({
      doc,
      fact_flags: [...facts.hard, ...facts.soft],
      status: 'draft',
      approved_at: null,
      edited_at: stamp,
      updated_at: stamp,
    })
    .eq('id', id)
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) return fail('Could not save this edit.')
  if (!saved?.length) return fail('This draft changed. Reload and try again.')
  return ok()
}
