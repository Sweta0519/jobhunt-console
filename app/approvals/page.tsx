import Link from 'next/link'
import { requireOwner } from '../lib/supabase'
import { captionText, type Outreach, type Post } from '../lib/queries'
import { NavBar, Section, Empty, StatusBadge, formatDay, relative } from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
import { Logo } from '../components/Logo'
import { Expandable, InlineEdit } from '../components/Interactive'
import { Preview } from '../components/Preview'
import { postPreviews } from '../lib/avatars'
import { approveOutreach, skipOutreach, markOutreachSent, approvePost, skipPost, editOutreach } from '../actions'
import { linkedinChatUrl } from '../lib/prompts'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Approvals' }

export default async function Approvals() {
  const { supabase } = await requireOwner()

  const [outreachRes, postsRes, cosRes] = await Promise.all([
    supabase
      .from('outreach')
      .select('*')
      .in('status', ['draft', 'approved'])
      .order('created_at'),
    supabase
      .from('posts')
      .select('*')
      .in('status', ['draft', 'approved', 'rendered'])
      .order('post_date'),
    supabase.from('companies').select('slug,logo_path'),
  ])
  const logos = new Map((cosRes.data || []).map((c) => [c.slug, c.logo_path as string | null]))
  const previews = await postPreviews(supabase)

  const outreach = (outreachRes.data as Outreach[]) || []
  const posts = (postsRes.data as Post[]) || []
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
  const total = outreach.length + posts.length

  return (
    <>
      <NavBar current="/approvals" waiting={total} />
      <main className="shell">
        <h1>Approvals</h1>
        <p className="sub">
          {total === 0
            ? 'Nothing waiting.'
            : `${total} item${total === 1 ? '' : 's'} waiting on your word.`}
        </p>

        <Section
          title="Posts"
          hint="Approving a post schedules it. The publish job runs that morning whether or not your laptop is on."
        >
          {posts.length === 0 ? (
            <Empty>No posts waiting.</Empty>
          ) : (
            posts.map((p) => {
              const isToday = p.post_date === today
              const when = formatDay(p.post_date)
              return (
                <article key={p.id} className="card content-item">
                  <div className="spread">
                    <h3 className="card-title">{p.title || p.id}</h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="card-meta">
                    {when} · {p.format} · {p.pillar}
                  </div>
                  <Preview src={previews.get(p.id)} alt={p.alt_text ?? undefined} />
                  {p.caption && <Expandable text={captionText(p.caption)} />}
                  <div className="row" style={{ marginTop: 12 }}>
                    {p.status === 'draft' && (
                      <ActionButton
                        primary
                        action={approvePost.bind(null, p.id, isToday)}
                        confirm={
                          isToday
                            ? 'This publishes today, within the hour. Approve it?'
                            : undefined
                        }
                      >
                        {isToday ? `Approve — publishes today` : `Approve — publishes ${when}`}
                      </ActionButton>
                    )}
                    <Link className="btn" href={`/posts/${p.id}`}>
                      Details
                    </Link>
                    <ActionButton action={skipPost.bind(null, p.id)}>Skip</ActionButton>
                  </div>
                </article>
              )
            })
          )}
        </Section>

        <Section
          title="Outreach"
          hint="The console never sends a LinkedIn message. Copy the text, send it yourself, then mark it sent."
        >
          {outreach.length === 0 ? (
            <Empty>No outreach waiting.</Empty>
          ) : (
            outreach.map((o) => (
              <article key={o.id} className="card">
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo name={o.company} slug={o.company_slug} path={logos.get(o.company_slug ?? '')} size={24} />
                    {o.person_name}
                  </h3>
                  <StatusBadge status={o.status} />
                </div>
                <div className="card-meta">
                  {o.company} · {o.channel.replace('_', ' ')} · {o.kind} · drafted{' '}
                  {relative(o.created_at)}
                </div>
                {o.reason && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    {o.reason}
                  </p>
                )}
                {o.body && <Expandable text={o.body} />}
                {o.channel === 'connect_note' && o.body && (
                  <div className="card-meta num">
                    {o.body.length} / 200 characters
                    {o.body.length > 200 ? ' — too long for a connection note' : ''}
                  </div>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  {o.status === 'draft' && (
                    <ActionButton primary action={approveOutreach.bind(null, o.id)}>
                      Approve
                    </ActionButton>
                  )}
                  {o.body && <CopyButton text={o.body} label="Copy text" />}
                  {o.person_url && (
                    <a
                      className="btn"
                      href={linkedinChatUrl(o.person_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open LinkedIn
                    </a>
                  )}
                  <ActionButton
                    action={markOutreachSent.bind(null, o.id)}
                    confirm={`Mark the message to ${o.person_name} as sent? Only do this after you have actually sent it.`}
                  >
                    Mark sent
                  </ActionButton>
                  <ActionButton action={skipOutreach.bind(null, o.id)}>Skip</ActionButton>
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <InlineEdit
                    initial={o.body ?? ''}
                    limit={o.channel === 'connect_note' ? 200 : undefined}
                    onSave={async (text: string) => {
                      'use server'
                      return editOutreach(o.id, text)
                    }}
                  />
                </div>
              </article>
            ))
          )}
        </Section>
      </main>
    </>
  )
}
