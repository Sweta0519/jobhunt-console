import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePrimary, flagCopy, flagWhere, reasonCopy, type ResumeDraft, type MasterDoc, type FactFlag } from '../../lib/resumes'
import { NavBar, StatusBadge, ExternalLink, Section } from '../../components/ui'
import { ActionButton } from '../../components/ActionButton'
import { Logo } from '../../components/Logo'
import { Editable } from '../Editable'
import { reviewQueue } from '../queue'
import { Diffed } from '../Diffed'
import { ApplicationTab } from './ApplicationTab'
import { Cv } from '../Cv'
import { CvPreview } from '../CvPreview'
import { carlito } from '../cvFont'
import { approveResume, rejectResume, requeueResume, editResumeField } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function ResumeReview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const tab = (await searchParams).tab === 'application' ? 'application' : 'cv'
  const { supabase } = await requirePrimary()

  const { data } = await supabase.from('resume_drafts').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const d = data as ResumeDraft

  const [{ data: job }, { data: desc }, { data: masterRow }, { data: latestRow }, queue] = await Promise.all([
    supabase.from('jobs').select('id,title,company,company_slug,url,careers_url,score,closed').eq('id', d.job_id).maybeSingle(),
    supabase.from('job_descriptions').select('description,sha').eq('job_id', d.job_id).maybeSingle(),
    supabase.from('master_cv').select('doc').eq('version', d.master_version).maybeSingle(),
    supabase.from('master_cv').select('version').order('version', { ascending: false }).limit(1).maybeSingle(),
    reviewQueue(supabase),
  ])
  if (!job) notFound()
  const { data: co } = job.company_slug
    ? await supabase.from('companies').select('logo_path').eq('slug', job.company_slug).maybeSingle()
    : { data: null }
  const master = (masterRow?.doc as MasterDoc | undefined) ?? null
  const doc = d.doc
  const live = ['draft', 'approved'].includes(d.status)

  // Master text by id, for the diff and for the "left out" list.
  const src = new Map<string, string>()
  if (master) {
    master.experience.forEach((r) => r.bullets.forEach((b) => src.set(b.id, b.text)))
    master.projects.forEach((p) => p.bullets.forEach((b) => src.set(b.id, b.text)))
    master.open_source.forEach((o) => src.set(o.id, o.text))
  }
  const cited = new Set<string>()
  const textOf = (from: string[]) => from.map((f) => src.get(f) || '').join(' ')

  const flagsByRef = new Map<string, FactFlag[]>()
  for (const f of d.fact_flags || []) flagsByRef.set(f.ref, [...(flagsByRef.get(f.ref) || []), f])
  const tokens = (ref: string) => (flagsByRef.get(ref) || []).map((f) => f.token).filter(Boolean)

  const bulletsOf = (
    list: { text: string; from: string[] }[],
    pathOf: (i: number) => string,
    who: string
  ) => (
    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
      {list.map((b, i) => {
        b.from.forEach((f) => cited.add(f))
        return (
          <li key={i} style={{ marginBottom: 8 }}>
            {live ? (
              <Editable initial={b.text} limit={260} label={`${who} bullet ${i + 1}`} onSave={editResumeField.bind(null, d.id, pathOf(i))}>
                <Diffed text={b.text} from={textOf(b.from)} flagged={tokens(pathOf(i))} />
              </Editable>
            ) : (
              <Diffed text={b.text} from={textOf(b.from)} flagged={tokens(pathOf(i))} />
            )}
          </li>
        )
      })}
    </ul>
  )

  const olderMaster = latestRow && d.master_version < latestRow.version
  const postingChanged = !!(d.description_sha && desc?.sha && d.description_sha !== desc.sha)
  const flagCount = d.fact_flags?.length ?? 0
  const gapCount = d.gaps?.length ?? 0
  const reqs = d.requirements ?? []
  const reqMet = reqs.filter((r) => r.status === 'met').length
  const canRedraft = ['draft', 'discarded', 'failed', 'skipped'].includes(d.status)

  // Neighbours among the drafts still to review. A draft already approved is not in
  // the queue, so it only offers the first one.
  const pos = queue.indexOf(d.id)
  const prevId = pos > 0 ? queue[pos - 1] : null
  const nextId = pos >= 0 ? (queue[pos + 1] ?? null) : (queue[0] ?? null)

  return (
    <>
      <NavBar current="/resumes" waiting={0} />
      <main className="shell shell-wide">
        <div className="spread resume-nav">
          <Link href="/resumes" className="resume-back">← Resumes</Link>
          {(prevId || nextId) && (
            <nav className="row" aria-label="Drafts to review">
              {pos >= 0 && <span className="card-meta num">{pos + 1} of {queue.length}</span>}
              {prevId && <Link className="btn" href={`/resumes/${prevId}`}>Previous</Link>}
              {nextId && <Link className="btn" href={`/resumes/${nextId}`}>{pos >= 0 ? 'Next' : 'Next to review'}</Link>}
            </nav>
          )}
        </div>

        <div className="spread">
          <h1 style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Logo name={job.company} slug={job.company_slug} path={co?.logo_path as string | null | undefined} size={36} />
            {job.title}
          </h1>
          <span className="score num">{job.score ?? '-'}</span>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="card-meta">{job.company}</span>
          <StatusBadge status={d.status === 'draft' ? 'draft_ready' : d.status} />
          {job.closed && <span className="chip">closed</span>}
          {(job.careers_url || job.url) && <ExternalLink href={(job.careers_url || job.url)!}>Open posting</ExternalLink>}
        </div>

        <nav className="row resume-tabs" aria-label="Resume or application">
          <Link className="chip rtab" href={`/resumes/${d.id}`} aria-current={tab === 'cv' ? 'page' : undefined}>Resume</Link>
          <Link className="chip rtab" href={`/resumes/${d.id}?tab=application`} aria-current={tab === 'application' ? 'page' : undefined}>Application</Link>
          <Link className="chip rtab" href="/resumes/answers">Saved answers</Link>
        </nav>

        {tab === 'application' ? (
          <ApplicationTab supabase={supabase} resumeId={d.id} job={{ id: job.id, url: job.url }} latestVersion={latestRow?.version ?? null} />
        ) : (
        <>
        {doc && (
          <nav className="summary-strip" aria-label="Draft summary">
            {reqs.length > 0 && (
              <a href="#requirements">{reqMet} of {reqs.length} requirements covered</a>
            )}
            <a href="#gaps">{gapCount} gap{gapCount === 1 ? '' : 's'}</a>
            <a href="#flags">{flagCount} flag{flagCount === 1 ? '' : 's'}</a>
          </nav>
        )}

        {(live || canRedraft) && (
          <div className="resume-actionbar" role="toolbar" aria-label="Draft actions">
            {d.status === 'draft' && (
              <ActionButton
                primary
                action={approveResume.bind(null, d.id)}
                confirm={flagCount ? `This draft has ${flagCount} flagged items. Approve anyway?` : undefined}
              >
                Approve
              </ActionButton>
            )}
            {live && (
              <ActionButton action={rejectResume.bind(null, d.id)} confirm="Reject this draft?">
                Reject
              </ActionButton>
            )}
            {live && (
              <a className="btn" href={`/resumes/${d.id}/print?auto=1`} target="_blank" rel="noopener">
                Download PDF
              </a>
            )}
            {canRedraft && (
              <ActionButton action={requeueResume.bind(null, d.id)} confirm={d.edited_at ? 'This replaces your edits.' : undefined}>
                Draft again
              </ActionButton>
            )}
          </div>
        )}
        {d.status === 'draft' && <p className="sub">Approving only marks it ready for you. Nothing is sent.</p>}

        {d.suspicious && <div className="notice">This posting contains text aimed at AI tools. Read it with that in mind.</div>}
        {olderMaster && (
          <div className="notice">
            Drafted from an older version of your CV.{' '}
            <ActionButton action={requeueResume.bind(null, d.id)} confirm={d.edited_at ? 'This replaces your edits.' : undefined}>
              Draft again
            </ActionButton>
          </div>
        )}
        {postingChanged && <div className="notice">The posting changed after this draft was made.</div>}

        {!doc ? (
          <p className="sub">{reasonCopy(d.reason)}</p>
        ) : (
          <div className="resume-grid">
            <div className="resume-main">
              <details className="posting-fold" open>
                <summary><h2>Posting</h2></summary>
                <div className="card">
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>
                    {desc?.description || 'The posting text is not available.'}
                  </div>
                </div>
              </details>

              <h2>Draft</h2>
              <p className="sub">Employers, titles and dates come from your CV and cannot be changed here.</p>
              <p className="sub legend">
                <mark className="diff-add">Dotted underline</mark> marks wording that is not in your CV.{' '}
                <mark className="diff-flag">Wavy underline</mark> marks a fact to check against your CV.
              </p>

              <div className="card">
                <h3 className="card-title">Tagline</h3>
                {live ? (
                  <Editable initial={doc.tagline} limit={140} label="tagline" onSave={editResumeField.bind(null, d.id, 'tagline')}>
                    <Diffed text={doc.tagline} from={master?.tagline || ''} flagged={tokens('tagline')} />
                  </Editable>
                ) : (
                  <Diffed text={doc.tagline} from={master?.tagline || ''} flagged={tokens('tagline')} />
                )}
              </div>

              <div className="card">
                <h3 className="card-title">Summary</h3>
                {live ? (
                  <Editable initial={doc.summary} limit={700} label="summary" onSave={editResumeField.bind(null, d.id, 'summary')}>
                    <Diffed text={doc.summary} from={master?.summary || ''} flagged={tokens('summary')} />
                  </Editable>
                ) : (
                  <Diffed text={doc.summary} from={master?.summary || ''} flagged={tokens('summary')} />
                )}
              </div>

              <div className="card">
                <h3 className="card-title">Skills</h3>
                {doc.skills.map((g) => (
                  <div key={g.id} style={{ marginBottom: 8 }}>
                    {live ? (
                      <Editable initial={g.items.join(', ')} limit={800} label={`${g.label} skills`} onSave={editResumeField.bind(null, d.id, `skills.${g.id}`)}>
                        <b>{g.label}:</b> {g.items.join(', ')}
                      </Editable>
                    ) : (
                      <><b>{g.label}:</b> {g.items.join(', ')}</>
                    )}
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 className="card-title">Experience</h3>
                {doc.experience.map((r) => (
                  <div key={r.id} style={{ marginBottom: 10 }}>
                    <b>{r.title}</b>
                    <div className="card-meta">{r.company} · {r.location} · {r.dates}</div>
                    {bulletsOf(r.bullets, (i) => `experience.${r.id}.${i}`, r.title)}
                  </div>
                ))}
              </div>

              {doc.open_source.length > 0 && (
                <div className="card">
                  <h3 className="card-title">Open source</h3>
                  {bulletsOf(doc.open_source, (i) => `open_source.${i}`, 'open source')}
                </div>
              )}

              {doc.projects.length > 0 && (
                <div className="card">
                  <h3 className="card-title">Projects</h3>
                  {doc.projects.map((p) => (
                    <div key={p.id} style={{ marginBottom: 10 }}>
                      <b>{p.title}</b>
                      <div className="card-meta">{p.meta}</div>
                      {bulletsOf(p.bullets, (i) => `projects.${p.id}.${i}`, p.title)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {live && (
              <aside className={`resume-side ${carlito.className}`}>
                <h2>Resume</h2>
                <CvPreview>
                  <Cv doc={doc} />
                </CvPreview>
              </aside>
            )}
          </div>
        )}

        {(d.requirements?.length ?? 0) > 0 && (
          <div id="requirements" className="anchor">
          <Section title="Requirements">
            <div className="card">
              {d.requirements!.map((r, i) => (
                <div key={i} className="row" style={{ marginBottom: 8 }}>
                  <StatusBadge status={`req_${r.status}`} />
                  <span>{r.text}</span>
                  <span className="chip">{r.kind === 'must' ? 'must have' : 'nice to have'}</span>
                  {r.note && <span className="card-meta">{r.note}</span>}
                </div>
              ))}
            </div>
          </Section>
          </div>
        )}

        {(d.gaps?.length ?? 0) > 0 && (
          <div id="gaps" className="anchor">
          <Section title="Not in your CV" hint="These never appear in the resume.">
            <div className="card">
              {d.gaps!.map((g, i) => (
                <p key={i} style={{ margin: '0 0 8px' }}>
                  {g.text} <span className="chip">{g.kind === 'must' ? 'must have' : 'nice to have'}</span>
                  {g.note && <span className="card-meta"> {g.note}</span>}
                </p>
              ))}
            </div>
          </Section>
          </div>
        )}

        {flagCount > 0 && (
          <div id="flags" className="anchor">
          <Section title="Flags" hint="Check these against your CV before you approve.">
            <div className="card">
              {d.fact_flags!.map((f, i) => {
                const w = flagWhere(f.ref, doc)
                return (
                  <p key={i} style={{ margin: '0 0 6px' }}>
                    {flagCopy(f.code)}{f.token ? <> <code>{f.token}</code></> : null}{' '}
                    <span className="card-meta">{w.where}</span>
                    {w.text ? <> <q className="card-meta">{w.text}</q></> : null}
                  </p>
                )
              })}
            </div>
          </Section>
          </div>
        )}
        {master && doc && (
          <details className="posting-fold" style={{ marginTop: 8 }}>
            <summary><h2>Left out</h2></summary>
            <p className="sub">Parts of your CV this draft does not use.</p>
            <div className="card">
              {(() => {
                const left = [...src.entries()].filter(([k]) => !cited.has(k))
                return left.length === 0 ? (
                  <p className="card-meta" style={{ margin: 0 }}>Everything is used.</p>
                ) : (
                  left.map(([k, t]) => <p key={k} className="card-meta" style={{ margin: '0 0 6px' }}>{t}</p>)
                )
              })()}
            </div>
          </details>
        )}
        </>
        )}

      </main>
    </>
  )
}
