import { redirect } from 'next/navigation'
import { requireOwner } from './supabase'

export type Bullet = { text: string; from: string[] }
export type ResumeDoc = {
  schema: number
  name: string
  contact: { label: string; href: string | null }[]
  tagline: string
  summary: string
  skills: { id: string; label: string; items: string[] }[]
  languages: { label: string; items: string[] }
  experience: { id: string; title: string; company: string; location: string; dates: string; bullets: Bullet[] }[]
  open_source: Bullet[]
  projects: { id: string; title: string; meta: string; bullets: Bullet[] }[]
  education: { title: string; meta: string }[]
  awards: string[]
  links: { label: string; href: string }[]
}
export type MasterDoc = Omit<ResumeDoc, 'experience' | 'open_source' | 'projects'> & {
  experience: { id: string; title: string; company: string; location: string; dates: string; bullets: { id: string; text: string }[] }[]
  open_source: { id: string; label: string; text: string }[]
  projects: { id: string; title: string; meta: string; bullets: { id: string; text: string }[] }[]
}
export type Requirement = {
  text: string; kind: 'must' | 'nice'; status: 'met' | 'partial' | 'gap'; evidence: string[]; note: string
}
export type FactFlag = { code: string; ref: string; token: string }
export type ResumeDraft = {
  id: string; job_id: string; master_version: number; status: string; reason: string | null
  doc: ResumeDoc | null; requirements: Requirement[] | null
  gaps: { text: string; kind: string; note: string }[] | null
  fact_flags: FactFlag[] | null; suspicious: boolean; description_sha: string | null
  generation: number; drafted_at: string | null; edited_at: string | null
}

/** A link target is only ever https or mailto; anything else renders as plain text. */
export function safeHref(href: string | null | undefined): string | null {
  const h = String(href ?? '').trim()
  return /^(https:\/\/|mailto:)/i.test(h) ? h : null
}

/**
 * The drafts and the master CV are hers alone. requireOwner() also passes the
 * second person, and RLS would only show them an empty page, so send them away.
 */
export async function requirePrimary() {
  const ctx = await requireOwner()
  const { data } = await ctx.supabase.rpc('is_primary')
  if (!data) redirect('/jobs')
  return ctx
}

export const REASON_COPY: Record<string, string> = {
  thin_description: 'This posting only came through as a short summary, so no draft was made. Open the posting to read it.',
  no_description: 'The posting text could not be fetched.',
  job_closed: 'The role closed before a draft was made.',
  facts_failed: 'The draft used facts that are not in your CV, so it was thrown away.',
  schema_invalid: 'The draft came back malformed.',
  tool_drift: 'Drafting stopped for a safety check. See the run log.',
}
export const reasonCopy = (r: string | null) => (r && REASON_COPY[r]) || 'Drafting failed. It can be tried again.'

export const FLAG_COPY: Record<string, string> = {
  bad_ref: 'The draft points at something that is not in your CV.',
  missing_role: 'A role from your CV is missing.',
  too_many_bullets: 'A role has more bullets than in your CV.',
  skill_not_in_master: 'A skill is not in your CV.',
  number_not_in_source: 'A number does not appear in the part of your CV it came from.',
  number_word: 'A vague quantity is not in your CV.',
  date_not_in_master: 'A date is not in your CV.',
  contact_or_url: 'A link or contact detail was added.',
  markup: 'Unexpected markup in the text.',
  target_employer: 'The hiring company is named, but your CV does not name it.',
  posting_term_injected: 'A name from the posting appears that your CV does not have.',
  proper_noun: 'A name that is not in your CV.',
  posting_term: 'A word from the posting that your CV does not use.',
  unsupported_requirement: 'A requirement is marked covered but cites no evidence.',
  over_length: 'The text is longer than your CV and may not fit one page.',
  suspicious_posting: 'The posting contains text aimed at AI tools.',
  schema_invalid: 'The draft came back malformed.',
}
export const flagCopy = (code: string) => FLAG_COPY[code] || 'Check this item against your CV.'
