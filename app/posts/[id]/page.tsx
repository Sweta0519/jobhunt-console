import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOwner } from '../../lib/supabase'
import { captionText, type Post } from '../../lib/queries'
import { postPrompt } from '../../lib/prompts'
import { NavBar, StatusBadge, ExternalLink, formatDay, relative } from '../../components/ui'
import { ActionButton, CopyButton } from '../../components/ActionButton'
import { Preview } from '../../components/Preview'
import { postPreviews } from '../../lib/avatars'
import { approvePost, skipPost, movePost } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireOwner()

  const [{ data }, previews] = await Promise.all([
    supabase.from('posts').select('*').eq('id', id).maybeSingle(),
    postPreviews(supabase),
  ])
  if (!data) notFound()
  const p = data as Post & { card: unknown; slides: unknown; alt_text: string | null; sources: unknown }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
  const isToday = p.post_date === today
  const when = formatDay(p.post_date)

  async function reschedule(form: FormData) {
    'use server'
    await movePost(id, String(form.get('date') || ''))
  }

  return (
    <>
      <NavBar current="/posts" waiting={0} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 20 }}>
          <Link href="/posts">← Posts</Link>
        </p>

        <div className="spread">
          <h1 style={{ marginTop: 8 }}>{p.title || p.id}</h1>
          <StatusBadge status={p.status} />
        </div>
        <p className="sub">
          {when || 'no date'} · {p.format} · {p.pillar} · {p.id}
        </p>

        {p.status === 'published' && p.published_url && (
          <div className="card">
            <p style={{ margin: 0 }}>
              Published {relative(p.published_at)} ·{' '}
              <ExternalLink href={p.published_url}>view on LinkedIn</ExternalLink>
            </p>
          </div>
        )}

        {p.status === 'failed' && p.last_error && (
          <div className="notice">
            <strong>Last attempt failed.</strong> <span className="mono">{p.last_error}</span>
          </div>
        )}

        {previews.get(id) && (
          <>
            <h2>Preview</h2>
            <Preview src={previews.get(id)} alt={p.alt_text ?? undefined} max={520} />
            <p className="sub" style={{ marginTop: 8 }}>
              Tap to open the full image. Publishing re-renders from the current copy.
            </p>
          </>
        )}

        <h2>Caption</h2>
        <div className="card-body">{captionText(p.caption) || '(none yet)'}</div>

        {p.alt_text && (
          <>
            <h2>Alt text</h2>
            <div className="card-body">{p.alt_text}</div>
          </>
        )}

        {p.status !== 'published' && (
          <>
            <h2>Decide</h2>
            <div className="card">
              <div className="row">
                {p.status === 'draft' && (
                  <ActionButton
                    primary
                    action={approvePost.bind(null, p.id, isToday)}
                    confirm={isToday ? 'This publishes today, within the hour. Approve it?' : undefined}
                  >
                    {isToday ? 'Approve — publishes today' : `Approve — publishes ${when}`}
                  </ActionButton>
                )}
                <CopyButton text={postPrompt(p)} label="Copy prompt for Claude Code" />
                <ActionButton action={skipPost.bind(null, p.id)}>Skip</ActionButton>
              </div>
              <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
                Approving schedules the publish job for that morning. Nothing goes out now.
              </p>
            </div>

            <h2>Move it</h2>
            <form action={reschedule} className="card">
              <p className="sub" style={{ marginTop: 0 }}>
                Changing the date returns it to draft, so it never publishes on a day you did not
                approve.
              </p>
              <div className="row">
                <input
                  type="date"
                  name="date"
                  defaultValue={p.post_date ?? today}
                  required
                  style={{
                    padding: '9px 12px',
                    borderRadius: 7,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 15,
                    fontFamily: 'inherit',
                  }}
                />
                <button className="btn" type="submit">
                  Move
                </button>
              </div>
            </form>
          </>
        )}

        <h2>Prompt</h2>
        <pre className="card mono">{postPrompt(p)}</pre>
      </main>
    </>
  )
}
