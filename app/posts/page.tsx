import { requireOwner } from '../lib/supabase'
import { captionText, type Post } from '../lib/queries'
import { postPrompt } from '../lib/prompts'
import { NavBar, Section, Empty, StatusBadge, ExternalLink, formatDay } from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
import { approvePost, skipPost } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Posts' }

export default async function Posts() {
  const { supabase } = await requireOwner()
  const { data } = await supabase
    .from('posts')
    .select('*')
    .order('post_date', { ascending: false })
    .limit(100)
  const rows = (data as Post[]) || []

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
  const upcoming = rows.filter((p) => (p.post_date || '') >= today && p.status !== 'published')
  const published = rows.filter((p) => p.status === 'published')
  const other = rows.filter((p) => !upcoming.includes(p) && !published.includes(p))

  return (
    <>
      <NavBar current="/posts" waiting={0} />
      <main className="shell">
        <h1>Posts</h1>
        <p className="sub">
          Approved posts publish on their date through LinkedIn&apos;s official API, with your
          laptop closed.
        </p>

        <Section title="Coming up">
          {upcoming.length === 0 ? (
            <Empty>Nothing scheduled. Draft next week&apos;s in Claude Code.</Empty>
          ) : (
            upcoming.map((p) => <Card key={p.id} p={p} today={today} />)
          )}
        </Section>

        <Section title={`Published (${published.length})`}>
          {published.length === 0 ? (
            <Empty>Nothing published yet.</Empty>
          ) : (
            published.map((p) => (
              <article key={p.id} className="card content-item">
                <div className="spread">
                  <h3 className="card-title">{p.title || p.id}</h3>
                  <StatusBadge status={p.status} />
                </div>
                <div className="card-meta">
                  {formatDay(p.published_at || p.post_date)} · {p.format} · {p.pillar}
                </div>
                {p.published_url && (
                  <div className="row" style={{ marginTop: 12 }}>
                    <ExternalLink href={p.published_url}>
                      <span className="btn">View on LinkedIn</span>
                    </ExternalLink>
                  </div>
                )}
              </article>
            ))
          )}
        </Section>

        {other.length > 0 && (
          <Section title="Past and skipped">
            {other.map((p) => (
              <article key={p.id} className="card">
                <div className="spread">
                  <h3 className="card-title">{p.title || p.id}</h3>
                  <StatusBadge status={p.status} />
                </div>
                <div className="card-meta">{formatDay(p.post_date)}</div>
              </article>
            ))}
          </Section>
        )}
      </main>
    </>
  )
}

function Card({ p, today }: { p: Post; today: string }) {
  const isToday = p.post_date === today
  const when = formatDay(p.post_date)
  return (
    <article className="card content-item">
      <div className="spread">
        <h3 className="card-title">{p.title || p.id}</h3>
        <StatusBadge status={p.status} />
      </div>
      <div className="card-meta">
        {when} · {p.format} · {p.pillar}
      </div>
      {p.caption && <div className="card-body">{captionText(p.caption)}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        {p.status === 'draft' && (
          <ActionButton
            primary
            action={approvePost.bind(null, p.id, isToday)}
            confirm={isToday ? 'This publishes today, within the hour. Approve it?' : undefined}
          >
            {isToday ? 'Approve — publishes today' : `Approve — publishes ${when}`}
          </ActionButton>
        )}
        <CopyButton text={postPrompt(p)} label="Copy prompt" />
        {p.status !== 'published' && (
          <ActionButton action={skipPost.bind(null, p.id)}>Skip</ActionButton>
        )}
      </div>
    </article>
  )
}
