'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { markNotificationsRead } from '../actions'

export type Note = {
  id: string
  kind: string
  severity: 'action' | 'news'
  title: string
  body: string | null
  url: string | null
  created_at: string
  read_at: string | null
}

function ago(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

export function BellMenu({ notes }: { notes: Note[] }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  const actions = notes.filter((n) => n.severity === 'action')
  const news = notes.filter((n) => n.severity === 'news')
  // The badge counts only what needs doing, so it never cries wolf.
  const count = actions.length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 4 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={count ? `Notifications, ${count} needing attention` : 'Notifications'}
        aria-expanded={open}
        style={{
          position: 'relative',
          width: 30,
          height: 30,
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          background: open ? 'var(--surface-2)' : 'transparent',
          color: count ? 'var(--text)' : 'var(--faint)',
          fontSize: 15,
          lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        <span aria-hidden="true">◍</span>
        {count > 0 && (
          <span
            className="num"
            style={{
              position: 'absolute',
              top: -1,
              right: -2,
              minWidth: 15,
              height: 15,
              padding: '0 3px',
              borderRadius: 8,
              background: 'var(--wait)',
              color: 'var(--surface)',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '15px',
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            right: 0,
            top: 38,
            width: 'min(360px, calc(100vw - 32px))',
            maxHeight: 460,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.10)',
            zIndex: 50,
            padding: 6,
          }}
        >
          {notes.length === 0 ? (
            <p className="sub" style={{ padding: 16, margin: 0 }}>
              Nothing needs your attention.
            </p>
          ) : (
            <>
              {actions.length > 0 && <Group label="Needs you" notes={actions} />}
              {news.length > 0 && <Group label="Happened" notes={news} />}
              <button
                type="button"
                className="btn"
                disabled={pending}
                style={{ width: '100%', marginTop: 6 }}
                onClick={() =>
                  start(async () => {
                    await markNotificationsRead(notes.map((n) => n.id))
                    setOpen(false)
                  })
                }
              >
                {pending ? 'Clearing…' : 'Mark all read'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, notes }: { label: string; notes: Note[] }) {
  return (
    <>
      <p
        style={{
          margin: '6px 10px 4px',
          fontSize: 10.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      {notes.map((n) => {
        const external = n.url?.startsWith('http')
        const body = (
          <>
            <span style={{ fontWeight: 500, fontSize: 13.5, display: 'block' }}>{n.title}</span>
            {n.body && (
              <span style={{ color: 'var(--muted)', fontSize: 12.5, display: 'block' }}>
                {n.body.slice(0, 90)}
              </span>
            )}
            <span style={{ color: 'var(--faint)', fontSize: 11 }}>{ago(n.created_at)} ago</span>
          </>
        )
        const style: React.CSSProperties = {
          display: 'block',
          padding: '9px 10px',
          borderRadius: 7,
          textDecoration: 'none',
          borderLeft: `2px solid ${n.severity === 'action' ? 'var(--wait)' : 'var(--border)'}`,
        }
        return n.url ? (
          <a
            key={n.id}
            href={n.url}
            style={style}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {body}
          </a>
        ) : (
          <div key={n.id} style={style}>
            {body}
          </div>
        )
      })}
    </>
  )
}
