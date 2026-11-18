import { requireOwner } from '../../lib/supabase'
import {
  NavBar,
  PageHeader,
  Section,
  List,
  ListRow,
  Field,
  Empty,
  StatusBadge,
  ExternalLink,
} from '../../components/ui'
import { ActionButton } from '../../components/ActionButton'
import { Logo } from '../../components/Logo'
import { addCompany, decideBoard, setCompanyWatch } from '../../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Job boards' }

type Candidate = {
  company_slug: string; kind: string; token: string; status: string; board_name: string | null
  board_url: string | null; postings: number; relevant: number; sample_titles: string[] | null
  evidence: Record<string, unknown> | null
}
type Watched = { slug: string; name: string; board_kind: string; board_token: string; logo_path: string | null }

/** The evidence, in words. */
function evidenceLine(e: Record<string, unknown> | null): string {
  if (!e) return ''
  const parts: string[] = []
  if (e.nameExact) parts.push('Name matches.')
  else if (e.nameNear) parts.push('Name is close.')
  else parts.push('Name does not match.')
  if (e.domainKnown || e.domainName) parts.push('Links to their site.')
  else parts.push('No link to their site found.')
  return parts.join(' ')
}

export default async function Boards() {
  const { supabase } = await requireOwner()

  const [{ data: cands }, { data: watched }, { data: names }, { data: jobs }] = await Promise.all([
    supabase
      .from('board_candidates')
      .select('company_slug,kind,token,status,board_name,board_url,postings,relevant,sample_titles,evidence')
      .in('status', ['review', 'unsupported', 'hint'])
      .order('relevant', { ascending: false })
      .order('postings', { ascending: false })
      .limit(150),
    supabase
      .from('companies')
      .select('slug,name,board_kind,board_token,logo_path')
      .not('board_token', 'is', null)
      .is('board_block', null)
      .order('name'),
    supabase.from('companies').select('slug,name,is_target'),
    supabase.from('jobs').select('company_slug').eq('closed', false).eq('eligible', true),
  ])

  const nameOf = new Map((names || []).map((c) => [c.slug as string, c.name as string]))
  const isTarget = new Map((names || []).map((c) => [c.slug as string, !!c.is_target]))
  const open = new Map<string, number>()
  for (const j of jobs || []) if (j.company_slug) open.set(j.company_slug, (open.get(j.company_slug) || 0) + 1)

  const all = (cands as Candidate[]) || []
  const review = all.filter((c) => c.status === 'review').slice(0, 50)
  // Hints for a company with no relevant title are noise unless she marked the company.
  const byHand = all
    .filter((c) => ['unsupported', 'hint'].includes(c.status) && (c.relevant > 0 || c.status === 'unsupported' || isTarget.get(c.company_slug)))
    .slice(0, 50)
  const watching = (watched as Watched[]) || []

  return (
    <>
      <NavBar current="/companies" waiting={0} />
      <main className="shell">
        <PageHeader title="Job boards" back={{ href: '/companies', label: 'Companies' }}>
          <p>Companies the console reads directly. New roles show up here before they reach LinkedIn.</p>
        </PageHeader>

        <Section
          title="Add a company"
          hint="A website lets us look at their careers page. Added companies are searched within about 15 minutes."
        >
          <form action={add} className="card form-stack">
            <Field label="Company name" htmlFor="board-name">
              <input id="board-name" className="input" name="name" required maxLength={120} />
            </Field>
            <Field label="Website (optional)" htmlFor="board-domain" hint="For example acme.com">
              <input
                id="board-domain"
                className="input"
                name="domain"
                aria-describedby="board-domain-hint"
              />
            </Field>
            <button className="btn primary" type="submit">
              Add company
            </button>
          </form>
        </Section>

        <Section title="Needs a look">
          {review.length === 0 ? (
            <Empty>Nothing to check.</Empty>
          ) : (
            review.map((c) => (
              <article key={`${c.company_slug}|${c.kind}|${c.token}`} className="card">
                <div className="spread">
                  <h3 className="card-title">{nameOf.get(c.company_slug) ?? c.company_slug}</h3>
                  <StatusBadge status="board_review" />
                </div>
                <div className="card-meta">
                  {c.board_url ? <ExternalLink href={c.board_url}>{c.board_name || c.board_url}</ExternalLink> : c.board_name}
                  {' · '}
                  {c.postings} open, {c.relevant} relevant
                </div>
                {(c.sample_titles || []).length > 0 && (
                  <ul className="card-list card-meta">
                    {(c.sample_titles || []).slice(0, 5).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
                <p className="card-note">{evidenceLine(c.evidence)}</p>
                <div className="card-actions">
                  <ActionButton primary action={decideBoard.bind(null, c.company_slug, c.kind, c.token, true)}>
                    Right company
                  </ActionButton>
                  <ActionButton action={decideBoard.bind(null, c.company_slug, c.kind, c.token, false)}>
                    Not them
                  </ActionButton>
                </div>
              </article>
            ))
          )}
        </Section>

        <Section title="Watching">
          {watching.length === 0 ? (
            <Empty>No boards yet.</Empty>
          ) : (
            <List>
              {watching.map((c) => (
                <ListRow
                  key={c.slug}
                  lead={<Logo name={c.name} slug={c.slug} path={c.logo_path} />}
                  title={c.name}
                  meta={`${c.board_kind} · ${open.get(c.slug) ?? 0} open`}
                  trail={
                    <>
                      <StatusBadge status="board_watching" />
                      <ActionButton
                        small
                        action={setCompanyWatch.bind(null, c.slug, false)}
                        confirm={`Stop watching ${c.name}? Its open roles will close.`}
                      >
                        Stop watching
                      </ActionButton>
                    </>
                  }
                />
              ))}
            </List>
          )}
        </Section>

        <Section title="Check by hand">
          {byHand.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <List>
              {byHand.map((c) => (
                <ListRow
                  key={`${c.company_slug}|${c.kind}|${c.token}`}
                  title={nameOf.get(c.company_slug) ?? c.company_slug}
                  meta={
                    <>
                      {c.board_url && (
                        <div>
                          <ExternalLink href={c.board_url}>{c.board_url}</ExternalLink>
                        </div>
                      )}
                      {(c.sample_titles || []).slice(0, 5).map((t) => (
                        <div key={t}>{t}</div>
                      ))}
                      <div>Check this one on its own site.</div>
                    </>
                  }
                  trail={<StatusBadge status="board_unsupported" />}
                />
              ))}
            </List>
          )}
        </Section>
      </main>
    </>
  )
}

// A <form action> must resolve to void, so wrap the shared action.
async function add(form: FormData) {
  'use server'
  await addCompany(form)
}
