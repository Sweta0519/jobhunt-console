import { requireOwner } from '../lib/supabase'
import {
  NavBar,
  PageHeader,
  Section,
  Toolbar,
  ChipLink,
  Stat,
  List,
  ListRow,
  Field,
  Empty,
  StatusBadge,
  ExternalLink,
  formatDay,
} from '../components/ui'
import { CopyButton } from '../components/ActionButton'
import { addContribution } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Record' }

type Contribution = {
  id: string; kind: string; company: string | null; title: string
  url: string; happened_at: string; source_ref: string | null
  state: string | null
}

const KIND_LABEL: Record<string, string> = {
  answer: 'Answer',
  pr: 'Pull request',
  issue: 'Issue',
  post: 'Post',
  runbook: 'Runbook',
}

// Merged and open are the distinction a reader actually cares about, and the
// card showed neither. State is meaningless for a post or a runbook, so it is
// only rendered where it says something.
const STATE_LABEL: Record<string, string> = {
  merged: 'Merged',
  open: 'Open',
  closed: 'Closed',
}
const HAS_STATE = new Set(['pr', 'issue', 'answer'])
const stateOf = (r: Contribution) =>
  HAS_STATE.has(r.kind) && r.state && STATE_LABEL[r.state] ? STATE_LABEL[r.state] : null

export default async function Record({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const sp = await searchParams
  const { supabase } = await requireOwner()

  let q = supabase.from('contributions').select('*')
  if (sp.company) q = q.eq('company', sp.company)
  const [{ data: contribs }, { data: outreach }, { data: apps }] = await Promise.all([
    q.order('happened_at', { ascending: false }).limit(200),
    supabase.from('outreach').select('status'),
    supabase.from('jobs').select('status,interviewed,applied_at').in('status', ['applied', 'shortlisted', 'interview', 'rejected']).gte('applied_at', '2026-04-25'),
  ])
  const appRows = apps || []
  const appFunnel = {
    applied: appRows.length,
    interviewed: appRows.filter((a) => a.interviewed || a.status === 'interview').length,
    rejected: appRows.filter((a) => a.status === 'rejected').length,
    waiting: appRows.filter((a) => a.status === 'applied').length,
  }

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
    .map(
      (r) =>
        `- [${r.title}](${r.url}) — ${stateOf(r) ? `${stateOf(r)} ` : ''}${KIND_LABEL[r.kind] ?? r.kind}${r.company ? `, ${r.company}` : ''}, ${formatDay(r.happened_at)}`
    )
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
        <PageHeader title="Record" count={rows.length}>
          <p>Public work with a link behind it. This is what you show when you apply.</p>
        </PageHeader>

        <Section title="Momentum" hint="Only public artifacts and replies from real people are counted. No followers, no impressions.">
          <div className="card">
            <div className="spark" role="img" aria-label="Public contributions per week, last 12 weeks">
              {weeks.map((w) => (
                <div key={w.label} className="spark-col" title={`${w.label}: ${w.n}`}>
                  <div
                    className={`spark-bar${w.n > 0 ? ' on' : ''}`}
                    style={{ '--h': `${Math.round((w.n / max) * 52)}px` } as React.CSSProperties}
                  />
                  <div className="spark-label">{w.label}</div>
                </div>
              ))}
            </div>
            <p className="card-note">
              {activeWeeks} of the last 12 weeks had at least one public contribution.
            </p>
          </div>
        </Section>

        <Section title="Applications since 25 April" hint="Absolute numbers, from the inbox and from what you recorded. A rate at this sample size would be noise.">
          <div className="stats compact">
            <Stat label="Applied" value={appFunnel.applied} />
            <Stat label="Interviewed" value={appFunnel.interviewed} />
            <Stat label="Rejected" value={appFunnel.rejected} />
            <Stat label="Still waiting" value={appFunnel.waiting} />
          </div>
        </Section>

        <Section title="Outreach" hint="Absolute numbers. A rate at this sample size would be noise.">
          <div className="stats compact">
            <Stat label="Drafted" value={drafted} />
            <Stat label="Sent" value={sent} />
            <Stat label="Accepted" value={accepted} />
            <Stat label="Replied" value={replied} />
          </div>
        </Section>

        <Section title="Proof" count={rows.length}>
          <Toolbar
            label="Company"
            scroll
            meta={rows.length > 0 ? <CopyButton text={markdown} label="Copy as markdown" /> : undefined}
          >
            <ChipLink href="/record" active={!sp.company}>
              All
            </ChipLink>
            {companies.map((c) => (
              <ChipLink key={c} href={`/record?company=${encodeURIComponent(c)}`} active={sp.company === c}>
                {c}
              </ChipLink>
            ))}
          </Toolbar>

          {rows.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <List>
              {rows.map((r) => (
                <ListRow
                  key={r.id}
                  title={<ExternalLink href={r.url}>{r.title}</ExternalLink>}
                  meta={
                    <>
                      {r.company ? `${r.company} · ` : ''}
                      {formatDay(r.happened_at)}
                    </>
                  }
                  trail={
                    <>
                      {stateOf(r) && <StatusBadge status={`pr_${r.state}`} />}
                      <span className="chip">{KIND_LABEL[r.kind] ?? r.kind}</span>
                    </>
                  }
                />
              ))}
            </List>
          )}
        </Section>

        <Section title="Add a pull request or issue" hint="Answers record themselves; upstream work is added here.">
          <form action={submit} className="card form-stack">
            <Field label="Title" htmlFor="rec-title">
              <input id="rec-title" className="input" name="title" required />
            </Field>
            <Field label="Link" htmlFor="rec-url">
              <input
                id="rec-url"
                className="input"
                name="url"
                type="url"
                required
                placeholder="https://github.com/…"
              />
            </Field>
            <Field label="Company (optional)" htmlFor="rec-company">
              <input id="rec-company" className="input" name="company" />
            </Field>
            <Field label="Kind" htmlFor="rec-kind">
              <select id="rec-kind" className="input" name="kind" defaultValue="pr">
                <option value="pr">Pull request</option>
                <option value="issue">Issue</option>
                <option value="runbook">Runbook</option>
              </select>
            </Field>
            <button className="btn primary" type="submit">
              Add
            </button>
          </form>
        </Section>
      </main>
    </>
  )
}
