'use client'

import { useState } from 'react'
import { ActionButton } from '../../components/ActionButton'
import { saveBankValue } from '../../actions'

type Field = { key: string; label: string; section: string; type: 'text' | 'url' | 'yesno'; value: string }

/**
 * Her saved answers. One save per field; an empty field removes the answer.
 * "Fill from my CV" only fills the inputs on this page from her CV: nothing is
 * saved until she presses Save on a field, so no value is ever seeded for her.
 */
export function BankForm({ fields, sections, suggest }: { fields: Field[]; sections: string[]; suggest: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, f.value])))
  const saved = Object.fromEntries(fields.map((f) => [f.key, f.value]))
  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v }))

  const fill = () => {
    // Only empty fields: a value she saved is never overwritten by a suggestion.
    setValues((cur) => {
      const next = { ...cur }
      for (const [k, v] of Object.entries(suggest)) if (!next[k]?.trim()) next[k] = v
      return next
    })
  }

  return (
    <div>
      {Object.keys(suggest).length > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn" onClick={fill}>Fill from my CV</button>
          <span className="card-meta">Fills empty fields on this page only. Nothing is saved until you press Save.</span>
        </div>
      )}
      {sections.map((section) => (
        <section key={section}>
          <h2>{section}</h2>
          {fields.filter((f) => f.section === section).map((f) => {
            const id = `bank-${f.key}`
            const dirty = (values[f.key] ?? '') !== (saved[f.key] ?? '')
            return (
              <div key={f.key} className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label htmlFor={id} style={{ flex: '1 1 200px', fontWeight: 600 }}>{f.label}</label>
                {f.type === 'yesno' ? (
                  <select id={id} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} style={inputStyle}>
                    <option value="">Not set</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <input
                    id={id}
                    type="text"
                    inputMode={f.type === 'url' ? 'url' : undefined}
                    maxLength={1000}
                    autoComplete="off"
                    value={values[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    style={{ ...inputStyle, flex: '2 1 260px' }}
                  />
                )}
                <ActionButton action={() => saveBankValue(f.key, values[f.key] ?? '')} disabled={!dirty}>
                  Save
                </ActionButton>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 16,
  fontFamily: 'inherit',
}
