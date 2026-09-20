import Link from 'next/link'
import { requireOwner } from './lib/supabase'
import { getToday, tokenDaysLeft } from './lib/queries'
import { NavBar, Section, Empty, StatusBadge, ExternalLink, formatDay, relative } from './components/ui'
import { Logo } from './components/Logo'
import { Preview } from './components/Preview'
import { postPreviews } from './lib/avatars'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Today' }

export default async function Today() {
  const { supabase } = await requireOwner()
  const [d, { data: cos }, previews] = await Promise.all([
    getToday(supabase),
    supabase.from('companies').select('slug,logo_path'),
    postPreviews(supabase),
  ])
  const logos = new Map((cos || []).map((c) => [c.slug, c.logo_path as string | null]))

  const waiting = d.waitingOutreach.length + d.waitingPosts.length
  const tokenDays = tokenDaysLeft(d.tokenStatus)
  const failedRun = d.lastRuns.find((r) => r.ok === false)

  const attention: React.ReactNode[] = []
  if (tokenDays !== null && tokenDays <= 7) {
    attention.push(
      <li key="token">
        LinkedIn access expires in {tokenDays} day{tokenDays === 1 ? '' : 's'}. Posts stop
        publishing after that. <Link href="/settings">Reconnect</Link>
      </li>
    )
  }
  if (failedRun) {
    attention.push(
      <li key="run">
        The {failedRun.worker} job failed {relative(failedRun.finished_at)}.{' '}
        <span className="mono">{String(failedRun.error || '').slice(0, 120)}</span>
      </li>
    )
  }
  if (d.todayPost?.status === 'failed') {
    attention.push(
      <li key="post">
        Today&apos;s post failed to publish.{' '}
        <span className="mono">{String(d.todayPost.last_error || '').slice(0, 120)}</span>
      </li>
    )
  }

  const quiet =
    d.answer.length === 0 && waiting === 0 && d.followups.length === 0 && attention.length === 0

  return (
    <>
      <NavBar current="/" waiting={waiting} />
      <main className="shell">
        <h1>Today</h1>
        <p className="sub">
          {formatDay(new Date().toISOString())} · {d.openQuestionCount} open question
          {d.openQuestionCount === 1 ? '' : 's'}
        </p>

        {attention.length > 0 && (
          <Section title="Needs attention">
            <div className="notice">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{attention}</ul>
            </div>
          </Section>
        )}

        <Section
          title="Answer today"
          hint="Highest ranked, at most two per company. Answering in a company's own community is the part recruiters there actually see."
        >
          {d.answer.length === 0 ? (
            <Empty>Nothing open worth answering right now.</Empty>
          ) : (
            d.answer.map((q) => (
              <article key={q.id} className="card">
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo name={q.company} slug={q.company_slug} path={logos.get(q.company_slug ?? '')} size={24} />
                    <ExternalLink href={q.url}>{q.title}</ExternalLink>
                  </h3>
                  <span className="score num">{q.rank ?? '—'}</span>
                </div>
                <div className="card-meta">
                  {q.site} · {q.comments === 0 ? 'no replies' : `${q.comments} replies`} ·{' '}
                  {relative(q.asked_at)}
                </div>
                {q.why && (
                  <div className="row" style={{ marginTop: 8 }}>
                    {q.why.split(' · ').slice(2).map((w) => (
                      <span className="chip" key={w}>
                        {w}
                      </span>
                    ))}
                  </div>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <Link className="btn primary" href={`/questions/${encodeURIComponent(q.id)}`}>
                    Open
                  </Link>
                  <ExternalLink href={q.url}>
                    <span className="btn">Read the thread</span>
                  </ExternalLink>
                </div>
              </article>
            ))
          )}
        </Section>

        <Section title="Today's post">
          {!d.todayPost ? (
            <Empty>
              No post scheduled for today. <Link href="/posts">See the week</Link>
            </Empty>
          ) : (
            <article className="card content-item">
              <div className="spread">
                <h3 className="card-title">{d.todayPost.title || d.todayPost.id}</h3>
                <StatusBadge status={d.todayPost.status} />
              </div>
              <div className="card-meta">
                {formatDay(d.todayPost.post_date)} · {d.todayPost.format} · {d.todayPost.pillar}
              </div>
              <Preview src={previews.get(d.todayPost.id)} max={280} />
              {d.todayPost.status === 'published' && d.todayPost.published_url && (
                <div className="row" style={{ marginTop: 12 }}>
                  <ExternalLink href={d.todayPost.published_url}>
                    <span className="btn">View on LinkedIn</span>
                  </ExternalLink>
                </div>
              )}
              {(d.todayPost.status === 'approved' || d.todayPost.status === 'rendered') && (
                <p className="sub" style={{ marginTop: 10 }}>
                  Ready. It publishes this morning without your laptop.
                </p>
              )}
              {d.todayPost.status === 'draft' && (
                <div className="row" style={{ marginTop: 12 }}>
                  <Link className="btn primary" href={`/posts/${d.todayPost.id}`}>
                    Review and approve
                  </Link>
                </div>
              )}
            </article>
          )}
        </Section>

        <Section title="Waiting on you">
          {waiting === 0 ? (
            <Empty>Nothing waiting for a decision.</Empty>
          ) : (
            <div className="card">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {d.waitingOutreach.length > 0 && (
                  <li>
                    <Link href="/approvals">
                      {d.waitingOutreach.length} outreach draft
                      {d.waitingOutreach.length === 1 ? '' : 's'}
                    </Link>
                  </li>
                )}
                {d.waitingPosts.length > 0 && (
                  <li>
                    <Link href="/approvals">
                      {d.waitingPosts.length} post{d.waitingPosts.length === 1 ? '' : 's'}
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          )}
        </Section>

        {d.followups.length > 0 && (
          <Section title="Follow-ups due">
            {d.followups.map((o) => (
              <article key={o.id} className="card">
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo name={o.person_name} slug={o.person_name} size={26} />
                    {o.person_name}
                  </h3>
                  <StatusBadge status={o.status} />
                </div>
                <div className="card-meta">
                  {o.company} · {o.channel.replace('_', ' ')} sent {relative(o.sent_at)}
                  {o.status === 'accepted' ? ', accepted, no reply' : ''}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <Link className="btn" href={`/outreach/${o.id}`}>
                    Open
                  </Link>
                </div>
              </article>
            ))}
          </Section>
        )}

        {d.newJobs.length > 0 && (
          <Section title="New and worth a look">
            {d.newJobs.map((j) => (
              <article key={j.id} className="card">
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo name={j.company} slug={j.company_slug} path={logos.get(j.company_slug ?? '')} size={24} />
                    {j.url ? <ExternalLink href={j.url}>{j.title}</ExternalLink> : j.title}
                  </h3>
                  <span className="score num">{j.score ?? '—'}</span>
                </div>
                <div className="card-meta">
                  {j.company} · {j.location}
                </div>
                {j.score_notes?.location && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    {j.score_notes.location}
                  </p>
                )}
              </article>
            ))}
          </Section>
        )}

        {quiet && (
          <Section title="">
            <div className="card">
              <h3 className="card-title">Nothing needs a decision today.</h3>
              <p className="sub">
                The scheduled jobs keep running with your laptop closed. Come back tomorrow, or
                pick something from <Link href="/questions">the open questions</Link>.
              </p>
            </div>
          </Section>
        )}
      </main>
    </>
  )
}
