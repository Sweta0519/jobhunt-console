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
  id: string; person_name: string; person_url: string | null; company: string | null
  company_slug: string | null; channel: string; kind: string; body: string | null
  reason: string | null; status: string; created_at: string; sent_at: string | null
  replied_at: string | null; followup_due_at: string | null
}
export type Post = {
  id: string; post_date: string | null; format: string | null; pillar: string | null
  title: string | null; caption: Caption | null; status: string; published_url: string | null
  published_at: string | null; last_error: string | null; preview_path: string | null
}
export type Caption = { hook?: string; body?: string; cta?: string; hashtags?: string[] }

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

  const [questions, todayPost, waitingOutreach, waitingPosts, followups, newJobs, token, lastRuns] =
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
        .order('score', { ascending: false })
        .limit(3),
      supabase.from('settings').select('value').eq('key', 'linkedin_token_status').maybeSingle(),
      supabase.from('runs').select('worker,finished_at,ok,error').order('started_at', { ascending: false }).limit(8),
    ])

  return {
    today,
    answer: pickQuestions((questions.data as Question[]) || []),
    openQuestionCount: questions.data?.length ?? 0,
    todayPost: (todayPost.data as Post) || null,
    waitingOutreach: (waitingOutreach.data as Outreach[]) || [],
    waitingPosts: (waitingPosts.data as Post[]) || [],
    followups: (followups.data as Outreach[]) || [],
    newJobs: (newJobs.data as Job[]) || [],
    tokenStatus: (token.data?.value as { expires_at?: string } | undefined) ?? null,
    lastRuns: lastRuns.data ?? [],
  }
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
