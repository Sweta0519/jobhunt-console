import { notFound } from 'next/navigation'
import { requireOwner } from '../../lib/supabase'
import type { Question } from '../../lib/queries'
import { questionPrompt } from '../../lib/prompts'
import { NavBar, PageHeader, Field, StatusBadge, ExternalLink, relative } from '../../components/ui'
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
        <PageHeader
          compact
          title={q.title}
          back={{ href: '/questions', label: 'Questions' }}
          actions={<StatusBadge status={q.status} />}
        >
          <p>
            {q.site} · {q.comments === 0 ? 'no replies' : `${q.comments} replies`} ·{' '}
            {relative(q.asked_at)} · rank <span className="num">{q.rank ?? '-'}</span>
          </p>
          {q.why && <p>{q.why}</p>}
        </PageHeader>

        {q.excerpt && <div className="card-body">{q.excerpt}</div>}

        <div className="card-actions">
          <ExternalLink className="btn primary" href={q.url}>
            Open the thread
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
            <p>
              Answered {relative(q.answered_at ?? null)} ·{' '}
              <ExternalLink href={q.answer_url}>your reply</ExternalLink>
            </p>
          </div>
        ) : (
          <form action={record} className="card form-stack">
            <Field label="Link to your reply" htmlFor="answer-url">
              <input
                id="answer-url"
                className="input"
                name="url"
                type="url"
                required
                placeholder="https://…"
              />
            </Field>
            <Field label="Note (optional)" htmlFor="answer-note">
              <input id="answer-note" className="input" name="note" type="text" />
            </Field>
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
