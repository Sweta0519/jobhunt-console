import { wordDiff } from '../../workers/lib/resume/diff.mjs'

const clean = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

/**
 * Draft text against the master text it was built from. Words that are not in
 * the source are shaded; words a fact check flagged are shaded harder. All of it
 * is React text, so nothing in a draft can inject markup.
 */
export function Diffed({ text, from, flagged = [] }: { text: string; from: string; flagged?: string[] }) {
  const flags = new Set(flagged.map(clean).filter(Boolean))
  const words: { w: string; add: boolean }[] = []
  for (const seg of wordDiff(from, text) as { t: 'same' | 'add'; s: string }[]) {
    for (const w of seg.s.split(' ')) words.push({ w, add: seg.t === 'add' })
  }
  return (
    <>
      {words.map((x, i) => {
        const cls = flags.has(clean(x.w)) ? 'diff-flag' : x.add ? 'diff-add' : null
        return (
          <span key={i}>
            {i > 0 ? ' ' : ''}
            {cls ? <mark className={cls}>{x.w}</mark> : x.w}
          </span>
        )
      })}
    </>
  )
}
