import Link from 'next/link'
import type { DB } from '../../lib/supabase'
import { safeHref } from '../../lib/resumes'
import {
  describe, bankMap, formReasonCopy, partialCopy, draftReasonCopy, answerFlagCopy, whyCopy,
  type AppForm, type AppDraft, type Edit, type Shown,
} from '../../lib/applications'
import { StatusBadge, ExternalLink, Section } from '../../components/ui'
import { ActionButton, CopyButton } from '../../components/ActionButton'
import { Editable } from '../Editable'
import { AnswerCard } from '../AnswerCard'
import { PasteBox } from '../PasteBox'
import { requestCoverLetter, redraftAnswers, requestFormReread, editCoverLetter } from '../../actions'

/**
 * The Application tab of a resume draft. Server rendered: the form, the answers
 * and her saved answers are joined here, in her own session. Nothing on this page
 * submits anything; she reads, copies and submits on the employer's site.
 */
export async function ApplicationTab({
  supabase, resumeId, job, latestVersion,
}: {
  supabase: DB
  resumeId: string
  job: { id: string; url: string | null }
  latestVersion: number | null
}) {
  const [{ data: f }, { data: dr }, { data: bankRows }] = await Promise.all([
    supabase
      .from('application_forms')
      .select('id,job_id,source,status,reason,apply_url,form,form_sha,completeness,reread_requested_at,read_at')
      .eq('job_id', job.id)
      .maybeSingle(),
    supabase
      .from('application_drafts')
      .select('id,job_id,resume_draft_id,master_version,form_sha,status,reason,answers,edits,cover_text,cover_reason,cover_requested_at,fact_flags,suspicious,generation,edited_at,updated_at')
      .eq('job_id', job.id)
      .maybeSingle(),
    supabase.from('answer_bank').select('key,value'),
  ])
  const form = f as AppForm | null
  const draft = dr as AppDraft | null
  const bank = bankMap(bankRows as { key: string; value: string }[] | null)
  const questions = form?.form?.questions ?? []
  const hasEdits = !!draft?.edited_at

  if (!form && !draft) {
    return <p className="sub">Answers are prepared once the resume draft is ready. Nothing is here yet.</p>
  }

  const answers = new Map((draft?.answers ?? []).map((a) => [a.q, a]))
  const edits = (draft?.edits ?? {}) as Record<string, Edit>
  const flagsOf = (qId: string) => (draft?.fact_flags ?? []).filter((x) => x.ref === `a.${qId}` && x.code !== 'unverified_product').map((x) => answerFlagCopy(x.code))
  const shown = new Map<string, Shown>(questions.map((q) => [q.id, describe(q, answers.get(q.id), edits[q.id], bank)]))
  const count = (...b: Shown['badge'][]) => [...shown.values()].filter((s) => b.includes(s.badge)).length

  const olderCv = !!draft && latestVersion != null && draft.master_version < latestVersion
  const formChanged = !!draft?.form_sha && !!form?.form_sha && draft.form_sha !== form.form_sha
  const openUrl = safeHref(form?.apply_url) || safeHref(job.url)
  const answered = !!draft?.answers
  const working = draft?.status === 'queued' || draft?.status === 'drafting'
  const formRead = form?.status === 'read' && !!form.form
  const bankEmpty = Object.keys(bank).length === 0
  const canReread = !!form && ['read', 'needs_paste', 'failed', 'skipped'].includes(form.status)

  return (
    <div>
      {answered && formRead && (
        <nav className="summary-strip" aria-label="Answer summary">
          <span className="pill"><span className="num">{count('ans_ready', 'ans_edited')}</span><StatusBadge status="ans_ready" /></span>
          {count('ans_check') > 0 && <span className="pill"><span className="num">{count('ans_check')}</span><StatusBadge status="ans_check" /></span>}
          <span className="pill"><span className="num">{count('ans_needs_you')}</span><StatusBadge status="ans_needs_you" /></span>
          <span className="pill"><span className="num">{count('ans_blank', 'ans_upload')}</span><StatusBadge status="ans_blank" /></span>
        </nav>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        {draft && working && <StatusBadge status={draft.status} />}
        {draft && draft.status === 'failed' && <StatusBadge status="failed" />}
        {form && formRead && form.completeness === 'may_be_incomplete' && <StatusBadge status="form_partial" />}
        {openUrl && <ExternalLink href={openUrl}>Open form</ExternalLink>}
        {canReread && (
          <ActionButton action={requestFormReread.bind(null, form!.id)}>Read the form again</ActionButton>
        )}
      </div>

      {draft?.suspicious && <div className="notice">This posting contains text aimed at AI tools. Read it with that in mind.</div>}
      {formRead && form!.completeness === 'may_be_incomplete' && (
        <div className="notice">
          The reader may not have seen the whole form. Compare it with the real page before you rely on it.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {(form!.form!.partial_reasons ?? []).map((c) => <li key={c}>{partialCopy(c)}</li>)}
          </ul>
        </div>
      )}
      {formChanged && (
        <div className="notice">
          The form changed after these answers were drafted.{' '}
          <ActionButton action={redraftAnswers.bind(null, draft!.id)} confirm={hasEdits ? 'This replaces your edits.' : undefined}>
            Draft again
          </ActionButton>
        </div>
      )}
      {olderCv && (
        <div className="notice">
          Drafted from an older version of your CV.{' '}
          <ActionButton action={redraftAnswers.bind(null, draft!.id)} confirm={hasEdits ? 'This replaces your edits.' : undefined}>
            Draft again
          </ActionButton>
        </div>
      )}
      {bankEmpty && (
        <div className="notice">
          You have not saved any answers for questions like notice period or salary. <Link href="/resumes/answers">Fill in your saved answers</Link>
        </div>
      )}

      {!formRead && form && (
        <div className="card">
          <p style={{ margin: 0 }}>
            {form.status === 'queued' ? 'The form is waiting to be read.' : formReasonCopy(form.reason)}
          </p>
        </div>
      )}
      {draft && !answered && draft.status === 'skipped' && <p className="sub">{draftReasonCopy(draft.reason)}</p>}
      {draft && draft.status === 'failed' && <p className="sub">{draftReasonCopy(draft.reason)}</p>}
      {draft && working && <p className="sub">Answers are being prepared. This can take a few minutes after the next run starts.</p>}

      {form && !formRead && form.status !== 'queued' && (
        <PasteBox
          formId={form.id}
          mode="replace"
          title="Paste the questions"
          hint="Copy the questions from the application page and paste them here, one per line. Choices go on the lines below a question, each starting with a dash."
        />
      )}

      {formRead && (
        <Section title="Questions" hint="Check each answer, edit what is wrong, then copy it into the application. Nothing is sent from here.">
          {questions.map((q) => {
            const s = shown.get(q.id)!
            return answered ? (
              <AnswerCard
                key={q.id}
                draftId={draft!.id}
                qId={q.id}
                label={q.label}
                required={q.required}
                help={q.help}
                badge={<StatusBadge status={s.badge} />}
                text={s.text}
                kind={q.kind}
                options={q.options}
                optionIds={s.optionIds}
                editable={s.editable && draft!.status === 'draft'}
                edited={s.badge === 'ans_edited'}
                limit={q.char_limit}
                note={s.note}
                hint={s.hint}
                flags={flagsOf(q.id)}
                copyText={s.copyText}
              />
            ) : (
              <div key={q.id} className="card">
                <b className="answer-wrap">{q.label}</b>
                {q.required === true && <span className="chip" style={{ marginLeft: 8 }}>required</span>}
              </div>
            )
          })}
        </Section>
      )}

      {formRead && form!.completeness === 'may_be_incomplete' && (
        <PasteBox
          formId={form!.id}
          mode="add"
          title="Add questions from the next page"
          hint="If the form has more pages, paste their questions here. They are added to the ones above."
        />
      )}

      {draft && (
        <Section title="Cover letter" hint="Body only. The greeting, your name and your contact row are added on the PDF.">
          {draft.cover_text ? (
            <div className="card">
              {draft.status === 'draft' ? (
                <Editable initial={draft.cover_text} limit={6000} label="cover letter" onSave={editCoverLetter.bind(null, draft.id)}>
                  <div className="answer-text">{draft.cover_text}</div>
                </Editable>
              ) : (
                <div className="answer-text">{draft.cover_text}</div>
              )}
              {(draft.fact_flags ?? []).filter((x) => String(x.ref).startsWith('cover.')).map((x, i) => (
                <p key={i} className="card-meta" style={{ margin: '6px 0 0' }}>{answerFlagCopy(x.code)}</p>
              ))}
              <div className="row" style={{ marginTop: 8 }}>
                <CopyButton text={draft.cover_text} />
                <a className="btn" href={`/resumes/${resumeId}/cover?auto=1`} target="_blank" rel="noopener">Download PDF</a>
                {draft.status === 'draft' && <ActionButton action={requestCoverLetter.bind(null, draft.id)}>Draft again</ActionButton>}
              </div>
            </div>
          ) : (
            <div className="card">
              {draft.cover_reason && <p className="sub" style={{ marginTop: 0 }}>{whyCopy(draft.cover_reason === 'facts_failed' ? 'facts_failed' : 'cover_failed')}</p>}
              {['draft', 'skipped', 'failed'].includes(draft.status) ? (
                <ActionButton action={requestCoverLetter.bind(null, draft.id)}>Draft a cover letter</ActionButton>
              ) : (
                <p className="sub" style={{ margin: 0 }}>Waiting for the next run.</p>
              )}
            </div>
          )}
        </Section>
      )}

      {draft && draft.status === 'draft' && answered && formRead && (
        <div className="row" style={{ marginTop: 12 }}>
          <ActionButton action={redraftAnswers.bind(null, draft.id)} confirm={hasEdits ? 'This replaces your edits.' : undefined}>
            Draft all answers again
          </ActionButton>
        </div>
      )}
    </div>
  )
}
