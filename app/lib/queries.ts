import type { DB } from './supabase'

export type Question = {
  id: string; source: string; site: string | null; company: string | null
  company_slug: string | null; title: string; url: string; excerpt: string | null
  rank: number | null; why: string | null; comments: number; asked_at: string | null
  status: string; answered_at: string | null; answer_url: string | null
  note: string | null; starred: boolean
}
export type Job = {
  id: string; company: string; company_slug: string | null; title: string; url: string | null
  location: string | null; score: number | null; score_notes: Record<string, string> | null
  german_required: boolean; eligible: boolean | null; status: string; closed: boolean
  first_seen_at: string; posted_date: string | null
}
export type Outreach = {
  id: string; person_id: string | null; person_name: string; person_url: string | null; company: string | null
  company_slug: string | null; job_id: string | null; channel: string; kind: string
  body: string | null; reason: string | null; status: string
  created_at: string; approved_at: string | null; sent_at: string | null
  replied_at: string | null; followup_due_at: string | null
}
export type Post = {
  id: string; post_date: string | null; format: string | null; pillar: string | null
  title: string | null; caption: Caption | null; alt_text: string | null
  status: string; published_url: string | null
  published_at: string | null; last_error: string | null; preview_path: string | null
}
export type Caption = { hook?: string; body?: string; cta?: string; hashtags?: string[] }
export type Dispatch = {
  workflow: string; fired_at: string; status_code: number | null
  error: string | null; checked_at: string | null
}

const berlinToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })

/**
 * Pick what to answer. Highest rank first, capped at two per company so one
 * noisy tracker cannot fill the list — ClickHouse alone had 86 open items.
 */
export function pickQuestions(rows: Question[], limit = 3, perCompany = 2): Question[] {
  const seen: Record<string, number> = {}
  const out: Question[] = []
  for (const q of rows) {
    const key = q.company || 'general'
    if ((seen[key] || 0) >= perCompany) continue
    seen[key] = (seen[key] || 0) + 1
    out.push(q)
    if (out.length >= limit) break
  }
  return out
}

export async function getToday(supabase: DB) {
  const today = berlinToday()
  const soon = new Date(Date.now() + 86_400_000).toISOString()

  const [questions, todayPost, waitingOutreach, waitingPosts, followups, newJobs, token, lastRuns, openCount, clock] =
    await Promise.all([
      supabase
        .from('questions')
        .select('*')
        .eq('status', 'new')
        .order('rank', { ascending: false })
        .limit(40),
      supabase.from('posts').select('*').eq('post_date', today).maybeSingle(),
      supabase.from('outreach').select('*').eq('status', 'draft').order('created_at'),
      supabase.from('posts').select('*').eq('status', 'draft').order('post_date'),
      supabase
        .from('outreach')
        .select('*')
        .in('status', ['sent', 'accepted'])
        .is('replied_at', null)
        .lte('followup_due_at', soon)
        .order('followup_due_at'),
      supabase
        .from('jobs')
        .select('*')
        .eq('eligible', true)
        .eq('closed', false)
        .eq('status', 'found')
        .gte('score', 75)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(3),
      supabase.from('settings').select('value').eq('key', 'linkedin_token_status').maybeSingle(),
      supabase.from('runs').select('worker,finished_at,ok,error').order('started_at', { ascending: false }).limit(8),
      // The real total, not the length of the capped list above.
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      // The clock has to be checked here rather than by the notify worker: a
      // broken clock is precisely what stops that worker from ever running.
      supabase
        .from('clock_dispatch')
        .select('workflow,fired_at,status_code,error,checked_at')
        .order('fired_at', { ascending: false })
        .limit(20),
    ])

  return {
    today,
    answer: pickQuestions((questions.data as Question[]) || []),
    openQuestionCount: openCount.count ?? 0,
    todayPost: (todayPost.data as Post) || null,
    waitingOutreach: (waitingOutreach.data as Outreach[]) || [],
    waitingPosts: (waitingPosts.data as Post[]) || [],
    followups: (followups.data as Outreach[]) || [],
    newJobs: (newJobs.data as Job[]) || [],
    tokenStatus: (token.data?.value as { expires_at?: string } | undefined) ?? null,
    lastRuns: lastRuns.data ?? [],
    clock: clockHealth((clock.data as Dispatch[]) || []),
  }
}

/**
 * Is the scheduled work still being fired? The daily clock runs at 05:40 UTC,
 * so anything past 26 hours means a firing was missed outright. A dispatch that
 * came back with a code other than 204 means GitHub refused it, and by far the
 * likeliest cause is the token having been rotated or revoked.
 */
export function clockHealth(rows: Dispatch[]): { ok: boolean; reason: string } | null {
  const answered = rows.filter((d) => d.checked_at)
  if (answered.length === 0) return null
  const [latest] = answered
  if (latest.status_code !== 204) {
    return {
      ok: false,
      reason: `The ${latest.workflow.replace('.yml', '')} job could not be started (${
        latest.status_code ?? 'no reply'
      }). Nothing scheduled will run until that is fixed.`,
    }
  }
  const lastGood = answered.find((d) => d.status_code === 204)
  const hours = lastGood
    ? (Date.now() - new Date(lastGood.fired_at).getTime()) / 3_600_000
    : Infinity
  if (hours > 26) {
    return { ok: false, reason: 'No scheduled job has been started in over a day.' }
  }
  return { ok: true, reason: '' }
}

/** The caption exactly as it will appear on LinkedIn, not a JSON dump. */
export function captionText(c: Caption | null): string {
  if (!c) return ''
  return [c.hook, c.body, c.cta, (c.hashtags || []).map((h) => `#${h}`).join(' ')]
    .filter(Boolean)
    .join('\n\n')
}

/** Days until the LinkedIn token expires. Publishing stops silently without it. */
export function tokenDaysLeft(status: { expires_at?: string } | null): number | null {
  if (!status?.expires_at) return null
  return Math.floor((new Date(status.expires_at).getTime() - Date.now()) / 86_400_000)
}
