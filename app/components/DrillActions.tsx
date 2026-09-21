'use client'

import { useState, useTransition } from 'react'

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

  const run = (s: string, e?: string, n?: string) => {
    setError(null)
    start(async () => {
      const res = await onSet(s, e, n)
      if (!res.ok) setError(res.message)
      else setOpen(false)
    })
  }

  return (
    <div style={{ width: '100%' }}>
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
        <div className="card" style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Evidence link{level === 3 ? ' (required for a public drill)' : ' (optional)'}
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            style={field}
          />
          <label style={{ fontSize: 13, fontWeight: 600 }}>What you found, in a line or two</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="The one thing you would say about this in an interview."
            style={{ ...field, lineHeight: 1.5 }}
          />
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

const field: React.CSSProperties = {
  width: '100%',
  marginTop: 6,
  marginBottom: 12,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 15,
  fontFamily: 'inherit',
}
