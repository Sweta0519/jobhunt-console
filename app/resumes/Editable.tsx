'use client'

import { useState, type ReactNode } from 'react'
import { InlineEdit } from '../components/Interactive'

type Result = { ok: true } | { ok: false; message: string }

/**
 * A field of the draft: the text with a small Edit button. Opening the editor
 * swaps the text for the editor, so nothing is shown twice.
 */
export function Editable({
  children,
  initial,
  limit,
  label,
  onSave,
}: {
  children: ReactNode
  initial: string
  limit?: number
  label: string
  onSave: (text: string) => Promise<Result>
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="editable">
      {!open && <div className="editable-text">{children}</div>}
      <InlineEdit initial={initial} limit={limit} label={label} onSave={onSave} onOpenChange={setOpen} />
    </div>
  )
}
