import { requireOwner } from '../lib/supabase'
import { outcomeLine, FEED_CREDITS, type Job } from '../lib/queries'
import { jobPrompt } from '../lib/prompts'
import {
  NavBar,
  PageHeader,
  ViewTabs,
  Toolbar,
  ChipLink,
  Empty,
  StatusBadge,
  ExternalLink,
  formatDay,
} from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
import Link from 'next/link'
import { Logo } from '../components/Logo'
import { FilterBar } from '../components/Interactive'
import { setJobStatus, requestDraft } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Jobs' }

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; outcome?: string; year?: string; sort?: string }>
}) {
  const sp = await searchParams
  const view = sp.view || 'open'
  const outcome = sp.outcome || 'all'
  // The current year is the search that matters; older applications came in
  // with the LinkedIn export and are history, not a pipeline.
  const thisYear = String(new Date().getFullYear())
  const year = sp.year || thisYear
  const { supabase } = await requireOwner()

  // Applications are fetched by status, not by score: the rows that matter
  // most here often have no score at all (imported from the inbox, or added
  // by hand), and a score-ordered page limit silently dropped every one.
  const APPLIED = ['applied', 'shortlisted', 'interview', 'rejected']
  const [{ data: scored }, { data: apps }, { data: cos }, { data: drafts }, { data: isPrimary }] = await Promise.all([
    // Only rows a view can show: ineligible rows used to eat the 400 and push real roles off.
    supabase
      .from('jobs')
      .select('*')
      .not('status', 'in', `(${APPLIED.join(',')})`)
      .eq('closed', false)
      .or('eligible.eq.true,german_required.eq.true')
      .order('score', { ascending: false, nullsFirst: false })
      .limit(400),
    supabase.from('jobs').select('*').in('status', APPLIED),
    supabase.from('companies').select('slug,name,logo_path'),
    // Row level security returns nothing for anyone but her.
    supabase.from('resume_drafts').select('id,job_id,status').in('status', ['draft', 'approved']),
    supabase.rpc('is_primary'),
  ])
  const draftOf = new Map((drafts || []).map((d) => [d.job_id as string, d as { id: string; status: string }]))
  const all = [...((scored as Job[]) || []), ...((apps as Job[]) || [])]
  const logos = new Map((cos || []).map((c) => [c.slug, c.logo_path as string | null]))

  // Rejections belong in the applied view: an application that ended is still
  // an application, and hiding it made every row read "Applied" forever.
  const yearOf = (j: Job) => (j.applied_at || j.first_seen_at || '').slice(0, 4)
  const appliedAll = all
    .filter((j) => APPLIED.includes(j.status))
    .sort((a, b) => (b.outcome_at || b.applied_at || '').localeCompare(a.outcome_at || a.applied_at || ''))
  const years = [...new Set(appliedAll.map(yearOf).filter(Boolean))].sort().reverse()
  const applied = year === 'all' ? appliedAll : appliedAll.filter((j) => yearOf(j) === year)
  const german = all.filter((j) => j.german_required && !j.closed)
  // Newest first by default. A role posted this week she can still be early
  // to; a high-scoring one from three weeks ago has already been picked over.
  // Score remains one tap away.
  const sort = sp.sort === 'score' ? 'score' : 'newest'
  const postedAt = (j: Job) => j.posted_date || j.first_seen_at?.slice(0, 10) || ''
  const byNewest = (a: Job, b: Job) => postedAt(b).localeCompare(postedAt(a)) || (b.score ?? -1) - (a.score ?? -1)
  // Roles already open when their board was first read are kept apart: they never notified and never draft.
  const live = (j: Job) => j.eligible && !j.closed && !APPLIED.includes(j.status)
  const backlog = all.filter((j) => live(j) && j.backlog).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const open = all
    .filter((j) => live(j) && !j.backlog)
    .sort(sort === 'newest' ? byNewest : (a, b) => (b.score ?? -1) - (a.score ?? -1))
  const funnel = {
    applied: applied.length,
    interviewed: applied.filter((j) => j.interviewed || j.status === 'interview').length,
    rejected: applied.filter((j) => j.status === 'rejected').length,
    waiting: applied.filter((j) => j.status === 'applied').length,
  }

  // Within the applied view, one more cut: what happened. "Waiting" is the
  // uncomfortable one and deserves its own count.
  const byOutcome = {
    all: applied,
    waiting: applied.filter((j) => j.status === 'applied'),
    interview: applied.filter((j) => j.status === 'interview' || (j.interviewed && j.status !== 'rejected')),
    rejected: applied.filter((j) => j.status === 'rejected'),
  }
  const shown =
    view === 'applied'
      ? byOutcome[outcome as keyof typeof byOutcome] ?? applied
      : view === 'german'
        ? german
        : view === 'backlog'
          ? backlog
          : open

  return (
    <>
      <NavBar current="/jobs" waiting={0} />
      <main className="shell">
        <PageHeader title="Jobs">
          <p>
            Only Germany remote or EU-wide remote counts. Roles requiring German are kept
            separately, never mixed in.
          </p>
        </PageHeader>

        <ViewTabs
          label="Job lists"
          items={[
            { href: '/jobs', label: 'Open', count: open.length, active: view === 'open' },
            { href: '/jobs?view=applied', label: 'Applied', count: appliedAll.length, active: view === 'applied' },
            { href: '/jobs?view=german', label: 'Needs German', count: german.length, active: view === 'german' },
            ...(backlog.length > 0
              ? [{ href: '/jobs?view=backlog', label: 'Already open', count: backlog.length, active: view === 'backlog' }]
              : []),
          ]}
        />

        {view === 'open' && open.length > 0 && (
          <Toolbar
            label="Sort jobs"
            meta={
              <span className="num">
                {open.filter((j) => postedAt(j) >= new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)).length} posted in the last 7 days
              </span>
            }
          >
            <ChipLink href="/jobs" active={sort === 'newest'}>Newest first</ChipLink>
            <ChipLink href="/jobs?sort=score" active={sort === 'score'}>Best match first</ChipLink>
          </Toolbar>
        )}

        {view === 'applied' && appliedAll.length > 0 && (
          <>
            <Toolbar label="Year" scroll>
              {years.map((y) => (
                <ChipLink
                  key={y}
                  href={`/jobs?view=applied&year=${y}${outcome !== 'all' ? `&outcome=${outcome}` : ''}`}
                  count={appliedAll.filter((j) => yearOf(j) === y).length}
                  active={year === y}
                >
                  {y}
                </ChipLink>
              ))}
              <ChipLink
                href={`/jobs?view=applied&year=all${outcome !== 'all' ? `&outcome=${outcome}` : ''}`}
                count={appliedAll.length}
                active={year === 'all'}
              >
                All years
              </ChipLink>
            </Toolbar>
            <Toolbar label="Outcome" meta={<span className="num">{funnel.interviewed} reached an interview</span>}>
              <ChipLink href={`/jobs?view=applied&year=${year}`} count={byOutcome.all.length} active={outcome === 'all'}>All</ChipLink>
              <ChipLink href={`/jobs?view=applied&year=${year}&outcome=waiting`} count={byOutcome.waiting.length} active={outcome === 'waiting'}>Waiting</ChipLink>
              <ChipLink href={`/jobs?view=applied&year=${year}&outcome=interview`} count={byOutcome.interview.length} active={outcome === 'interview'}>Interviewing</ChipLink>
              <ChipLink href={`/jobs?view=applied&year=${year}&outcome=rejected`} count={byOutcome.rejected.length} active={outcome === 'rejected'}>Rejected</ChipLink>
            </Toolbar>
          </>
        )}

        {shown.length === 0 ? (
          <Empty>Nothing here.</Empty>
        ) : (
            <FilterBar
              key={`${view}|${sort}|${year}|${outcome}`}
              placeholder="Filter by company, title or location…  (press /)"
              total={shown.length}
            >
            {shown.map((j) => (
              <article
                key={j.id}
                className="card"
                data-search={`${j.company} ${j.title} ${j.location ?? ''} ${j.status}`}
              >
                <div className="spread">
                  <h3 className="card-title title-lead">
                    <Logo name={j.company} slug={j.company_slug} path={logos.get(j.company_slug ?? '')} />
                    {j.careers_url || j.url ? <ExternalLink href={(j.careers_url || j.url)!}>{j.title}</ExternalLink> : j.title}
                  </h3>
                  <span className="score num">{j.score ?? '-'}</span>
                </div>
                <div className="card-meta">
                  {j.company} · {j.location || 'location unknown'}
                  {j.posted_date ? ` · posted ${formatDay(j.posted_date)}` : ''}
                  {FEED_CREDITS[j.source] && (
                    <>
                      {' · via '}
                      <ExternalLink href={FEED_CREDITS[j.source].url}>{FEED_CREDITS[j.source].label}</ExternalLink>
                    </>
                  )}
                </div>
                <div className="card-tags">
                  <StatusBadge status={j.status} />
                  {draftOf.get(j.id) && (
                    <Link href={`/resumes/${draftOf.get(j.id)!.id}`}>
                      <StatusBadge status={draftOf.get(j.id)!.status === 'draft' ? 'draft_ready' : 'approved'} />
                    </Link>
                  )}
                  {j.backlog && <StatusBadge status="backlog" />}
                  {j.german_required && <span className="chip">German required</span>}
                  {j.closed && j.status !== 'rejected' && <span className="chip">closed</span>}
                  {outcomeLine(j) && <span className="card-meta">{outcomeLine(j)}</span>}
                </div>
                {j.outcome_note && view === 'applied' && (
                  <p className="card-note">{j.outcome_note}</p>
                )}
                {j.score_notes?.location && (
                  <p className="card-note">{j.score_notes.location}</p>
                )}
                <div className="card-actions">
                  {!APPLIED.includes(j.status) && (
                    <ActionButton action={setJobStatus.bind(null, j.id, 'applied')}>
                      Mark applied
                    </ActionButton>
                  )}
                  {['applied', 'shortlisted'].includes(j.status) && (
                    <ActionButton action={setJobStatus.bind(null, j.id, 'interview')}>
                      Interviewing
                    </ActionButton>
                  )}
                  {['applied', 'shortlisted', 'interview'].includes(j.status) && (
                    <ActionButton
                      action={setJobStatus.bind(null, j.id, 'rejected')}
                      confirm={`Record a rejection from ${j.company}?`}
                    >
                      Rejected
                    </ActionButton>
                  )}
                  {isPrimary && ['found', 'saved'].includes(j.status) && !j.closed && !draftOf.get(j.id) && (
                    j.draft_requested_at ? (
                      <StatusBadge status="queued" />
                    ) : (
                      <ActionButton action={requestDraft.bind(null, j.id)}>Draft a CV</ActionButton>
                    )
                  )}
                  <CopyButton text={jobPrompt(j)} label="Copy prompt" />
                </div>
              </article>
            ))}
            </FilterBar>
        )}
      </main>
    </>
  )
}
