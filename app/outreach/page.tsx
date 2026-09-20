import { requireOwner } from '../lib/supabase'
import { peopleAvatars } from '../lib/avatars'
import type { Outreach } from '../lib/queries'
import { outreachPrompt, linkedinChatUrl } from '../lib/prompts'
import { NavBar, Section, Empty, StatusBadge, relative } from '../components/ui'
import { ActionButton, CopyButton } from '../components/ActionButton'
import { Logo } from '../components/Logo'
import { Expandable, InlineEdit } from '../components/Interactive'
import { markOutreachSent, markOutreachReplied, skipOutreach, editOutreach } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Outreach' }

export default async function OutreachPage() {
  const { supabase } = await requireOwner()
  const [{ data }, avatars] = await Promise.all([
    supabase.from('outreach').select('*').order('created_at', { ascending: false }).limit(200),
    peopleAvatars(supabase),
  ])
  const rows = (data as Outreach[]) || []

  const waiting = rows.filter((o) => ['draft', 'approved'].includes(o.status))
  const live = rows.filter((o) => ['sent', 'accepted'].includes(o.status) && !o.replied_at)
  const done = rows.filter((o) => ['replied', 'skipped', 'closed'].includes(o.status))

  return (
    <>
      <NavBar current="/outreach" waiting={waiting.length} />
      <main className="shell">
        <h1>Outreach</h1>
        <p className="sub">
          The console drafts and keeps the record. You send from LinkedIn yourself, which is why
          nothing here can get your account restricted.
        </p>

        <Section title={`Ready to send (${waiting.length})`}>
          {waiting.length === 0 ? <Empty>Nothing ready.</Empty> : waiting.map((o) => <Row key={o.id} o={o} avatar={avatars.get(o.person_id ?? '')} />)}
        </Section>

        <Section title={`Awaiting a reply (${live.length})`}>
          {live.length === 0 ? <Empty>Nothing outstanding.</Empty> : live.map((o) => <Row key={o.id} o={o} avatar={avatars.get(o.person_id ?? '')} />)}
        </Section>

        {done.length > 0 && (
          <Section title="Closed">
            {done.map((o) => (
              <article key={o.id} className="card">
                <div className="spread">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Logo
                      name={o.person_name}
                      slug={o.person_id ?? o.person_name}
                      src={avatars.get(o.person_id ?? '')}
                      size={28}
                      round
                    />
                    {o.person_name}
                  </h3>
                  <StatusBadge status={o.status} />
                </div>
                <div className="card-meta">
                  {o.company} · {relative(o.sent_at || o.created_at)}
                </div>
              </article>
            ))}
          </Section>
        )}
      </main>
    </>
  )
}

function Row({ o, avatar }: { o: Outreach; avatar?: string }) {
  return (
    <article className="card">
      <div className="spread">
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo name={o.person_name} slug={o.person_id ?? o.person_name} src={avatar} size={28} round />
          {o.person_name}
        </h3>
        <StatusBadge status={o.status} />
      </div>
      <div className="card-meta">
        {o.company} · {o.channel.replace('_', ' ')} · {o.kind}
        {o.sent_at ? ` · sent ${relative(o.sent_at)}` : ` · drafted ${relative(o.created_at)}`}
      </div>
      {o.reason && (
        <p className="sub" style={{ marginTop: 8 }}>
          {o.reason}
        </p>
      )}
      {o.body && <Expandable text={o.body} />}
      <div className="row" style={{ marginTop: 12 }}>
        {o.body && <CopyButton text={o.body} label="Copy text" />}
        {o.person_url && (
          <a className="btn" href={linkedinChatUrl(o.person_url)} target="_blank" rel="noopener noreferrer">
            Open LinkedIn
          </a>
        )}
        {['draft', 'approved'].includes(o.status) && (
          <ActionButton
            primary
            action={markOutreachSent.bind(null, o.id)}
            confirm={`Mark the message to ${o.person_name} as sent? Only after you have actually sent it in LinkedIn.`}
          >
            Mark sent
          </ActionButton>
        )}
        {['sent', 'accepted'].includes(o.status) && (
          <ActionButton action={markOutreachReplied.bind(null, o.id)}>They replied</ActionButton>
        )}
        <CopyButton text={outreachPrompt(o)} label="Copy prompt" />
        {['draft', 'approved'].includes(o.status) && (
          <ActionButton action={skipOutreach.bind(null, o.id)}>Skip</ActionButton>
        )}
      </div>
    </article>
  )
}
