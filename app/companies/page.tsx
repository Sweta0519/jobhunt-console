import Link from 'next/link'
import { requireOwner } from '../lib/supabase'
import { NavBar, Section, Empty, formatDay } from '../components/ui'
import { Logo } from '../components/Logo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Companies' }

/**
 * Only companies with a live application appear here. The LinkedIn export
 * brought in dozens of old QA and IT-support applications that are not the
 * role being targeted; listing them would bury the three that matter under
 * thirty that do not.
 */
const LIVE = ['applied', 'shortlisted', 'interview']

type JobRow = { company: string; company_slug: string | null; status: string; applied_at: string | null; title: string }

export default async function Companies() {
  const { supabase } = await requireOwner()

  const [{ data: jobs }, { data: cos }, { data: prep }, { data: contribs }, { data: outreach }] =
    await Promise.all([
      supabase.from('jobs').select('company,company_slug,status,applied_at,title').in('status', LIVE),
      supabase.from('companies').select('slug,name,logo_path'),
      supabase.from('prep').select('company_slug,status,level'),
      supabase.from('contributions').select('company,company_slug'),
      supabase.from('outreach').select('company_slug,status'),
    ])

  const names = new Map((cos || []).map((c) => [c.slug as string, c.name as string]))
  const logos = new Map((cos || []).map((c) => [c.slug as string, c.logo_path as string | null]))

  const bySlug = new Map<string, JobRow[]>()
  for (const j of (jobs as JobRow[]) || []) {
    if (!j.company_slug) continue
    bySlug.set(j.company_slug, [...(bySlug.get(j.company_slug) || []), j])
  }

  const rows = [...bySlug.entries()]
    .map(([slug, js]) => {
      const drills = (prep || []).filter((p) => p.company_slug === slug)
      const done = drills.filter((p) => p.status === 'done').length
      const tickets = drills.filter((p) => p.level === 2)
      const ticketsDone = tickets.filter((p) => p.status === 'done').length
      const work = (contribs || []).filter((c) => c.company === slug || c.company_slug === slug).length
      const contacts = (outreach || []).filter((o) => o.company_slug === slug && o.status !== 'skipped').length
      const latest = js.map((j) => j.applied_at).filter(Boolean).sort().at(-1) ?? null
      return { slug, name: names.get(slug) ?? js[0].company, js, drills: drills.length, done, tickets: tickets.length, ticketsDone, work, contacts, latest }
    })
    // Companies with a prep plan first, then by most recent application.
    .sort((a, b) => (b.drills > 0 ? 1 : 0) - (a.drills > 0 ? 1 : 0) || (b.latest ?? '').localeCompare(a.latest ?? ''))

  const planned = rows.filter((r) => r.drills > 0)
  const rest = rows.filter((r) => r.drills === 0)

  return (
    <>
      <NavBar current="/companies" waiting={0} />
      <main className="shell">
        <h1>Companies</h1>
        <p className="sub">
          Where you have applied, and how ready you are for the interview there. A drill
          counts as done only with evidence behind it.
        </p>

        <Section
          title="Preparing"
          hint="Level 2 drills are the ones that matter most: reproduce a realistic ticket, diagnose it with the tool, write the reply."
        >
          {planned.length === 0 ? (
            <Empty>No prep plans yet.</Empty>
          ) : (
            planned.map((r) => <CompanyCard key={r.slug} r={r} logo={logos.get(r.slug) ?? null} />)
          )}
        </Section>

        {rest.length > 0 && (
          <Section title="Other applications" hint="Live applications without a prep plan.">
            {rest.map((r) => <CompanyCard key={r.slug} r={r} logo={logos.get(r.slug) ?? null} />)}
          </Section>
        )}
      </main>
    </>
  )
}

function CompanyCard({
  r,
  logo,
}: {
  r: {
    slug: string; name: string; js: JobRow[]; drills: number; done: number
    tickets: number; ticketsDone: number; work: number; contacts: number; latest: string | null
  }
  logo: string | null
}) {
  const pct = r.drills ? Math.round((r.done / r.drills) * 100) : 0
  return (
    <article className="card">
      <div className="spread">
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo name={r.name} slug={r.slug} path={logo} size={26} />
          <Link href={`/companies/${encodeURIComponent(r.slug)}`}>{r.name}</Link>
        </h3>
        {r.drills > 0 && (
          <span className="num" style={{ fontSize: 13, color: 'var(--muted)' }}>
            {r.done}/{r.drills} drills
          </span>
        )}
      </div>
      <div className="card-meta">
        {r.js.length} application{r.js.length === 1 ? '' : 's'}
        {r.latest ? `, latest ${formatDay(r.latest)}` : ''} · {r.work} public artifact{r.work === 1 ? '' : 's'} ·{' '}
        {r.contacts} contact{r.contacts === 1 ? '' : 's'}
      </div>
      {r.drills > 0 && (
        <>
          <div
            aria-hidden="true"
            style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 12, overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <div className="card-meta" style={{ marginTop: 6 }}>
            Tickets: {r.ticketsDone}/{r.tickets} done
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn primary" href={`/companies/${encodeURIComponent(r.slug)}`}>
          Open
        </Link>
      </div>
    </article>
  )
}
