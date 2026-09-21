import type { Question, Outreach, Post, Job } from './queries'
import { captionText } from './queries'

/**
 * Prompts to paste into Claude Code.
 *
 * Drafting stays there on purpose: it is covered by the subscription she
 * already pays for, and it can read the current docs before answering, which
 * is what makes the answers worth posting. The console's job is to hand over
 * everything needed so the paste is self-sufficient.
 */

const PREAMBLE =
  'Context pasted from my jobhunt console (a read-only mirror; it cannot run anything).'

const SKILL_DIR = 'C:\\Users\\abhij\\.claude\\skills'

export function questionPrompt(q: Question): string {
  return [
    PREAMBLE,
    '',
    'Use the visibility skill. Help me answer this community question.',
    '',
    `id:       ${q.id}`,
    `title:    ${q.title}`,
    `url:      ${q.url}`,
    `site:     ${q.site ?? '-'}`,
    `company:  ${q.company ?? '-'}`,
    `rank:     ${q.rank ?? '-'}  (${q.why ?? ''})`,
    `replies:  ${q.comments}`,
    '',
    q.excerpt ? `excerpt:\n${q.excerpt}` : '',
    '',
    'Follow templates/answer-guide.md: one line on the likely cause, the check',
    'that proves it, the fix or the two branches, one real docs link, and ask',
    'for the single missing detail if the question is under-specified.',
    '',
    'Verify every claim against the current docs before drafting. Never mention',
    'my job search. Save the draft, show it to me, and post it only if I say so.',
    '',
    'After it is posted, record it with:',
    `node "${SKILL_DIR}\\visibility\\scripts\\questions.mjs" --answered ${q.id} --url <link to my reply>`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export function outreachPrompt(o: Outreach): string {
  const limit = o.channel === 'connect_note' ? 200 : 1900
  return [
    PREAMBLE,
    '',
    'Use the linkedin-jobnet skill. Help me redraft this outreach message.',
    '',
    `id:       ${o.id}`,
    `to:       ${o.person_name}`,
    `profile:  ${o.person_url ?? '-'}`,
    `company:  ${o.company ?? '-'}`,
    `channel:  ${o.channel} (hard limit ${limit} characters)`,
    `kind:     ${o.kind}`,
    `why them: ${o.reason ?? '-'}`,
    '',
    'current draft:',
    o.body ?? '(none)',
    '',
    'Follow templates/messages.md. Keep it specific to this person and role,',
    'no flattery, no generic opener, and ask for one concrete thing.',
    '',
    'I send LinkedIn messages by hand, so just give me the final text.',
  ].join('\n')
}

export function postPrompt(p: Post): string {
  return [
    PREAMBLE,
    '',
    'Use the linkedin-content skill. Help me with this post.',
    '',
    `id:      ${p.id}`,
    `date:    ${p.post_date ?? '-'}`,
    `format:  ${p.format ?? '-'}`,
    `pillar:  ${p.pillar ?? '-'}`,
    `title:   ${p.title ?? '-'}`,
    '',
    'current caption:',
    captionText(p.caption) || '(none)',
    '',
    'Follow templates/caption-guide.md and the poster style we settled on:',
    'soft gradient, one word in a pill in the title, white cards with pastel',
    'borders, exactly five trending hashtags.',
  ].join('\n')
}

export function jobPrompt(j: Job): string {
  return [
    PREAMBLE,
    '',
    'Use the linkedin-jobnet skill. Help me decide on and apply for this role.',
    '',
    `company:  ${j.company}`,
    `title:    ${j.title}`,
    `url:      ${j.url ?? '-'}`,
    `location: ${j.location ?? '-'}`,
    `score:    ${j.score ?? '-'}`,
    j.score_notes ? `notes:    ${Object.values(j.score_notes).join(' | ')}` : '',
    j.german_required ? 'NOTE: this posting requires German.' : '',
    '',
    'First verify the location really is Germany remote or EU-wide remote, since',
    "a job board's own tag is often wrong. Then tell me whether it is worth",
    'applying, and who at the company I should approach.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export type Drill = {
  id: string; company_slug: string; seq: number; level: number
  title: string; why: string; how: string; status: string
  evidence_url: string | null; note: string | null; done_at: string | null
}

const LEVEL_LABEL: Record<number, string> = {
  1: 'know it: run the thing and see the moving parts',
  2: 'ticket: reproduce the failure, diagnose it with the tool, write the customer reply',
  3: 'public: produce an artifact with a link, or a story with evidence',
}

export function prepPrompt(d: Drill, company: string): string {
  return [
    PREAMBLE,
    '',
    `Walk me through this hands-on drill for my ${company} application. I am preparing`,
    'for a support engineer interview loop, so the goal is being able to diagnose one',
    'realistic ticket live and write the customer-facing reply, not internals.',
    '',
    `drill:    ${d.id}  (level ${d.level}, ${LEVEL_LABEL[d.level] ?? ''})`,
    `title:    ${d.title}`,
    `why:      ${d.why}`,
    '',
    'steps:',
    d.how,
    '',
    d.note ? `my notes so far:\n${d.note}\n` : '',
    'Verify commands and settings against the current docs before giving them to me,',
    'and tell me which docs page each came from. Everything runs locally or on a free',
    'tier; stop and say so if a step would cost money.',
    '',
    d.level === 2
      ? 'End with the customer reply in the answer-guide shape: cause in one line, the check that proves it, the fix, one docs link.'
      : d.level === 3
        ? 'End with what I should publish and where, so I can record the link as evidence.'
        : 'End with the two or three things I should be able to explain afterwards, and what to keep as evidence.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/**
 * LinkedIn deep link to a conversation with a person, so sending by hand is
 * one tap from the console. Falls back to their profile.
 */
export function linkedinChatUrl(profileUrl: string): string {
  const m = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (!m) return profileUrl
  return `https://www.linkedin.com/in/${m[1]}/`
}
