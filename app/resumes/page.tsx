import Link from 'next/link'
import { requirePrimary, reasonCopy, type FactFlag } from '../lib/resumes'
import { NavBar, Empty, StatusBadge, formatDay } from '../components/ui'
import { ActionButton } from '../components/ActionButton'
import { Logo } from '../components/Logo'
import { requeueResume } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Resumes' }

type Row = {
  id: string; job_id: string; status: string; reason: string | null; master_version: number
  drafted_at: string | null; gaps: unknown[] | null; fact_flags: FactFlag[] | null; generation: number
}
type JobLite = {
  id: string; company: string; company_slug: string | null; title: string
  score: number | null; closed: boolean; status: string; url: string | null; careers_url?: string | null
}

const VIEWS = ['review', 'approved', 'waiting', 'other'] as const
type View = (typeof VIEWS)[number]

export default async function Resumes({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'review'
  const { supabase } = await requirePrimary()

  // The list never selects doc: it is large and the queue does not show it.
  const [{ data: rows }, { data: cos }, { data: cfg }] = await Promise.all([
    supabase
      .from('resume_drafts')
      .select('id,job_id,status,reason,master_version,drafted_at,gaps,fact_flags,generation')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('companies').select('slug,logo_path'),
    supabase.from('settings').select('value').eq('key', 'resume_config').maybeSingle(),
  ])
  const drafts = (rows as Row[]) || []
  const ids = [...new Set(drafts.map((d) => d.job_id))]
  const { data: jobRows } = ids.length
    ? await supabase.from('jobs').select('id,company,company_slug,title,score,closed,status,url,careers_url').in('id', ids)
    : { data: [] as JobLite[] }
  const jobs = new Map(((jobRows as JobLite[]) || []).map((j) => [j.id, j]))
  const logos = new Map((cos || []).map((c) => [c.slug as string, c.logo_path as string | null]))
  const cap = Number((cfg?.value as { daily_cap?: number } | null)?.daily_cap) || 5

  const by = (...s: string[]) => drafts.filter((d) => s.includes(d.status) && jobs.has(d.job_id))
  const review = by('draft').sort((a, b) => (jobs.get(b.job_id)!.score ?? -1) - (jobs.get(a.job_id)!.score ?? -1))
  const waiting = by('queued', 'drafting')
  const approved = by('approved')
  const notDrafted = by('skipped', 'failed', 'discarded')

  const shown = { review, approved, waiting, other: notDrafted }[view]

  const tabs: { key: View; label: string; count: number }[] = [
    { key: 'review', label: 'To review', count: review.length },
    { key: 'approved', label: 'Approved', count: approved.length },
    { key: 'waiting', label: 'Waiting', count: waiting.length },
    { key: 'other', label: 'Not drafted', count: notDrafted.length },
  ]

  const empty: Record<View, string> = {
    review: `No drafts waiting for you. New ones show up here after the next drafting run, at most ${cap} a day. Nothing is sent.`,
    approved: 'Nothing approved yet. Open a draft under To review, read it, and approve it when it looks right.',
    waiting: `Nothing in the queue. Roles that score well are drafted on the next run, at most ${cap} a day.`,
    other: 'Nothing here. If a role cannot be drafted, it shows up here with the reason.',
  }

  return (
    <>
      <NavBar current="/resumes" waiting={0} />
      <main className="shell">
        <h1>Resumes</h1>
        <p className="sub">
          A tailored resume is drafted for each new role that scores well. Nothing is sent: you read it, edit it and
          save the PDF yourself.
        </p>

        <nav className="row tabs" aria-label="Resume lists">
          {tabs.map((t) => (
            <Link
              key={t.key}
              className="chip rtab"
              href={t.key === 'review' ? '/resumes' : `/resumes?view=${t.key}`}
              aria-current={t.key === view ? 'page' : undefined}
            >
              {t.label} {t.count}
            </Link>
          ))}
        </nav>

        <section aria-label={tabs.find((t) => t.key === view)!.label} style={{ marginTop: 16 }}>
          {shown.length === 0 ? (
            <Empty>{empty[view]}</Empty>
          ) : (
            shown.map((d) => {
              const j = jobs.get(d.job_id)!
              const gaps = d.gaps?.length ?? 0
              const flags = d.fact_flags?.length ?? 0
              const open = ['draft', 'approved'].includes(d.status)
              const thin = d.reason === 'thin_description' || d.reason === 'no_description'
              const again = view === 'other' && (d.status !== 'skipped' || !thin)
              const when = d.drafted_at ? `drafted ${formatDay(d.drafted_at)}` : ''
              return (
                <article key={d.id} className={`card${open ? ' card-click' : ''}`}>
                  <div className="spread">
                    <h2 className="card-title list-title">
                      <Logo name={j.company} slug={j.company_slug} path={logos.get(j.company_slug ?? '')} />
                      {open ? (
                        <Link href={`/resumes/${d.id}`} className="card-link">{j.title}</Link>
                      ) : (
                        j.title
                      )}
                    </h2>
                    <span className="score num" aria-label={`Score ${j.score ?? 'none'}`}>{j.score ?? '-'}</span>
                  </div>
                  <div className="card-meta">{j.company}{when ? ` · ${when}` : ''}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <StatusBadge status={d.status === 'draft' ? 'draft_ready' : d.status} />
                    {open && <span className="chip">{gaps} gap{gaps === 1 ? '' : 's'}</span>}
                    {open && <span className="chip">{flags} flag{flags === 1 ? '' : 's'}</span>}
                    {j.closed && <span className="chip">closed</span>}
                  </div>
                  {view === 'other' && (
                    <p className="card-meta" style={{ margin: '8px 0 0' }}>
                      {d.status === 'discarded' ? 'You can draft this one again.' : reasonCopy(d.reason)}
                    </p>
                  )}
                  {view === 'other' && (again || ((j.careers_url || j.url) && thin)) && (
                    <div className="row card-actions" style={{ marginTop: 10 }}>
                      {(j.careers_url || j.url) && thin && (
                        <a className="btn" href={(j.careers_url || j.url)!} target="_blank" rel="noopener noreferrer">Open posting</a>
                      )}
                      {again && <ActionButton action={requeueResume.bind(null, d.id)}>Draft again</ActionButton>}
                    </div>
                  )}
                </article>
              )
            })
          )}
        </section>
      </main>
    </>
  )
}
