import Link from 'next/link'
import { requireOwner } from '../lib/supabase'
import { pickQuestions, type Question } from '../lib/queries'
import { NavBar, PageHeader, Toolbar, ChipLink, Section, Empty, ExternalLink, relative } from '../components/ui'
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
  // Chips count every open question, not just the top 200 by rank: a company
  // whose questions all rank low would otherwise have no chip at all.
  const [{ data }, { data: cos }, { data: allOpen }] = await Promise.all([
    query.order('rank', { ascending: false }).limit(200),
    supabase.from('companies').select('slug,logo_path'),
    supabase.from('questions').select('company').eq('status', 'new').limit(5000),
  ])
  const logos = new Map((cos || []).map((c) => [c.slug, c.logo_path as string | null]))

  const rows = (data as Question[]) || []
  // Without a company filter, cap per company so one noisy tracker cannot
  // swamp the list; with a filter she explicitly wants that company's wall.
  const shown = sp.all || sp.company ? rows.slice(0, 60) : pickQuestions(rows, 20, 3)
  const starred = rows.filter((q) => q.starred)

  const byCompany = ((allOpen as { company: string | null }[]) || []).reduce<Record<string, number>>((acc, q) => {
    const k = q.company || 'general'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  return (
    <>
      <NavBar current="/questions" waiting={0} />
      <main className="shell">
        <PageHeader title="Questions" count={rows.length}>
          <p>Open questions, refreshed daily without your laptop.</p>
        </PageHeader>

        <Toolbar label="Company" scroll>
          <ChipLink href="/questions" active={!sp.company}>
            All
          </ChipLink>
          {Object.entries(byCompany)
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <ChipLink key={c} href={`/questions?company=${encodeURIComponent(c)}`} count={n} active={sp.company === c}>
                {c}
              </ChipLink>
            ))}
        </Toolbar>

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
        <h3 className="card-title title-lead">
          <Logo name={q.company} slug={q.company_slug} path={logo} size={24} />
          <Link href={`/questions/${encodeURIComponent(q.id)}`}>{q.title}</Link>
        </h3>
        <span className="score num">{q.rank ?? '-'}</span>
      </div>
      <div className="card-meta">
        {q.site} · {q.comments === 0 ? 'no replies' : `${q.comments} replies`} · {relative(q.asked_at)}
        {q.starred ? ' · saved' : ''}
      </div>
      <div className="card-actions">
        <Link className="btn" href={`/questions/${encodeURIComponent(q.id)}`}>
          Open
        </Link>
        <ExternalLink className="btn" href={q.url}>
          Thread
        </ExternalLink>
      </div>
    </article>
  )
}
