'use client'

import { useState, useTransition } from 'react'

type Result = { ok: true } | { ok: false; message: string }

/**
 * A button that runs a server action and reports what actually happened.
 *
 * It deliberately does not show a success tick of its own: the page revalidates
 * and the status badge is the single source of truth for what state a thing is
 * in. A button that says "Done!" while the row still reads "Draft" is how
 * "approved" starts looking like "sent".
 */
export function ActionButton({
  action,
  children,
  primary,
  confirm,
  disabled,
}: {
  action: () => Promise<Result>
  children: React.ReactNode
  primary?: boolean
  confirm?: string
  disabled?: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={`btn${primary ? ' primary' : ''}`}
        disabled={pending || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          setError(null)
          start(async () => {
            const res = await action()
            if (!res.ok) setError(res.message)
          })
        }}
      >
        {pending ? 'Working…' : children}
      </button>
      {error && (
        <span className="badge fail" role="alert">
          <span aria-hidden="true">▲</span>
          {error}
        </span>
      )}
    </>
  )
}

/** Copy to clipboard, with the fallback older iOS Safari still needs. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied'>('idle')
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const el = document.createElement('textarea')
          el.value = text
          el.style.position = 'fixed'
          el.style.opacity = '0'
          document.body.appendChild(el)
          el.select()
          document.execCommand('copy')
          document.body.removeChild(el)
        }
        setState('copied')
        setTimeout(() => setState('idle'), 2000)
      }}
    >
      {state === 'copied' ? 'Copied' : label}
    </button>
  )
}
