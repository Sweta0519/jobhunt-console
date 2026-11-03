import type { requirePrimary } from '../lib/resumes'

type Supabase = Awaited<ReturnType<typeof requirePrimary>>['supabase']

/**
 * Ids of the drafts still to review, best match first: the same order as the
 * To review tab, so Previous and Next walk the list the way she sees it.
 */
export async function reviewQueue(supabase: Supabase): Promise<string[]> {
  const { data: rows } = await supabase
    .from('resume_drafts')
    .select('id,job_id')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(300)
  const drafts = (rows as { id: string; job_id: string }[]) || []
  if (!drafts.length) return []
  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id,score')
    .in('id', [...new Set(drafts.map((d) => d.job_id))])
  const score = new Map(((jobRows as { id: string; score: number | null }[]) || []).map((j) => [j.id, j.score ?? -1]))
  return drafts
    .filter((d) => score.has(d.job_id))
    .sort((a, b) => score.get(b.job_id)! - score.get(a.job_id)!)
    .map((d) => d.id)
}
