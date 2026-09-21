import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOwner } from '../../lib/supabase'
import type { Outreach } from '../../lib/queries'
import { prepPrompt, type Drill } from '../../lib/prompts'
import { NavBar, Section, Empty, StatusBadge, ExternalLink, formatDay, relative } from '../../components/ui'
import { CopyButton } from '../../components/ActionButton'
import { DrillActions } from '../../components/DrillActions'
import { Logo } from '../../components/Logo'
import { setPrepStatus } from '../../actions'

export const dynamic = 'force-dynamic'

type JobRow = {
  id: string; title: string; url: string | null; location: string | null; status: string
  score: number | null; applied_at: string | null; first_seen_at: string; closed: boolean
}
type Contribution = { id: string; kind: string; title: string; url: string; happened_at: string }
type Person = { id: string; name: string; url: string | null; headline: string | null; position: string | null; relationship: string | null }

const LEVEL: Record<number, { label: string; hint: string }> = {
  1: { label: 'Know it', hint: 'Run the thing and see the moving parts.' },
  2: { label: 'Ticket', hint: 'Reproduce a realistic failure, diagnose it with the tool, write the customer reply. These are what a live round tests.' },
  3: { label: 'Public', hint: 'An artifact with a link, or a story with evidence you can point at.' },
}

/**
 * The dossier for one company: every application, the people spoken to, the
 * public work done in their community, and the hands-on drills for their
 * interview. Everything a re-application or an interview prep session needs on
 * one page, which is also the argument for reapplying somewhere that said no.
 */
export default async function Company({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase } = await requireOwner()

  const [{ data: co }, { data: jobs }, { data: prep }, { data: contribs }, { data: outreach }, { data: people }] =
    await Promise.all([
      supabase.from('companies').select('slug,name,logo_path,domain').eq('slug', slug).maybeSingle(),
      supabase
        .from('jobs')
        .select('id,title,url,location,status,score,applied_at,first_seen_at,closed')
        .eq('company_slug', slug)
        .order('applied_at', { ascending: false, nullsFirst: false })
        .order('score', { ascending: false, nullsFirst: false }),
      supabase.from('prep').select('*').eq('company_slug', slug).order('seq'),
      supabase
        .from('contributions')
        .select('id,kind,title,url,happened_at')
        .or(`company.eq.${slug},company_slug.eq.${slug}`)
        .order('happened_at', { ascending: false }),
      supabase.from('outreach').select('*').eq('company_slug', slug).order('created_at', { ascending: false }),
      supabase.from('people').select('id,name,url,headline,position,relationship').eq('company_slug', slug).order('tier', { nullsFirst: false }).limit(12),
    ])

  const js = (jobs as JobRow[]) || []
  if (!co && js.length === 0) notFound()
  const name = (co?.name as string) || slug

  const drills = (prep as Drill[]) || []
  const done = drills.filter((d) => d.status === 'done').length
  const applied = js.filter((j) => ['applied', 'shortlisted', 'interview'].includes(j.status))
  const open = js.filter((j) => j.status === 'found' && !j.closed)
  const work = (contribs as Contribution[]) || []
  const talks = (outreach as Outreach[]) || []
  const ppl = (people as Person[]) || []

  const evidenceMarkdown = drills
    .filter((d) => d.status === 'done')
    .map((d) => `- ${d.title}${d.evidence_url ? ` — ${d.evidence_url}` : ''}${d.note ? `\n  ${d.note}` : ''}`)
    .join('\n')

  return (
    <>
      <NavBar current="/companies" waiting={0} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 20 }}>
          <Link href="/companies">← Companies</Link>
        </p>
        <div className="spread">
          <h1 style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Logo name={name} slug={slug} path={(co?.logo_path as string | null) ?? null} size={34} />
            {name}
          </h1>
          {drills.length > 0 && (
            <span className="num" style={{ color: 'var(--muted)' }}>
              {done}/{drills.length} drills done
            </span>
          )}
        </div>
        <p className="sub">
          {applied.length} application{applied.length === 1 ? '' : 's'} · {work.length} public artifact
          {work.length === 1 ? '' : 's'} · {talks.filter((t) => t.status !== 'skipped').length} contact
          {talks.filter((t) => t.status !== 'skipped').length === 1 ? '' : 's'}
          {open.length > 0 ? ` · ${open.length} open role${open.length === 1 ? '' : 's'} not applied to` : ''}
        </p>

        {drills.length > 0 && (
          <Section
            title="Prep"
            hint="Calibrated to the posting you applied to. Level 2 is the interview: one realistic ticket, diagnosed live, with the reply written."
          >
            {[1, 2, 3].map((lvl) => {
              const group = drills.filter((d) => d.level === lvl)
              if (!group.length) return null
              return (
                <div key={lvl} style={{ marginBottom: 18 }}>
                  <h3 style={{ margin: '8px 0 4px' }}>
                    {LEVEL[lvl].label}{' '}
                    <span className="num" style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>
                      {group.filter((d) => d.status === 'done').length}/{group.length}
                    </span>
                  </h3>
                  <p className="sub" style={{ marginTop: 0 }}>{LEVEL[lvl].hint}</p>
                  {group.map((d) => (
                    <article key={d.id} className="card" style={d.status === 'skipped' ? { opacity: 0.6 } : undefined}>
                      <div className="spread">
                        <h4 className="card-title" style={{ margin: 0 }}>{d.title}</h4>
                        <StatusBadge status={d.status} />
                      </div>
                      <p className="sub" style={{ marginTop: 8 }}>
                        <strong>Why:</strong> {d.why}
                      </p>
                      <div className="card-body">{d.how}</div>
                      {d.note && (
                        <p style={{ marginTop: 10, marginBottom: 0 }}>
                          <strong>Found:</strong> {d.note}
                        </p>
                      )}
                      {d.evidence_url && (
                        <p className="card-meta" style={{ marginTop: 6 }}>
                          <ExternalLink href={d.evidence_url}>{d.evidence_url}</ExternalLink>
                          {d.done_at ? ` · ${relative(d.done_at)}` : ''}
                        </p>
                      )}
                      <div className="row" style={{ marginTop: 12 }}>
                        <CopyButton text={prepPrompt(d, name)} label="Copy prompt for Claude Code" />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <DrillActions
                          status={d.status}
                          level={d.level}
                          evidence={d.evidence_url}
                          note={d.note}
                          onSet={async (status: string, evidence?: string, note?: string) => {
                            'use server'
                            return setPrepStatus(d.id, status, evidence, note)
                          }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )
            })}
            {done > 0 && (
              <div className="row">
                <CopyButton text={evidenceMarkdown} label="Copy evidence as markdown" />
              </div>
            )}
          </Section>
        )}

        <Section title="Applications">
          {js.length === 0 ? (
            <Empty>No roles recorded.</Empty>
          ) : (
            js.map((j) => (
              <article key={j.id} className="card">
                <div className="spread">
                  <h3 className="card-title">
                    {j.url ? <ExternalLink href={j.url}>{j.title}</ExternalLink> : j.title}
                  </h3>
                  <StatusBadge status={j.closed && j.status === 'found' ? 'closed' : j.status} />
                </div>
                <div className="card-meta">
                  {j.location ?? 'location not stated'}
                  {j.applied_at ? ` · applied ${formatDay(j.applied_at)}` : ` · seen ${formatDay(j.first_seen_at)}`}
                  {j.score != null ? ` · score ${j.score}` : ''}
                </div>
              </article>
            ))
          )}
        </Section>

        <Section title="Public work" hint="Answers, pull requests and issues in their community, with links.">
          {work.length === 0 ? (
            <Empty>
              Nothing yet. The <Link href="/questions">open questions</Link> for {name} are the way in.
            </Empty>
          ) : (
            work.map((w) => (
              <article key={w.id} className="card">
                <div className="spread">
                  <h3 className="card-title">
                    <ExternalLink href={w.url}>{w.title}</ExternalLink>
                  </h3>
                  <span className="chip">{w.kind}</span>
                </div>
                <div className="card-meta">{formatDay(w.happened_at)}</div>
              </article>
            ))
          )}
        </Section>

        <Section title="People" hint="Who has been contacted, and what was said. Nothing here sends anything.">
          {talks.length === 0 && ppl.length === 0 ? (
            <Empty>No contacts recorded.</Empty>
          ) : (
            <>
              {talks.map((o) => (
                <article key={o.id} className="card">
                  <div className="spread">
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Logo name={o.person_name} slug={o.person_name} size={24} />
                      {o.person_url ? <ExternalLink href={o.person_url}>{o.person_name}</ExternalLink> : o.person_name}
                    </h3>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="card-meta">
                    {o.channel.replace('_', ' ')} · {o.kind}
                    {o.sent_at ? ` · sent ${formatDay(o.sent_at)}` : ` · drafted ${formatDay(o.created_at)}`}
                    {o.replied_at ? ` · replied ${formatDay(o.replied_at)}` : ''}
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <Link className="btn" href={`/outreach/${o.id}`}>Open</Link>
                  </div>
                </article>
              ))}
              {ppl.filter((p) => !talks.some((t) => t.person_id === p.id)).length > 0 && (
                <div className="card">
                  <div className="card-meta" style={{ marginBottom: 8 }}>Known, not yet contacted</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {ppl
                      .filter((p) => !talks.some((t) => t.person_id === p.id))
                      .map((p) => (
                        <li key={p.id}>
                          {p.url ? <ExternalLink href={p.url}>{p.name}</ExternalLink> : p.name}
                          {p.position || p.headline ? ` — ${p.position || p.headline}` : ''}
                          {p.relationship === 'connection' ? ' (1st)' : ''}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Section>
      </main>
    </>
  )
}
