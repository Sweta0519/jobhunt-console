'use client'

import { useId, useState, useTransition } from 'react'
import { Field } from './Field'

type Result = { ok: true } | { ok: false; message: string }

/**
 * The controls under one prep drill.
 *
 * "Done" opens a small form rather than flipping the status at once, because
 * done is supposed to mean something happened: for a public drill it wants
 * the link, for the others at least a line of what you found. A checklist
 * that can be ticked without evidence is a to-do list, and the point of this
 * one is that each tick is a story she can tell in an interview.
 */
export function DrillActions({
  status,
  level,
  evidence,
  note,
  onSet,
}: {
  status: string
  level: number
  evidence: string | null
  note: string | null
  onSet: (status: string, evidence?: string, note?: string) => Promise<Result>
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(evidence ?? '')
  const [text, setText] = useState(note ?? '')
  const uid = useId()
  const urlId = `${uid}-evidence`
  const textId = `${uid}-found`

  const run = (s: string, e?: string, n?: string) => {
    setError(null)
    start(async () => {
      const res = await onSet(s, e, n)
      if (!res.ok) setError(res.message)
      else setOpen(false)
    })
  }

  return (
    <div className="drill-actions">
      <div className="row">
        {status === 'todo' && (
          <button type="button" className="btn" disabled={pending} onClick={() => run('doing')}>
            Start
          </button>
        )}
        {status !== 'done' && (
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => setOpen((o) => !o)}
          >
            Mark done
          </button>
        )}
        {status === 'done' && (
          <button type="button" className="btn" disabled={pending} onClick={() => setOpen((o) => !o)}>
            Edit evidence
          </button>
        )}
        {status !== 'skipped' && status !== 'done' && (
          <button type="button" className="btn" disabled={pending} onClick={() => run('skipped')}>
            Skip
          </button>
        )}
        {(status === 'skipped' || status === 'done') && (
          <button type="button" className="btn" disabled={pending} onClick={() => run('todo')}>
            Reopen
          </button>
        )}
        {error && (
          <span className="badge fail" role="alert">
            <span aria-hidden="true">▲</span>
            {error}
          </span>
        )}
      </div>

      {open && (
        <div className="card nested form-stack">
          <Field
            label={`Evidence link${level === 3 ? ' (required for a public drill)' : ' (optional)'}`}
            htmlFor={urlId}
          >
            <input
              id={urlId}
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field label="What you found, in a line or two" htmlFor={textId}>
            <textarea
              id={textId}
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="The one thing you would say about this in an interview."
            />
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={pending || (level === 3 && !url.trim())}
              onClick={() => run('done', url, text)}
            >
              {pending ? 'Saving…' : 'Save as done'}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
