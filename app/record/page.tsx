import Link from 'next/link'
import { requireOwner } from '../lib/supabase'
import { NavBar, Section, Empty, ExternalLink, formatDay } from '../components/ui'
import { CopyButton } from '../components/ActionButton'
import { addContribution } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Record' }

type Contribution = {
  id: string; kind: string; company: string | null; title: string
  url: string; happened_at: string; source_ref: string | null
}

const KIND_LABEL: Record<string, string> = {
  answer: 'Answer',
  pr: 'Pull request',
  issue: 'Issue',
  post: 'Post',
  runbook: 'Runbook',
}

export default async function Record({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const sp = await searchParams
  const { supabase } = await requireOwner()

  let q = supabase.from('contributions').select('*')
  if (sp.company) q = q.eq('company', sp.company)
  const [{ data: contribs }, { data: outreach }] = await Promise.all([
    q.order('happened_at', { ascending: false }).limit(200),
    supabase.from('outreach').select('status'),
  ])

  const rows = (contribs as Contribution[]) || []

  // Absolute numbers, never a lone percentage. At this sample size a rate is noise.
  const counts = (outreach || []).reduce<Record<string, number>>((a, o) => {
    a[o.status] = (a[o.status] || 0) + 1
    return a
  }, {})
  const drafted = Object.values(counts).reduce((a, b) => a + b, 0)
  const sent = (counts.sent || 0) + (counts.accepted || 0) + (counts.replied || 0)
  const accepted = (counts.accepted || 0) + (counts.replied || 0)
  const replied = counts.replied || 0

  // Twelve weeks, counting only public artifacts and human replies.
  const weeks: { label: string; n: number }[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - start.getDay() + 1) // Monday
  for (let i = 11; i >= 0; i--) {
    const from = new Date(start.getTime() - i * 7 * 86_400_000)
    const to = new Date(from.getTime() + 7 * 86_400_000)
    weeks.push({
      label: from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      n: rows.filter((r) => {
        const t = new Date(r.happened_at).getTime()
        return t >= from.getTime() && t < to.getTime()
      }).length,
    })
  }
  const max = Math.max(1, ...weeks.map((w) => w.n))
  const activeWeeks = weeks.filter((w) => w.n > 0).length

  const markdown = rows
    .map((r) => `- [${r.title}](${r.url}) — ${KIND_LABEL[r.kind] ?? r.kind}${r.company ? `, ${r.company}` : ''}, ${formatDay(r.happened_at)}`)
    .join('\n')

  const companies = [...new Set(rows.map((r) => r.company).filter(Boolean))] as string[]

  // A <form action> must resolve to void, so wrap the shared action.
  async function submit(form: FormData) {
    'use server'
    await addContribution(form)
  }

  return (
    <>
      <NavBar current="/record" waiting={0} />
      <main className="shell">
        <h1>Record</h1>
        <p className="sub">
          Public work with a link behind it. This is what you show when you apply.
        </p>

        <Section title="Momentum" hint="Only public artifacts and replies from real people are counted. No followers, no impressions.">
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 70 }}>
              {weeks.map((w) => (
                <div key={w.label} style={{ flex: 1, textAlign: 'center' }} title={`${w.label}: ${w.n}`}>
                  <div
                    style={{
                      height: `${Math.round((w.n / max) * 52)}px`,
                      minHeight: w.n > 0 ? 3 : 1,
                      background: w.n > 0 ? 'var(--accent)' : 'var(--border)',
                      borderRadius: 3,
                    }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>{w.label}</div>
                </div>
              ))}
            </div>
            <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
              {activeWeeks} of the last 12 weeks had at least one public contribution.
            </p>
          </div>
        </Section>

        <Section title="Outreach" hint="Absolute numbers. A rate at this sample size would be noise.">
          <div className="card num">
            {drafted} drafted → {sent} sent → {accepted} accepted → {replied} replied
          </div>
        </Section>

        <Section title={`Proof (${rows.length})`}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Link className="chip" href="/record">
              all
            </Link>
            {companies.map((c) => (
              <Link className="chip" key={c} href={`/record?company=${encodeURIComponent(c)}`}>
                {c}
              </Link>
            ))}
            {rows.length > 0 && <CopyButton text={markdown} label="Copy as markdown" />}
          </div>

          {rows.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            rows.map((r) => (
              <article key={r.id} className="card">
                <div className="spread">
                  <h3 className="card-title">
                    <ExternalLink href={r.url}>{r.title}</ExternalLink>
                  </h3>
                  <span className="chip">{KIND_LABEL[r.kind] ?? r.kind}</span>
                </div>
                <div className="card-meta">
                  {r.company ? `${r.company} · ` : ''}
                  {formatDay(r.happened_at)}
                </div>
              </article>
            ))
          )}
        </Section>

        <Section title="Add a pull request or issue" hint="Answers record themselves; upstream work is added here.">
          <form action={submit} className="card">
            <input name="title" required placeholder="Title" style={inputStyle} />
            <input name="url" type="url" required placeholder="https://github.com/…" style={inputStyle} />
            <input name="company" placeholder="Company (optional)" style={inputStyle} />
            <select name="kind" defaultValue="pr" style={inputStyle}>
              <option value="pr">Pull request</option>
              <option value="issue">Issue</option>
              <option value="runbook">Runbook</option>
            </select>
            <button className="btn primary" type="submit">
              Add
            </button>
          </form>
        </Section>
      </main>
    </>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginBottom: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 16,
  fontFamily: 'inherit',
}
