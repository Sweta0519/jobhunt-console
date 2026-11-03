'use client'

import { useState, type ReactNode } from 'react'
import { InlineEdit } from '../components/Interactive'
import { ActionButton, CopyButton } from '../components/ActionButton'
import { editAnswer } from '../actions'

type Option = { id: string; label: string }

/**
 * One question of the application. Every string is a React text node: a label or
 * a draft from the internet is never parsed as markup, linkified or run as
 * Markdown. The status badge arrives as a prop because only the server page may
 * print a status word.
 */
export function AnswerCard({
  draftId,
  qId,
  label,
  required,
  help,
  badge,
  text,
  kind,
  options,
  optionIds,
  editable,
  edited,
  limit,
  note,
  hint,
  flags,
  copyText,
}: {
  draftId: string
  qId: string
  label: string
  required: boolean | null
  help?: string
  badge: ReactNode
  text: string
  kind: string
  options: Option[]
  optionIds: string[]
  editable: boolean
  edited: boolean
  limit?: number
  note: string | null
  hint: string | null
  flags: string[]
  copyText: string
}) {
  const [open, setOpen] = useState(false)
  const choice = kind === 'single_select' || kind === 'multi_select'

  return (
    <div className="card answer-card">
      <div className="spread">
        <h3 className="answer-label">
          {label}
          {required === true && <span className="chip" style={{ marginLeft: 8 }}>required</span>}
        </h3>
        {badge}
      </div>
      {help && <p className="card-meta answer-wrap">{help}</p>}

      {!open && text && <div className="answer-text">{text}</div>}
      {!open && note && <p className="card-meta answer-wrap">{note}</p>}
      {!open && hint && <p className="card-meta answer-wrap">Your saved answer: {hint}</p>}
      {!open && flags.length > 0 && (
        <ul className="answer-flags">
          {flags.map((f, i) => <li key={i} className="card-meta">{f}</li>)}
        </ul>
      )}

      {(editable || copyText) && (
        <div className="row" style={{ marginTop: 8 }}>
          {editable && (choice ? (
            <OptionPicker draftId={draftId} qId={qId} label={label} options={options} initial={optionIds} multi={kind === 'multi_select'} onOpen={setOpen} />
          ) : (
            <InlineEdit initial={text} limit={limit ?? 5000} label={label} onSave={(t) => editAnswer(draftId, qId, t)} onOpenChange={setOpen} />
          ))}
          {!open && copyText && <CopyButton text={copyText} />}
          {!open && editable && edited && <ActionButton action={() => editAnswer(draftId, qId, '', [])}>Use the drafted answer</ActionButton>}
        </div>
      )}
    </div>
  )
}

function OptionPicker({
  draftId, qId, label, options, initial, multi, onOpen,
}: {
  draftId: string
  qId: string
  label: string
  options: Option[]
  initial: string[]
  multi: boolean
  onOpen: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: string) => {
    if (!multi) setPicked([id])
    else setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  }
  const change = (v: boolean) => { setOpen(v); onOpen(v) }

  if (!open) {
    return <button type="button" className="btn" aria-label={`Edit ${label}`} onClick={() => change(true)}>Edit</button>
  }
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, width: '100%' }}>
      <legend className="card-meta">Choose from the form's choices</legend>
      {options.map((o) => (
        <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
          <input type={multi ? 'checkbox' : 'radio'} name={`opt-${qId}`} checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
          <span className="answer-wrap">{o.label}</span>
        </label>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !picked.length}
          onClick={async () => {
            setBusy(true)
            setError(null)
            const res = await editAnswer(draftId, qId, '', picked)
            setBusy(false)
            if (res.ok) change(false)
            else setError(res.message)
          }}
        >
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
        <button type="button" className="btn" onClick={() => { setPicked(initial); change(false); setError(null) }}>Cancel</button>
        {error && <span className="card-meta" role="alert">{error}</span>}
      </div>
    </fieldset>
  )
}
