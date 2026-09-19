import { requireOwner } from '../lib/supabase'
import type { Job } from '../lib/queries'
import { jobPrompt } from '../lib/prompts'
import { NavBar, Section, Empty, StatusBadge, ExternalLink, formatDay } from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
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

  const { data } = await supabase
    .from('jobs')
    .select('*')
    .order('score', { ascending: false })
    .limit(400)
  const all = (data as Job[]) || []

  const applied = all.filter((j) => ['applied', 'shortlisted', 'interview'].includes(j.status))
  const german = all.filter((j) => j.german_required && !j.closed)
  const open = all.filter(
    (j) => j.eligible && !j.closed && !['applied', 'shortlisted', 'interview'].includes(j.status)
  )

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

        <Section title="">
          {shown.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            shown.map((j) => (
              <article key={j.id} className="card">
                <div className="spread">
                  <h3 className="card-title">
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
                  {j.closed && <span className="chip">closed</span>}
                </div>
                {j.score_notes?.location && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    {j.score_notes.location}
                  </p>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  {j.status !== 'applied' && (
                    <ActionButton action={setJobStatus.bind(null, j.id, 'applied')}>
                      Mark applied
                    </ActionButton>
                  )}
                  <CopyButton text={jobPrompt(j)} label="Copy prompt" />
                </div>
              </article>
            ))
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
