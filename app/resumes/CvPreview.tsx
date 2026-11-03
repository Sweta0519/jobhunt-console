'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { runsPastOnePage, ONE_PAGE_WARNING } from './onePage'

const SHEET_W = 794 // 210 mm at 96 dpi

/** An A4 sheet scaled down to the width of its column, with the one-page check. */
export function CvPreview({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(0) // unscaled
  const [over, setOver] = useState(false)

  useEffect(() => {
    const b = box.current
    const s = sheet.current
    if (!b || !s) return
    const measure = () => {
      setScale(Math.min(1, b.clientWidth / SHEET_W))
      setHeight(s.offsetHeight)
      setOver(runsPastOnePage(s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(b)
    ro.observe(s)
    document.fonts.ready.then(measure)
    return () => ro.disconnect()
  }, [])

  return (
    <div>
      {over && <div className="notice">{ONE_PAGE_WARNING}</div>}
      {/* A picture of the printed page. The sheet has its own h1 and h2 and links, so it is
          inert: the draft cards beside it carry the same text for keyboards and readers. */}
      <div ref={box} className="cv-preview" role="img" aria-label="Preview of the resume as it will print">
        <div className="cv-preview-fit" style={{ height: height ? height * scale : undefined }}>
          <div ref={sheet} className="cv-preview-sheet" inert style={{ transform: `scale(${scale})` }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
