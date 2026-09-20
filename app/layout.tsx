import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ThemeScript } from './components/ThemeToggle'

export const metadata: Metadata = {
  title: 'Jobhunt Console',
  description: 'Private job-search console',
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
