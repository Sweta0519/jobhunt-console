import { resolveFixed } from '../../workers/lib/apply/bank.mjs'

/**
 * Application answers: types, copy, and the one function that decides what a
 * question shows. Nothing here prints a status word; the page hands the key to
 * StatusBadge.
 */

export type Option = { id: string; label: string }
export type Question = {
  id: string
  label: string
  help?: string
  kind: string
  required: boolean | null
  options: Option[]
  options_known: boolean
  group: string
  char_limit?: number
  role: string
}
export type Form = {
  schema: number
  source: string
  completeness: 'complete' | 'may_be_incomplete'
  partial_reasons: string[]
  questions: Question[]
}
export type AppForm = {
  id: string
  job_id: string
  source: string | null
  status: string
  reason: string | null
  apply_url: string | null
  form: Form | null
  form_sha: string | null
  completeness: string | null
  reread_requested_at: string | null
  read_at: string | null
}
export type Answer = {
  q: string
  cls: 'drafted' | 'needs_you' | 'blank' | 'fixed' | 'upload' | 'product'
  bank_key?: string
  text?: string
  option_ids?: string[]
  from?: string[]
  why?: string
  source?: string
  by_model?: boolean
}
export type Edit = { text?: string; option_ids?: string[] }
export type AppDraft = {
  id: string
  job_id: string
  resume_draft_id: string
  master_version: number
  form_sha: string | null
  status: string
  reason: string | null
  answers: Answer[] | null
  edits: Record<string, Edit> | null
  cover_text: string | null
  cover_reason: string | null
  cover_requested_at: string | null
  fact_flags: { code: string; ref: string; token: string }[] | null
  suspicious: boolean
  generation: number
  edited_at: string | null
  updated_at: string
}

/** Why a form could not be read, in words. Codes are set by the worker. */
export const FORM_REASON_COPY: Record<string, string> = {
  feed_listing: 'This job came from a listing page, and the real form was not found. Paste the questions from the application page.',
  no_reader: 'This employer uses a form that is not read automatically. Paste the questions from the application page.',
  excluded: 'This site is not read automatically. Paste the questions from the application page.',
  source_off: 'Reading this kind of form is switched off. Paste the questions from the application page.',
  not_found: 'The form could not be found, the role may be closed. Paste the questions if it is still open.',
  shape_changed: 'The form did not look the way the reader expects. Paste the questions from the application page.',
  robots_disallowed: 'The site asks not to be read automatically. Paste the questions from the application page.',
  robots_unreachable: 'The site rules could not be checked, so it was left alone. Paste the questions from the application page.',
  unreachable: 'The site could not be reached. Paste the questions or read it again later.',
  http_error: 'The site answered with an error. Paste the questions or read it again later.',
  too_big: 'The page was too large to read. Paste the questions from the application page.',
  paste_invalid: 'That paste could not be used. Put each question on its own line.',
}
export const formReasonCopy = (r: string | null) => (r && FORM_REASON_COPY[r]) || 'The form was not read. Paste the questions from the application page.'

export const PARTIAL_COPY: Record<string, string> = {
  pasted: 'Questions you pasted are included, and later pages may be missing.',
  too_many_questions: 'The form has more questions than are shown.',
  options_cut: 'A list of choices was too long and was cut.',
  unknown_field_type: 'A field of a kind the reader does not know was found.',
  unlabelled: 'A field without a label was skipped.',
  unspecified: 'Some of the form may not have been read.',
}
export const partialCopy = (c: string) => PARTIAL_COPY[c] || 'Some of the form may not have been read.'

/** Draft-level reasons (not a form read). */
export const DRAFT_REASON_COPY: Record<string, string> = {
  no_questions: 'No questions were read for this job, so no answers were drafted. Paste the questions, or draft a cover letter.',
  job_closed: 'The role closed before answers were drafted.',
  cv_not_ready: 'The resume draft is not ready yet, so no answers were drafted.',
  tool_drift: 'Drafting stopped for a safety check. See the run log.',
}
export const draftReasonCopy = (r: string | null) => (r && DRAFT_REASON_COPY[r]) || 'Drafting failed. It can be tried again.'

/** Why a question needs her, in words. Codes are set by the worker, never taken from a form. */
export const WHY_COPY: Record<string, string> = {
  suspicious: 'This question looks like it is aimed at an AI tool, so it was left for you.',
  ai_use: 'This asks how you wrote the application, so only you can answer it.',
  duration: 'How long you used something is not stated in your CV.',
  options_unknown: 'The choices could not be read from the form.',
  referral: 'Only you know how you heard about the role.',
  country_scope: 'Work rights are only filled in for Germany and the EU. Check this one yourself.',
  tool_unsupported: 'Your CV does not name this tool, so it was left for you.',
  facts_failed: 'The first answer used facts that are not in your CV, so it was thrown away.',
  schema_invalid: 'The answer came back malformed.',
  cover_failed: 'The cover letter could not be drafted. Use Draft again.',
  no_answer: 'No answer was drafted for this question.',
  model: 'Your CV does not support an answer.',
  sensitive: 'Left for you on purpose.',
  polarity: 'The wording makes yes or no unclear. Answer this one yourself.',
  product_blocked: 'This question is about you or has fixed choices, so it was left for you.',
}
export const whyCopy = (w?: string) => (w && WHY_COPY[w]) || 'Not drafted. Add your own answer.'

export const ANSWER_FLAG_COPY: Record<string, string> = {
  bad_option: 'A choice was picked that is not on the form.',
  number_not_in_source: 'A number is not in the part of your CV it came from.',
  number_word: 'A vague quantity is not in your CV.',
  date_not_in_master: 'A date is not in your CV.',
  contact_or_url: 'A link or contact detail is in the text.',
  markup: 'Unexpected markup in the text.',
  long_dash: 'The text holds a long dash.',
  personal_fact: 'The text mentions pay, notice or visa. Check it.',
  claim_from_posting: 'A claim about something only the posting names.',
  proper_noun: 'A name that is not in your CV.',
  posting_term: 'A word from the posting that your CV does not use.',
  over_char_limit: 'Longer than the form allows.',
  suspicious_posting: 'The posting contains text aimed at AI tools.',
  unverified_product: 'Written from general knowledge. Test it before you use it.',
  fixed_by_model: 'The question was matched to a saved answer by the drafting model. Check the match.',
}
export const answerFlagCopy = (code: string) => ANSWER_FLAG_COPY[code] || 'Check this item against your CV.'

/** The one fixed line on a product answer. */
export const PRODUCT_NOTE = 'Written from general knowledge, not your CV. Test it before you use it.'

export type Shown = {
  badge: 'ans_ready' | 'ans_check' | 'ans_edited' | 'ans_needs_you' | 'ans_blank' | 'ans_upload'
  text: string
  optionIds: string[]
  hint: string | null
  note: string | null
  editable: boolean
  copyText: string
}

const labelsOf = (q: Question, ids: string[]) => ids.map((id) => q.options.find((o) => o.id === id)?.label).filter(Boolean) as string[]

/**
 * What one question shows, from the worker's answer, her edit and her saved
 * answers. A saved answer is joined in here, in her own session; the worker never
 * had it.
 */
export function describe(q: Question, a: Answer | undefined, edit: Edit | undefined, bank: Record<string, string>): Shown {
  const out = (badge: Shown['badge'], text = '', optionIds: string[] = [], rest: Partial<Shown> = {}): Shown => ({
    badge, text, optionIds, hint: null, note: null, editable: false, copyText: text, ...rest,
  })
  const hasEdit = !!edit && (!!edit.text || !!edit.option_ids?.length)
  const edited = (note: string | null = null): Shown => {
    const ids = edit?.option_ids ?? []
    const text = ids.length ? labelsOf(q, ids).join(', ') : (edit?.text ?? '')
    return out('ans_edited', text, ids, { editable: true, note })
  }

  if (!a) return hasEdit ? edited() : out('ans_needs_you', '', [], { editable: true, note: whyCopy('no_answer') })
  if (a.cls === 'blank') return out('ans_blank')
  if (a.cls === 'upload') return out('ans_upload')
  if (hasEdit) return edited(a.cls === 'product' ? PRODUCT_NOTE : null)
  if (a.cls === 'product') return out('ans_check', a.text ?? '', [], { editable: true, note: PRODUCT_NOTE })
  if (a.cls === 'needs_you') return out('ans_needs_you', '', [], { editable: true, note: whyCopy(a.why) })
  if (a.cls === 'drafted') {
    const ids = a.option_ids ?? []
    const text = ids.length ? labelsOf(q, ids).join(', ') : (a.text ?? '')
    return out('ans_ready', text, ids, { editable: true })
  }
  // fixed: the saved value, joined here
  const r = resolveFixed({ bank_key: a.bank_key }, q, bank, undefined) as { state: string; text?: string; option_ids?: string[]; hint?: string }
  if (r.state === 'ready') {
    return out('ans_ready', r.text ?? '', r.option_ids ?? [], { editable: true, note: a.by_model ? 'Matched to your saved answer for this question.' : null })
  }
  const empty = !bank[a.bank_key ?? '']
  return out('ans_needs_you', '', [], {
    editable: true,
    hint: r.hint ?? null,
    note: empty ? 'You have not saved this answer yet.' : 'Your saved answer does not match one of the choices.',
  })
}

export function bankMap(rows: { key: string; value: string }[] | null): Record<string, string> {
  return Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]))
}
