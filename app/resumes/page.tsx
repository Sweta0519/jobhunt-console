import Link from 'next/link'
import { requirePrimary, reasonCopy, type FactFlag } from '../lib/resumes'
import { NavBar, Section, Empty, StatusBadge, formatDay } from '../components/ui'
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
  score: number | null; closed: boolean; status: string; url: string | null
}

export default async function Resumes() {
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
    ? await supabase.from('jobs').select('id,company,company_slug,title,score,closed,status,url').in('id', ids)
    : { data: [] as JobLite[] }
  const jobs = new Map(((jobRows as JobLite[]) || []).map((j) => [j.id, j]))
  const logos = new Map((cos || []).map((c) => [c.slug as string, c.logo_path as string | null]))
  const cap = Number((cfg?.value as { daily_cap?: number } | null)?.daily_cap) || 5

  const by = (...s: string[]) => drafts.filter((d) => s.includes(d.status) && jobs.has(d.job_id))
  const review = by('draft').sort((a, b) => (jobs.get(b.job_id)!.score ?? -1) - (jobs.get(a.job_id)!.score ?? -1))
  const waiting = by('queued', 'drafting')
  const approved = by('approved')
  const notDrafted = by('skipped', 'failed', 'discarded')

  const Title = ({ d }: { d: Row }) => {
    const j = jobs.get(d.job_id)!
    return (
      <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo name={j.company} slug={j.company_slug} path={logos.get(j.company_slug ?? '')} />
        {['draft', 'approved'].includes(d.status) ? <Link href={`/resumes/${d.id}`}>{j.title}</Link> : j.title}
      </h3>
    )
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

        <Section title="To review">
          {review.length === 0 ? (
            <Empty>No drafts waiting for you.</Empty>
          ) : (
            review.map((d) => {
              const j = jobs.get(d.job_id)!
              const gaps = d.gaps?.length ?? 0
              const flags = d.fact_flags?.length ?? 0
              return (
                <article key={d.id} className="card">
                  <div className="spread">
                    <Title d={d} />
                    <span className="score num">{j.score ?? '-'}</span>
                  </div>
                  <div className="card-meta">{j.company}{d.drafted_at ? ` · drafted ${formatDay(d.drafted_at)}` : ''}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <StatusBadge status="draft_ready" />
                    <span className="chip">{gaps} gap{gaps === 1 ? '' : 's'}</span>
                    <span className="chip">{flags} flag{flags === 1 ? '' : 's'}</span>
                    {j.closed && <span className="chip">closed</span>}
                  </div>
                </article>
              )
            })
          )}
        </Section>

        <Section title="Waiting" hint={`Drafted on the next run. At most ${cap} a day.`}>
          {waiting.length === 0 ? (
            <Empty>Nothing in the queue.</Empty>
          ) : (
            waiting.map((d) => {
              const j = jobs.get(d.job_id)!
              return (
                <article key={d.id} className="card">
                  <div className="spread">
                    <Title d={d} />
                    <span className="score num">{j.score ?? '-'}</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="card-meta">{j.company}</span>
                    <StatusBadge status={d.status} />
                  </div>
                </article>
              )
            })
          )}
        </Section>

        <Section title="Approved">
          {approved.length === 0 ? (
            <Empty>Nothing approved yet.</Empty>
          ) : (
            approved.map((d) => {
              const j = jobs.get(d.job_id)!
              return (
                <article key={d.id} className="card">
                  <div className="spread">
                    <Title d={d} />
                    <span className="score num">{j.score ?? '-'}</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="card-meta">{j.company}</span>
                    <StatusBadge status="approved" />
                    {j.closed && <span className="chip">closed</span>}
                  </div>
                </article>
              )
            })
          )}
        </Section>

        <Section title="Not drafted">
          {notDrafted.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            notDrafted.map((d) => {
              const j = jobs.get(d.job_id)!
              const thin = d.reason === 'thin_description' || d.reason === 'no_description'
              const again = d.status !== 'skipped' || !thin
              return (
                <article key={d.id} className="card">
                  <div className="spread">
                    <Title d={d} />
                    <span className="score num">{j.score ?? '-'}</span>
                  </div>
                  <div className="card-meta">{j.company}</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <StatusBadge status={d.status} />
                    {d.status !== 'discarded' && <span className="card-meta">{reasonCopy(d.reason)}</span>}
                    {j.url && thin && (
                      <a className="chip" href={j.url} target="_blank" rel="noopener noreferrer">Open posting</a>
                    )}
                  </div>
                  {again && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <ActionButton action={requeueResume.bind(null, d.id)}>Draft again</ActionButton>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </Section>
      </main>
    </>
  )
}
