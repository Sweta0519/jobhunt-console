import type { ReactNode } from 'react'
import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'
import { Bell } from './Bell'
import { getSupabase } from '../lib/supabase'

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

    // prep drills: done means there is evidence or a written-up story behind it
    done: { tone: 'done', glyph: '✓', label: 'Done' },
    doing: { tone: 'wait', glyph: '◷', label: 'In progress' },
    todo: { tone: 'inert', glyph: '·', label: 'To do' },

    // waiting: a decision exists but nothing has gone out
    draft: { tone: 'wait', glyph: '✎', label: 'Draft' },
    approved: { tone: 'wait', glyph: '◷', label: 'Approved, not sent' },
    rendered: { tone: 'wait', glyph: '◷', label: 'Ready to publish' },
    new: { tone: 'wait', glyph: '●', label: 'Open' },
    shortlisted: { tone: 'wait', glyph: '★', label: 'Shortlisted' },

    // resume drafts: queued and drafting are the worker's, draft_ready is hers to read
    queued: { tone: 'wait', glyph: '◷', label: 'Queued' },
    drafting: { tone: 'wait', glyph: '◷', label: 'Drafting' },
    draft_ready: { tone: 'wait', glyph: '✎', label: 'Draft ready' },
    discarded: { tone: 'inert', glyph: '–', label: 'Discarded' },

    // how well her CV covers one requirement of a posting
    req_met: { tone: 'inert', glyph: '✓', label: 'Covered' },
    req_partial: { tone: 'wait', glyph: '◷', label: 'Partly' },
    req_gap: { tone: 'fail', glyph: '▲', label: 'Gap' },

    // application answers: teal stays reserved for what really happened, so none of these use it
    ans_ready: { tone: 'inert', glyph: '✓', label: 'Ready' },
    ans_check: { tone: 'wait', glyph: '◷', label: 'Check this' },
    ans_edited: { tone: 'inert', glyph: '✎', label: 'Edited' },
    ans_needs_you: { tone: 'fail', glyph: '▲', label: 'Needs you' },
    ans_blank: { tone: 'inert', glyph: '·', label: 'Left for you' },
    ans_upload: { tone: 'inert', glyph: '↑', label: 'Attach' },
    form_partial: { tone: 'wait', glyph: '◷', label: 'May be incomplete' },

    failed: { tone: 'fail', glyph: '▲', label: 'Failed' },

    skipped: { tone: 'inert', glyph: '–', label: 'Skipped' },
    closed: { tone: 'inert', glyph: '–', label: 'Closed' },
    rejected: { tone: 'inert', glyph: '–', label: 'Rejected' },
    found: { tone: 'inert', glyph: '·', label: 'Not applied' },

    // job boards: roles already open when a board was first read, and the board candidates
    backlog: { tone: 'inert', glyph: '·', label: 'Already open' },
    board_watching: { tone: 'done', glyph: '✓', label: 'Watching' },
    board_review: { tone: 'wait', glyph: '◷', label: 'Needs a look' },
    board_rejected: { tone: 'inert', glyph: '·', label: 'Not them' },
    board_stopped: { tone: 'inert', glyph: '·', label: 'Not watching' },
    board_unsupported: { tone: 'inert', glyph: '·', label: 'Check by hand' },
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
  id,
  children,
}: {
  title: string
  hint?: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <section id={id}>
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

/** Big number tile on Today. The wait dot is decoration; label and number carry the meaning. */
export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: string | null
  href: string
  tone?: 'wait'
}) {
  return (
    <Link href={href} className={`stat${tone ? ` ${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </Link>
  )
}

const ICON_PATHS: Record<string, ReactNode> = {
  today: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  approvals: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </>
  ),
  questions: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  jobs: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
    </>
  ),
  resumes: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  outreach: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />,
  posts: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  companies: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 21v-4h6v4M9 7h1M14 7h1M9 11h1M14 11h1" />
    </>
  ),
  record: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />,
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

/** 18px icons keyed by section name. The tab bar uses Icon at 22px directly. */
export const ICONS: Record<string, ReactNode> = Object.fromEntries(
  Object.keys(ICON_PATHS).map((k) => [k, <Icon key={k} name={k} />])
)

function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M23 15v-4.5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4V15" fill="none" stroke="#1f6c9f" strokeWidth="4.5" />
      <rect x="3" y="14" width="58" height="46" rx="11" fill="#1f6c9f" />
      <path d="M17 28.5l9.5 8-9.5 8" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32.5 44.5h14" stroke="#9fd6f7" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  )
}

type NavItem = { href: string; label: string; icon: string; primaryOnly?: boolean }

export async function NavBar({ current, waiting }: { current: string; waiting: number }) {
  // Questions, posts and resumes are hers alone; anyone else in the console has
  // the job-hunt half, so those tabs would only ever be empty for them.
  const supabase = await getSupabase()
  const { data: primary } = await supabase.rpc('is_primary')
  const item = (href: string, label: string, icon: string, primaryOnly?: boolean): NavItem => ({
    href,
    label,
    icon,
    primaryOnly,
  })
  const keep = (l: NavItem) => primary || !l.primaryOnly
  const groups: { name: string; links: NavItem[] }[] = [
    {
      name: 'Daily',
      links: [
        item('/', 'Today', 'today'),
        item('/approvals', 'Approvals', 'approvals'),
        item('/questions', 'Questions', 'questions', true),
      ].filter(keep),
    },
    {
      name: 'Search',
      links: [
        item('/jobs', 'Jobs', 'jobs'),
        item('/companies', 'Companies', 'companies'),
        item('/resumes', 'Resumes', 'resumes', true),
      ].filter(keep),
    },
    {
      name: 'Network',
      links: [
        item('/outreach', 'Outreach', 'outreach'),
        item('/posts', 'Posts', 'posts', true),
        item('/record', 'Record', 'record'),
      ].filter(keep),
    },
  ].filter((g) => g.links.length > 0)
  // The only way in used to be the LinkedIn expiry warning, which nobody
  // but her ever sees, so a second person could not find "change password".
  const settings = item('/settings', 'Settings', 'settings')

  const tabLinks: NavItem[] = [
    item('/', 'Today', 'today'),
    item('/approvals', 'Approvals', 'approvals'),
    item('/jobs', 'Jobs', 'jobs'),
    primary ? item('/resumes', 'Resumes', 'resumes') : item('/record', 'Record', 'record'),
  ]
  const inBar = new Set(tabLinks.map((t) => t.href))
  const sheetLinks = [...groups.flatMap((g) => g.links), settings].filter((l) => !inBar.has(l.href))
  const moreActive = sheetLinks.some((l) => l.href === current)

  const count = (href: string) =>
    href === '/approvals' && waiting > 0 ? <span className="count num">{waiting}</span> : null

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <BrandMark />
            Jobhunt
          </Link>
          <span className="bell-mobile">
            <Bell />
          </span>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href="/" className="brand">
            <BrandMark />
            Jobhunt
          </Link>
          <span className="bell-desktop">
            <Bell />
          </span>
        </div>
        <nav aria-label="Sections" className="side-nav">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="side-group">{g.name}</div>
              {g.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="navlink"
                  aria-current={l.href === current ? 'page' : undefined}
                >
                  {ICONS[l.icon]}
                  {l.label}
                  {count(l.href)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link
            href={settings.href}
            className="navlink"
            aria-current={settings.href === current ? 'page' : undefined}
          >
            {ICONS[settings.icon]}
            {settings.label}
          </Link>
          <ThemeToggle />
        </div>
      </aside>

      <nav className="tabbar" aria-label="Main">
        {tabLinks.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="tab"
            aria-current={t.href === current ? 'page' : undefined}
          >
            <span className="tab-icon">
              <Icon name={t.icon} size={22} />
              {count(t.href)}
            </span>
            {t.label}
          </Link>
        ))}
        <details className="tab-more">
          <summary className={`tab${moreActive ? ' is-active' : ''}`}>
            <span className="tab-icon">
              <Icon name="more" size={22} />
            </span>
            More
          </summary>
          <div className="more-sheet">
            {sheetLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="navlink"
                aria-current={l.href === current ? 'page' : undefined}
              >
                {ICONS[l.icon]}
                {l.label}
              </Link>
            ))}
            <ThemeToggle />
          </div>
        </details>
      </nav>
    </>
  )
}
