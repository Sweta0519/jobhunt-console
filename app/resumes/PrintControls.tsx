'use client'

import { useEffect, useState } from 'react'
import { runsPastOnePage, ONE_PAGE_WARNING } from './onePage'

/** Print button and a one-page check. Hidden on paper. */
export function PrintControls() {
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (runsPastOnePage()) setOver(true)
    // ?auto=1 opens the print dialog once the font has loaded, so the PDF uses it.
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      document.fonts.ready.then(() => window.print())
    }
  }, [])

  return (
    <div className="no-print print-controls">
      <button type="button" className="btn primary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
      {over && <span className="notice">{ONE_PAGE_WARNING}</span>}
    </div>
  )
}
