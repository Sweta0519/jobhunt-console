import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOwner } from '../../lib/supabase'
import type { Question } from '../../lib/queries'
import { questionPrompt } from '../../lib/prompts'
import { NavBar, StatusBadge, ExternalLink, relative } from '../../components/ui'
import { ActionButton, CopyButton } from '../../components/ActionButton'
import { skipQuestion, toggleStar, markAnswered } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function QuestionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const id = decodeURIComponent(raw)
  const { supabase } = await requireOwner()

  const { data } = await supabase.from('questions').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const q = data as Question

  async function record(form: FormData) {
    'use server'
    await markAnswered(id, String(form.get('url') || ''), String(form.get('note') || ''))
  }

  return (
    <>
      <NavBar current="/questions" waiting={0} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 20 }}>
          <Link href="/questions">← Questions</Link>
        </p>

        <div className="spread">
          <h1 style={{ marginTop: 8 }}>{q.title}</h1>
          <StatusBadge status={q.status} />
        </div>
        <p className="sub">
          {q.site} · {q.comments === 0 ? 'no replies' : `${q.comments} replies`} ·{' '}
          {relative(q.asked_at)} · rank <span className="num">{q.rank ?? '—'}</span>
        </p>
        {q.why && <p className="sub">{q.why}</p>}

        {q.excerpt && <div className="card-body">{q.excerpt}</div>}

        <div className="row" style={{ marginTop: 16 }}>
          <ExternalLink href={q.url}>
            <span className="btn primary">Open the thread</span>
          </ExternalLink>
          <CopyButton text={questionPrompt(q)} label="Copy prompt for Claude Code" />
          <ActionButton action={toggleStar.bind(null, id, !q.starred)}>
            {q.starred ? 'Unsave' : 'Save for desktop'}
          </ActionButton>
          {q.status === 'new' && (
            <ActionButton action={skipQuestion.bind(null, id)}>Skip</ActionButton>
          )}
        </div>

        <h2>Record your answer</h2>
        <p className="sub">
          Paste the link to your reply. It goes straight into your record, which is what you
          show when you apply.
        </p>
        {q.status === 'answered' && q.answer_url ? (
          <div className="card">
            <p style={{ margin: 0 }}>
              Answered {relative(q.answered_at ?? null)} ·{' '}
              <ExternalLink href={q.answer_url}>your reply</ExternalLink>
            </p>
          </div>
        ) : (
          <form action={record} className="card">
            <input
              name="url"
              type="url"
              required
              placeholder="https://… link to your reply"
              style={inputStyle}
            />
            <input name="note" type="text" placeholder="note (optional)" style={inputStyle} />
            <button className="btn primary" type="submit">
              Mark answered
            </button>
          </form>
        )}

        <h2>Prompt</h2>
        <p className="sub">
          Paste this into Claude Code on your desktop. Drafting stays there so answers get
          checked against the current docs, and it costs nothing extra.
        </p>
        <pre className="card mono">{questionPrompt(q)}</pre>
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
