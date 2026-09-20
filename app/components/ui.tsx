import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'

/**
 * The only component allowed to print a status word.
 *
 * One rule runs through the whole console: "approved" must never read as
 * "sent". Green is reserved for something that actually happened and has an
 * artifact to point at; anything still waiting on her is amber. Every badge
 * carries a glyph as well as colour, so a quick glance is never decided by hue.
 */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: string; glyph: string; label: string }> = {
    // done: it happened, there is a URL or a timestamp behind it
    sent: { tone: 'done', glyph: '✓', label: 'Sent' },
    accepted: { tone: 'done', glyph: '✓', label: 'Accepted' },
    replied: { tone: 'done', glyph: '✓', label: 'Replied' },
    published: { tone: 'done', glyph: '✓', label: 'Published' },
    answered: { tone: 'done', glyph: '✓', label: 'Answered' },
    applied: { tone: 'done', glyph: '✓', label: 'Applied' },
    interview: { tone: 'done', glyph: '✓', label: 'Interviewing' },

    // waiting: a decision exists but nothing has gone out
    draft: { tone: 'wait', glyph: '✎', label: 'Draft' },
    approved: { tone: 'wait', glyph: '◷', label: 'Approved, not sent' },
    rendered: { tone: 'wait', glyph: '◷', label: 'Ready to publish' },
    new: { tone: 'wait', glyph: '●', label: 'Open' },
    shortlisted: { tone: 'wait', glyph: '★', label: 'Shortlisted' },

    failed: { tone: 'fail', glyph: '▲', label: 'Failed' },

    skipped: { tone: 'inert', glyph: '–', label: 'Skipped' },
    closed: { tone: 'inert', glyph: '–', label: 'Closed' },
    rejected: { tone: 'inert', glyph: '–', label: 'Rejected' },
    found: { tone: 'inert', glyph: '·', label: 'Not applied' },
    saved: { tone: 'inert', glyph: '☆', label: 'Saved' },
  }
  const s = map[status] ?? { tone: 'inert', glyph: '·', label: status }
  return (
    <span className={`badge ${s.tone}`}>
      <span aria-hidden="true">{s.glyph}</span>
      {s.label}
    </span>
  )
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2>{title}</h2>
      {hint && <p className="sub">{hint}</p>}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

/** Berlin time everywhere. A post that says Thursday must not publish Wednesday. */
const BERLIN = 'Europe/Berlin'

export function formatDay(value?: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: BERLIN,
  })
}

export function relative(value?: string | null) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const h = diff / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(diff / 60_000))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d}d ago`
  return formatDay(value)
}

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

export function NavBar({ current, waiting }: { current: string; waiting: number }) {
  const links = [
    { href: '/', label: 'Today' },
    { href: '/approvals', label: 'Approvals' },
    { href: '/questions', label: 'Questions' },
    { href: '/jobs', label: 'Jobs' },
    { href: '/outreach', label: 'Outreach' },
    { href: '/posts', label: 'Posts' },
    { href: '/record', label: 'Record' },
  ]
  const tabs = [
    { href: '/', label: 'Today' },
    { href: '/approvals', label: 'Approvals', count: waiting },
    { href: '/jobs', label: 'Jobs' },
    { href: '/record', label: 'Record' },
  ]
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            Jobhunt
          </Link>
          <nav className="navlinks">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="navlink"
                aria-current={l.href === current ? 'page' : undefined}
              >
                {l.label}
                {l.href === '/approvals' && waiting > 0 ? ` (${waiting})` : ''}
              </Link>
            ))}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <nav className="tabbar">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="tab"
            aria-current={t.href === current ? 'page' : undefined}
          >
            {t.label}
            {t.count ? <span className="count num">{t.count}</span> : null}
          </Link>
        ))}
      </nav>
    </>
  )
}
