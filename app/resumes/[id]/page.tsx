import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePrimary, flagCopy, reasonCopy, type ResumeDraft, type MasterDoc, type FactFlag } from '../../lib/resumes'
import { NavBar, StatusBadge, ExternalLink, Section } from '../../components/ui'
import { ActionButton } from '../../components/ActionButton'
import { Logo } from '../../components/Logo'
import { InlineEdit } from '../../components/Interactive'
import { Diffed } from '../Diffed'
import { approveResume, rejectResume, requeueResume, editResumeField } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function ResumeReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requirePrimary()

  const { data } = await supabase.from('resume_drafts').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const d = data as ResumeDraft

  const [{ data: job }, { data: desc }, { data: masterRow }, { data: latestRow }] = await Promise.all([
    supabase.from('jobs').select('id,title,company,company_slug,url,score,closed').eq('id', d.job_id).maybeSingle(),
    supabase.from('job_descriptions').select('description,sha').eq('job_id', d.job_id).maybeSingle(),
    supabase.from('master_cv').select('doc').eq('version', d.master_version).maybeSingle(),
    supabase.from('master_cv').select('version').order('version', { ascending: false }).limit(1).maybeSingle(),
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
    pathOf: (i: number) => string
  ) => (
    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
      {list.map((b, i) => {
        b.from.forEach((f) => cited.add(f))
        return (
          <li key={i} style={{ marginBottom: 8 }}>
            <Diffed text={b.text} from={textOf(b.from)} flagged={tokens(pathOf(i))} />
            {live && (
              <div style={{ marginTop: 4 }}>
                <InlineEdit initial={b.text} limit={260} onSave={editResumeField.bind(null, d.id, pathOf(i))} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )

  const olderMaster = latestRow && d.master_version < latestRow.version
  const postingChanged = !!(d.description_sha && desc?.sha && d.description_sha !== desc.sha)
  const flagCount = d.fact_flags?.length ?? 0

  return (
    <>
      <NavBar current="/resumes" waiting={0} />
      <main className="shell">
        <p className="sub" style={{ marginTop: 20 }}>
          <Link href="/resumes">← Resumes</Link>
        </p>

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
          {job.url && <ExternalLink href={job.url}>Open posting</ExternalLink>}
          {live && doc && (
            <a className="btn" href={`/resumes/${d.id}/print`} target="_blank" rel="noopener">
              Preview resume
            </a>
          )}
        </div>

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
            <div>
              <h2>Posting</h2>
              <div className="card">
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>
                  {desc?.description || 'The posting text is not available.'}
                </div>
              </div>
            </div>

            <div>
              <h2>Draft</h2>
              <p className="sub">Employers, titles and dates come from your CV and cannot be changed here.</p>

              <div className="card">
                <h3 className="card-title">Tagline</h3>
                <Diffed text={doc.tagline} from={master?.tagline || ''} flagged={tokens('tagline')} />
                {live && <div style={{ marginTop: 6 }}><InlineEdit initial={doc.tagline} limit={140} onSave={editResumeField.bind(null, d.id, 'tagline')} /></div>}
              </div>

              <div className="card">
                <h3 className="card-title">Summary</h3>
                <Diffed text={doc.summary} from={master?.summary || ''} flagged={tokens('summary')} />
                {live && <div style={{ marginTop: 6 }}><InlineEdit initial={doc.summary} limit={700} onSave={editResumeField.bind(null, d.id, 'summary')} /></div>}
              </div>

              <div className="card">
                <h3 className="card-title">Skills</h3>
                {doc.skills.map((g) => (
                  <div key={g.id} style={{ marginBottom: 8 }}>
                    <b>{g.label}:</b> {g.items.join(', ')}
                    {live && (
                      <div style={{ marginTop: 4 }}>
                        <InlineEdit initial={g.items.join(', ')} limit={800} onSave={editResumeField.bind(null, d.id, `skills.${g.id}`)} />
                      </div>
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
                    {bulletsOf(r.bullets, (i) => `experience.${r.id}.${i}`)}
                  </div>
                ))}
              </div>

              {doc.open_source.length > 0 && (
                <div className="card">
                  <h3 className="card-title">Open source</h3>
                  {bulletsOf(doc.open_source, (i) => `open_source.${i}`)}
                </div>
              )}

              {doc.projects.length > 0 && (
                <div className="card">
                  <h3 className="card-title">Projects</h3>
                  {doc.projects.map((p) => (
                    <div key={p.id} style={{ marginBottom: 10 }}>
                      <b>{p.title}</b>
                      <div className="card-meta">{p.meta}</div>
                      {bulletsOf(p.bullets, (i) => `projects.${p.id}.${i}`)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {(d.gaps?.length ?? 0) > 0 && (
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
        )}

        {(d.requirements?.length ?? 0) > 0 && (
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
        )}

        {master && doc && (
          <Section title="Left out" hint="Parts of your CV this draft does not use.">
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
          </Section>
        )}

        {flagCount > 0 && (
          <Section title="Flags" hint="Check these against your CV before you approve.">
            <div className="card">
              {d.fact_flags!.map((f, i) => (
                <p key={i} style={{ margin: '0 0 6px' }}>
                  {flagCopy(f.code)}{f.token ? <> <code>{f.token}</code></> : null}{' '}
                  <span className="card-meta">{f.ref}</span>
                </p>
              ))}
            </div>
          </Section>
        )}

        <div className="row" style={{ margin: '20px 0 4px' }}>
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
          {live && doc && (
            <a className="btn" href={`/resumes/${d.id}/print`} target="_blank" rel="noopener">
              Preview resume
            </a>
          )}
          {live && (
            <a className="btn" href={`/resumes/${d.id}/print?auto=1`} target="_blank" rel="noopener">
              Download PDF
            </a>
          )}
          {['draft', 'discarded', 'failed', 'skipped'].includes(d.status) && (
            <ActionButton action={requeueResume.bind(null, d.id)} confirm={d.edited_at ? 'This replaces your edits.' : undefined}>
              Draft again
            </ActionButton>
          )}
        </div>
        {d.status === 'draft' && <p className="sub">Approving only marks it ready for you. Nothing is sent.</p>}
      </main>
    </>
  )
}
