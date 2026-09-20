import Link from 'next/link'
import { requireOwner } from '../lib/supabase'
import { pickQuestions, type Question } from '../lib/queries'
import { NavBar, Section, Empty, ExternalLink, relative } from '../components/ui'
import { Logo } from '../components/Logo'
import { FilterBar } from '../components/Interactive'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Questions' }

export default async function Questions({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; all?: string }>
}) {
  const sp = await searchParams
  const { supabase } = await requireOwner()

  let query = supabase.from('questions').select('*').eq('status', 'new')
  if (sp.company) query = query.eq('company', sp.company)
  const [{ data }, { data: cos }] = await Promise.all([
    query.order('rank', { ascending: false }).limit(200),
    supabase.from('companies').select('slug,logo_path'),
  ])
  const logos = new Map((cos || []).map((c) => [c.slug, c.logo_path as string | null]))

  const rows = (data as Question[]) || []
  // Without a company filter, cap per company so one noisy tracker cannot
  // swamp the list; with a filter she explicitly wants that company's wall.
  const shown = sp.all || sp.company ? rows.slice(0, 60) : pickQuestions(rows, 20, 3)
  const starred = rows.filter((q) => q.starred)

  const byCompany = rows.reduce<Record<string, number>>((acc, q) => {
    const k = q.company || 'general'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  return (
    <>
      <NavBar current="/questions" waiting={0} />
      <main className="shell">
        <h1>Questions</h1>
        <p className="sub">{rows.length} open, refreshed daily without your laptop.</p>

        <div className="row" style={{ marginBottom: 16 }}>
          <Link className="chip" href="/questions">
            all
          </Link>
          {Object.entries(byCompany)
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <Link className="chip" key={c} href={`/questions?company=${encodeURIComponent(c)}`}>
                {c} {n}
              </Link>
            ))}
        </div>

        {starred.length > 0 && !sp.company && (
          <Section title="Saved for desktop" hint="Picked on your phone to draft at the desk.">
            {starred.map((q) => (
              <QuestionRow key={q.id} q={q} logo={logos.get(q.company_slug ?? '')} />
            ))}
          </Section>
        )}

        <Section title={sp.company ? sp.company : 'Ranked'}>
          {shown.length === 0 ? (
            <Empty>Nothing open here.</Empty>
          ) : (
            <FilterBar placeholder="Filter by title, site or company…  (press /)" total={shown.length}>
              {shown.map((q) => (
                <QuestionRow key={q.id} q={q} logo={logos.get(q.company_slug ?? '')} />
              ))}
            </FilterBar>
          )}
        </Section>
      </main>
    </>
  )
}

function QuestionRow({ q, logo }: { q: Question; logo?: string | null }) {
  return (
    <article className="card" data-search={`${q.title} ${q.site ?? ''} ${q.company ?? ''} ${q.why ?? ''}`}>
      <div className="spread">
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo name={q.company} slug={q.company_slug} path={logo} size={24} />
          <Link href={`/questions/${encodeURIComponent(q.id)}`}>{q.title}</Link>
        </h3>
        <span className="score num">{q.rank ?? '—'}</span>
      </div>
      <div className="card-meta">
        {q.site} · {q.comments === 0 ? 'no replies' : `${q.comments} replies`} · {relative(q.asked_at)}
        {q.starred ? ' · saved' : ''}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="btn" href={`/questions/${encodeURIComponent(q.id)}`}>
          Open
        </Link>
        <ExternalLink href={q.url}>
          <span className="btn">Thread</span>
        </ExternalLink>
      </div>
    </article>
  )
}
