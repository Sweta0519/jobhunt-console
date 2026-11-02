import type { ReactNode } from 'react'
import { safeHref, type ResumeDoc } from '../lib/resumes'
import './cv.css'

/**
 * The CV. One server component for the preview and for print.
 *
 * Every string is a React text node. A string only becomes a link when it equals
 * the visible label of a link in the master CV exactly, and the href comes from
 * the master, never from the text, so nothing a model wrote can become a link.
 */
export function linkify(text: string, links: { label: string; href: string }[]): ReactNode[] {
  const known = links.filter((l) => l.label && safeHref(l.href))
  const out: ReactNode[] = []
  let rest = text
  let key = 0
  while (rest) {
    let best: { at: number; link: { label: string; href: string } } | null = null
    for (const l of known) {
      const at = rest.indexOf(l.label)
      if (at >= 0 && (!best || at < best.at || (at === best.at && l.label.length > best.link.label.length))) best = { at, link: l }
    }
    if (!best) { out.push(rest); break }
    if (best.at > 0) out.push(rest.slice(0, best.at))
    out.push(
      <a key={key++} href={safeHref(best.link.href)!} target="_blank" rel="noopener noreferrer">
        {best.link.label}
      </a>
    )
    rest = rest.slice(best.at + best.link.label.length)
  }
  return out
}

export function Cv({ doc }: { doc: ResumeDoc }) {
  const L = (t: string) => linkify(t, doc.links || [])
  return (
    <div className="cv-sheet">
      <div className="cv">
        <table className="cv-page">
          <thead><tr><td /></tr></thead>
          <tfoot><tr><td /></tr></tfoot>
          <tbody>
            <tr>
              <td>
                <h1>{doc.name}</h1>
                <p className="cv-tagline">{doc.tagline}</p>
                <p className="cv-contact">
                  {doc.contact.map((c, i) => {
                    const href = safeHref(c.href)
                    return (
                      <span key={i}>
                        {i > 0 && <span className="cv-sep">|</span>}
                        {href ? <a href={href}>{c.label}</a> : c.label}
                      </span>
                    )
                  })}
                </p>

                <h2>Summary</h2>
                <p>{doc.summary}</p>

                <h2>Skills</h2>
                <div className="cv-skills">
                  {doc.skills.map((g) => (
                    <p key={g.id}><b>{g.label}:</b> {g.items.join(', ')}.</p>
                  ))}
                  <p><b>{doc.languages.label}:</b> {doc.languages.items.join(', ')}.</p>
                </div>

                <h2>Experience</h2>
                {doc.experience.map((r) => (
                  <div className="cv-role" key={r.id}>
                    <div className="cv-role-head"><span>{r.title}</span><span>{r.dates}</span></div>
                    <div className="cv-meta">{r.company} | {r.location}</div>
                    <ul>{r.bullets.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
                  </div>
                ))}

                {doc.open_source.length > 0 && (
                  <>
                    <h2>Open Source</h2>
                    <ul>{doc.open_source.map((b, i) => <li key={i}>{L(b.text)}</li>)}</ul>
                  </>
                )}

                {doc.projects.length > 0 && (
                  <>
                    <h2>Projects</h2>
                    {doc.projects.map((p) => (
                      <div className="cv-role" key={p.id}>
                        <div className="cv-role-head"><span>{L(p.title)}</span></div>
                        {p.meta && <div className="cv-meta">{p.meta}</div>}
                        <ul>{p.bullets.map((b, i) => <li key={i}>{L(b.text)}</li>)}</ul>
                      </div>
                    ))}
                  </>
                )}

                <h2>Education</h2>
                {doc.education.map((e, i) => (
                  <p key={i}><b>{e.title}</b>{e.meta ? ` | ${e.meta}` : ''}</p>
                ))}

                {doc.awards.length > 0 && (
                  <>
                    <h2>Awards</h2>
                    <p>{doc.awards.join(' | ')}</p>
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
