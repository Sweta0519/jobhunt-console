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

/**
 * LinkedIn deep link to a conversation with a person, so sending by hand is
 * one tap from the console. Falls back to their profile.
 */
export function linkedinChatUrl(profileUrl: string): string {
  const m = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (!m) return profileUrl
  return `https://www.linkedin.com/in/${m[1]}/`
}
