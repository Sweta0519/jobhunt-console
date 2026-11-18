import type { ReactNode } from 'react'
export function Field({ label, htmlFor, hint, error, children }: {
  label: ReactNode; htmlFor: string; hint?: ReactNode; error?: ReactNode; children: ReactNode
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  )
}
