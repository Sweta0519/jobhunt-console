'use client'

import { useMemo, useState, useEffect, useRef } from 'react'

/**
 * Client-side filter over an already-rendered list.
 *
 * The data is small (a few hundred rows) and already on the page, so filtering
 * here is instant and costs no round trip. Each child carries a `data-search`
 * string built on the server.
 */
export function FilterBar({
  children,
  placeholder = 'Filter…',
  chips = [],
  total,
}: {
  children: React.ReactNode[]
  placeholder?: string
  chips?: { label: string; term: string }[]
  total?: number
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" focuses the filter, the way every list on the web does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && typing) {
        setQ('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const terms = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q])

  const shown = useMemo(() => {
    if (!terms.length) return children
    return (children as React.ReactElement<{ 'data-search'?: string }>[]).filter((child) => {
      const hay = (child?.props?.['data-search'] || '').toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [children, terms])

  return (
    <>
      <div className="toolbar">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input filter-input"
        />
        {chips.map((c) => (
          <button
            key={c.term}
            type="button"
            className="chip"
            aria-pressed={q === c.term}
            onClick={() => setQ(q === c.term ? '' : c.term)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {q && (
        <p className="sub num" aria-live="polite">
          {shown.length} of {total ?? (children as unknown[]).length}
        </p>
      )}
      {shown.length === 0 ? <div className="empty">Nothing matches “{q}”.</div> : shown}
    </>
  )
}

/**
 * Long text that starts collapsed. A caption or a message body is worth a
 * glance before deciding to read it, and an approvals screen where every card
 * is a wall of text is one nobody scrolls to the bottom of.
 */
export function Expandable({ text, lines = 6 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > lines || text.length > 420
  if (!long) return <div className="card-body">{text}</div>
  return (
    <>
      <div
        className={open ? 'card-body' : 'card-body clamp'}
        style={!open && lines !== 6 ? ({ '--lines': lines } as React.CSSProperties) : undefined}
      >
        {text}
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="chip expand-toggle"
        aria-expanded={open}
      >
        {open ? 'Show less' : 'Show all'}
      </button>
    </>
  )
}

/**
 * Edit a draft in place.
 *
 * Saving returns the item to draft on purpose: approval applies to the words
 * she read, not to whatever replaced them.
 */
export function InlineEdit({
  initial,
  limit,
  onSave,
  label,
  onOpenChange,
}: {
  initial: string
  limit?: number
  onSave: (text: string) => Promise<{ ok: true } | { ok: false; message: string }>
  /** Names the field for assistive tech: "Edit summary". Optional. */
  label?: string
  /** Lets a parent hide the read-only text while the editor is open. Optional. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="btn" aria-label={label ? `Edit ${label}` : undefined} onClick={() => setOpen(true)}>
        Edit
      </button>
    )
  }

  const over = limit ? text.length > limit : false

  return (
    <div className="inline-edit">
      <textarea
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(16, Math.max(5, text.split('\n').length + 2))}
        className="input"
        aria-invalid={over}
      />
      <div className="card-actions">
        {limit && (
          <span className={`card-meta num${over ? ' is-over' : ''}`}>
            {text.length} / {limit}
          </span>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={busy || over || !text.trim()}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const res = await onSave(text)
            setBusy(false)
            if (res.ok) setOpen(false)
            else setError(res.message)
          }}
        >
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText(initial)
            setOpen(false)
            setError(null)
          }}
        >
          Cancel
        </button>
        {error && (
          <span className="badge fail" role="alert">
            <span aria-hidden="true">▲</span>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
