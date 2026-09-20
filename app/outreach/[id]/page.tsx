import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOwner } from '../../lib/supabase'
import { peopleAvatars } from '../../lib/avatars'
import type { Outreach } from '../../lib/queries'
import { outreachPrompt, linkedinChatUrl } from '../../lib/prompts'
import { NavBar, StatusBadge, formatDay, relative } from '../../components/ui'
import { ActionButton, CopyButton } from '../../components/ActionButton'
import { Logo } from '../../components/Logo'
import { InlineEdit } from '../../components/Interactive'
import {
  approveOutreach,
  markOutreachSent,
  markOutreachReplied,
  skipOutreach,
  editOutreach,
} from '../../actions'

export const dynamic = 'force-dynamic'

export default async function OutreachDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireOwner()

  const [{ data }, avatars] = await Promise.all([
    supabase.from('outreach').select('*').eq('id', id).maybeSingle(),
    peopleAvatars(supabase),
  ])
  if (!data) notFound()
  const o = data as Outreach

  const [{ data: person }, { data: job }] = await Promise.all([
    o.person_id
      ? supabase.from('people').select('headline,position,connected_on,relationship').eq('id', o.person_id).maybeSingle()
      : Promise.resolve({ data: null }),
    o.job_id
      ? supabase.from('jobs').select('title,url,location,score').eq('id', o.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const limit = o.channel === 'connect_note' ? 200 : undefined

  return (
    <>
      <NavBar current="/outreach" waiting={0} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 20 }}>
          <Link href="/outreach">← Outreach</Link>
        </p>

        <div className="spread">
          <h1 style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Logo
              name={o.person_name}
              slug={o.person_id ?? o.person_name}
              src={avatars.get(o.person_id ?? '')}
              size={36}
              round
            />
            {o.person_name}
          </h1>
          <StatusBadge status={o.status} />
        </div>
        <p className="sub">
          {o.company} · {o.channel.replace('_', ' ')} · {o.kind}
          {person?.headline ? ` · ${person.headline}` : ''}
        </p>

        {o.reason && (
          <div className="card">
            <p style={{ margin: 0 }}>{o.reason}</p>
          </div>
        )}

        <h2>Timeline</h2>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Drafted {relative(o.created_at)}</li>
            {o.approved_at && <li>Approved {relative(o.approved_at)}</li>}
            {o.sent_at && <li>Sent {relative(o.sent_at)}</li>}
            {o.replied_at && <li>Replied {relative(o.replied_at)}</li>}
            {o.followup_due_at && !o.replied_at && (
              <li>
                Follow-up due {formatDay(o.followup_due_at)}
                {o.followup_due_at < new Date().toISOString() ? ' — overdue' : ''}
              </li>
            )}
          </ul>
        </div>

        {job && (
          <>
            <h2>The role</h2>
            <div className="card">
              <p className="card-title" style={{ marginBottom: 2 }}>
                {job.url ? (
                  <a href={job.url} target="_blank" rel="noopener noreferrer">
                    {job.title}
                  </a>
                ) : (
                  job.title
                )}
              </p>
              <p className="card-meta" style={{ margin: 0 }}>
                {job.location} {job.score != null ? `· score ${job.score}` : ''}
              </p>
            </div>
          </>
        )}

        <h2>The message</h2>
        <div className="card-body">{o.body || '(nothing drafted yet)'}</div>
        {limit && o.body && (
          <p className="card-meta num">
            {o.body.length} / {limit} characters
            {o.body.length > limit ? ' — too long for a connection note' : ''}
          </p>
        )}

        <div className="card" style={{ marginTop: 12 }}>
          <div className="row">
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
            {['draft', 'approved'].includes(o.status) && (
              <ActionButton
                action={markOutreachSent.bind(null, o.id)}
                confirm={`Mark the message to ${o.person_name} as sent? Only after you have actually sent it in LinkedIn.`}
              >
                Mark sent
              </ActionButton>
            )}
            {['sent', 'accepted'].includes(o.status) && (
              <ActionButton action={markOutreachReplied.bind(null, o.id)}>
                They replied
              </ActionButton>
            )}
            {['draft', 'approved'].includes(o.status) && (
              <ActionButton action={skipOutreach.bind(null, o.id)}>Skip</ActionButton>
            )}
          </div>
          <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
            The console never sends. Copy the text, send it from LinkedIn, then mark it sent.
          </p>
        </div>

        {['draft', 'approved'].includes(o.status) && (
          <>
            <h2>Edit</h2>
            <div className="card">
              <InlineEdit
                initial={o.body ?? ''}
                limit={limit}
                onSave={async (text: string) => {
                  'use server'
                  return editOutreach(o.id, text)
                }}
              />
              <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
                Saving returns it to draft, so approval always applies to the words you read.
              </p>
            </div>
          </>
        )}

        <h2>Prompt</h2>
        <pre className="card mono">{outreachPrompt(o)}</pre>
      </main>
    </>
  )
}
