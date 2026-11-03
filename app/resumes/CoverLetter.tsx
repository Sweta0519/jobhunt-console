import { safeHref, type ResumeDoc } from '../lib/resumes'
import './cv.css'

/**
 * The cover letter as a one page A4 sheet, in the same frame as the CV so the
 * print stylesheet and the one page check (.cv) apply unchanged.
 *
 * Every string is a React text node. The greeting and the sign-off are fixed
 * strings; name and contact come from the master CV and the company from the job.
 * Nothing is stored: the body is read from the draft when the page renders.
 */
export function CoverLetter({
  name, contact, company, title, body,
}: {
  name: string
  contact: ResumeDoc['contact']
  company: string
  title: string
  body: string
}) {
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return (
    <div className="cv-sheet">
      <div className="cv">
        <table className="cv-page">
          <thead><tr><td /></tr></thead>
          <tfoot><tr><td /></tr></tfoot>
          <tbody>
            <tr>
              <td>
                <h1>{name}</h1>
                <p className="cv-contact">
                  {contact.map((c, i) => {
                    const href = safeHref(c.href)
                    return (
                      <span key={i}>
                        {i > 0 && <span className="cv-sep">|</span>}
                        {href ? <a href={href}>{c.label}</a> : c.label}
                      </span>
                    )
                  })}
                </p>
                <p className="cover-re">{title}, {company}</p>
                <p className="cover-p">Dear hiring team,</p>
                {paragraphs.map((p, i) => <p key={i} className="cover-p">{p}</p>)}
                <p className="cover-p">Kind regards,</p>
                <p className="cover-p">{name}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
