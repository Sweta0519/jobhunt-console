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
    <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto 12px', padding: '0 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn primary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
      {over && <span className="notice" style={{ margin: 0 }}>{ONE_PAGE_WARNING}</span>}
    </div>
  )
}
