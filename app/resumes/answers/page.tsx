import Link from 'next/link'
import { requirePrimary, type MasterDoc } from '../../lib/resumes'
import { NavBar } from '../../components/ui'
import { BankForm } from './BankForm'
import { BANK, BANK_SECTIONS } from '../../../workers/lib/apply/bank.mjs'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved answers' }

/** Suggestions for the "Fill from my CV" button. Computed here, filled in by the page, never saved. */
function suggestions(doc: MasterDoc | null): Record<string, string> {
  if (!doc) return {}
  const out: Record<string, string> = {}
  const name = String(doc.name || '').trim()
  if (name) {
    out.full_name = name
    const parts = name.split(/\s+/)
    if (parts.length > 1) {
      out.first_name = parts[0]
      out.last_name = parts.slice(1).join(' ')
    }
  }
  for (const c of doc.contact || []) {
    const href = String(c.href || '')
    if (/^mailto:/i.test(href)) out.email = href.replace(/^mailto:/i, '')
    else if (/^[+()\d][\d\s().+-]{6,}$/.test(String(c.label || '').trim())) out.phone = String(c.label).trim()
  }
  for (const l of [...(doc.links || []), ...(doc.contact || []).map((c) => ({ label: c.label, href: c.href || '' }))]) {
    const href = String(l.href || '')
    if (!/^https:\/\//i.test(href)) continue
    if (/linkedin\.com/i.test(href)) out.linkedin_url ||= href
    else if (/github\.com/i.test(href)) out.github_url ||= href
  }
  return out
}

export default async function SavedAnswers() {
  const { supabase } = await requirePrimary()
  const [{ data: rows }, { data: latest }] = await Promise.all([
    supabase.from('answer_bank').select('key,value'),
    supabase.from('master_cv').select('doc').order('version', { ascending: false }).limit(1).maybeSingle(),
  ])
  const have = new Map(((rows as { key: string; value: string }[]) || []).map((r) => [r.key, r.value]))
  const fields = BANK.map((b) => ({ ...b, type: b.type as 'text' | 'url' | 'yesno', value: have.get(b.key) ?? '' }))

  return (
    <>
      <NavBar current="/resumes" waiting={0} />
      <main className="shell">
        <Link href="/resumes" className="resume-back">← Resumes</Link>
        <h1 style={{ marginTop: 8 }}>Saved answers</h1>
        <p className="sub">
          Facts that stay the same from one application to the next. They are stored as plain text and only you can read them:
          the drafting worker has no access to this table and is never sent these values. A field you leave empty is never filled in for you.
        </p>
        <p className="sub">Pay is one free text value. A range with a currency is fine, and you can change it for a single job on its Application tab.</p>
        <BankForm fields={fields} sections={BANK_SECTIONS} suggest={suggestions((latest?.doc as MasterDoc | undefined) ?? null)} />
      </main>
    </>
  )
}
