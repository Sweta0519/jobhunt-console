import { Carlito } from 'next/font/google'

// Metric-compatible with Calibri, served from /_next/static: the same letters on
// every device, and no request to Google at runtime. Shared by the print page and
// the review page preview, so the font loads once.
export const carlito = Carlito({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap' })
