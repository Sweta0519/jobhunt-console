'use client'

import { useState } from 'react'
import { submitPastedQuestions } from '../actions'

/**
 * Questions copied from the real application page. The text is sent to a server
 * action that checks it and the worker parses it again; it is never shown back
 * as anything but text.
 */
export function PasteBox({ formId, mode, title, hint }: { formId: string; mode: 'replace' | 'add'; title: string; hint: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  return (
    <details className="posting-fold" open={mode === 'replace'}>
      <summary><h2>{title}</h2></summary>
      <p className="sub">{hint}</p>
      <textarea
        value={text}
        aria-label={title}
        maxLength={20000}
        onChange={(e) => { setText(e.target.value); setSent(false) }}
        rows={8}
        placeholder={'One question per line.\nPut choices on the lines below it, each starting with "- ".\nEnd a line with * if it is required.'}
        style={{
          width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--border-strong)',
          background: 'var(--bg)', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', lineHeight: 1.5,
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const res = await submitPastedQuestions(formId, text, mode)
            setBusy(false)
            if (res.ok) { setText(''); setSent(true) }
            else setError(res.message)
          }}
        >
          {busy ? 'Saving…' : mode === 'add' ? 'Add these questions' : 'Use these questions'}
        </button>
        {sent && <span className="card-meta" role="status">Saved. Answers are drafted on the next run.</span>}
        {error && <span className="card-meta" role="alert">{error}</span>}
      </div>
    </details>
  )
}
