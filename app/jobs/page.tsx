import { requireOwner } from '../lib/supabase'
import { outcomeLine, type Job } from '../lib/queries'
import { jobPrompt } from '../lib/prompts'
import { NavBar, Section, Empty, StatusBadge, ExternalLink, formatDay } from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
import { Logo } from '../components/Logo'
import { FilterBar } from '../components/Interactive'
import { setJobStatus } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Jobs' }

export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const sp = await searchParams
  const view = sp.view || 'open'
  const { supabase } = await requireOwner()

  const [{ data }, { data: cos }] = await Promise.all([
    supabase.from('jobs').select('*').order('score', { ascending: false, nullsFirst: false }).limit(400),
    supabase.from('companies').select('slug,name,logo_path'),
  ])
  const all = (data as Job[]) || []
  const logos = new Map((cos || []).map((c) => [c.slug, c.logo_path as string | null]))

  // Rejections belong in the applied view: an application that ended is still
  // an application, and hiding it made every row read "Applied" forever.
  const APPLIED = ['applied', 'shortlisted', 'interview', 'rejected']
  const applied = all
    .filter((j) => APPLIED.includes(j.status))
    .sort((a, b) => (b.outcome_at || b.applied_at || '').localeCompare(a.outcome_at || a.applied_at || ''))
  const german = all.filter((j) => j.german_required && !j.closed)
  const open = all.filter((j) => j.eligible && !j.closed && !APPLIED.includes(j.status))
  const funnel = {
    applied: applied.length,
    interviewed: applied.filter((j) => j.interviewed || j.status === 'interview').length,
    rejected: applied.filter((j) => j.status === 'rejected').length,
    waiting: applied.filter((j) => j.status === 'applied').length,
  }

  const shown = view === 'applied' ? applied : view === 'german' ? german : open

  return (
    <>
      <NavBar current="/jobs" waiting={0} />
      <main className="shell">
        <h1>Jobs</h1>
        <p className="sub">
          Only Germany remote or EU-wide remote counts. Roles requiring German are kept
          separately, never mixed in.
        </p>

        <div className="row" style={{ marginBottom: 16 }}>
          <Tab href="/jobs" label={`Open ${open.length}`} active={view === 'open'} />
          <Tab href="/jobs?view=applied" label={`Applied ${applied.length}`} active={view === 'applied'} />
          <Tab href="/jobs?view=german" label={`Needs German ${german.length}`} active={view === 'german'} />
        </div>

        {view === 'applied' && applied.length > 0 && (
          <div className="card num" style={{ marginBottom: 14 }}>
            {funnel.applied} applied → {funnel.interviewed} interviewed → {funnel.rejected} rejected · {funnel.waiting} still waiting
          </div>
        )}

        <Section title="">
          {shown.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <FilterBar placeholder="Filter by company, title or location…  (press /)" total={shown.length}>
            {shown.map((j) => (
              <article
                key={j.id}
                className="card"
                data-search={`${j.company} ${j.title} ${j.location ?? ''} ${j.status}`}
              >
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo name={j.company} slug={j.company_slug} path={logos.get(j.company_slug ?? '')} />
                    {j.url ? <ExternalLink href={j.url}>{j.title}</ExternalLink> : j.title}
                  </h3>
                  <span className="score num">{j.score ?? '—'}</span>
                </div>
                <div className="card-meta">
                  {j.company} · {j.location || 'location unknown'}
                  {j.posted_date ? ` · posted ${formatDay(j.posted_date)}` : ''}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <StatusBadge status={j.status} />
                  {j.german_required && <span className="chip">German required</span>}
                  {j.closed && j.status !== 'rejected' && <span className="chip">closed</span>}
                  {outcomeLine(j) && <span className="card-meta">{outcomeLine(j)}</span>}
                </div>
                {j.outcome_note && view === 'applied' && (
                  <p className="sub" style={{ marginTop: 6 }}>{j.outcome_note}</p>
                )}
                {j.score_notes?.location && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    {j.score_notes.location}
                  </p>
                )}
                <div className="row" style={{ marginTop: 12 }}>
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
                  <CopyButton text={jobPrompt(j)} label="Copy prompt" />
                </div>
              </article>
            ))}
            </FilterBar>
          )}
        </Section>
      </main>
    </>
  )
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      className="chip"
      href={href}
      style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 } : undefined}
    >
      {label}
    </a>
  )
}
