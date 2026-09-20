'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
const KEY = 'jobhunt-theme'

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/**
 * Light, dark or follow the system.
 *
 * Stored per browser in localStorage, which can throw or come back empty in a
 * private window, so every access is guarded and the page renders correctly
 * without it.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Theme | null
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setTheme(saved)
        apply(saved)
      }
    } catch {
      /* private window, or site data blocked */
    }
  }, [])

  const choose = (next: Theme) => {
    setTheme(next)
    apply(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* the choice still applies for this page */
    }
  }

  const options: { value: Theme; label: string; glyph: string }[] = [
    { value: 'light', label: 'Light', glyph: '☼' },
    { value: 'dark', label: 'Dark', glyph: '☾' },
    { value: 'system', label: 'System', glyph: '◐' },
  ]

  return (
    <div
      role="group"
      aria-label="Colour theme"
      style={{ display: 'inline-flex', gap: 2, marginLeft: 6 }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => choose(o.value)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={theme === o.value}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            fontFamily: 'inherit',
            background: theme === o.value ? 'var(--surface-2)' : 'transparent',
            color: theme === o.value ? 'var(--text)' : 'var(--faint)',
          }}
        >
          <span aria-hidden="true">{o.glyph}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Applies the saved theme before first paint. Without this the page renders in
 * the system theme for a frame and then flips, which is worse than either.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`
  return <script dangerouslySetInnerHTML={{ __html: js }} />
}
