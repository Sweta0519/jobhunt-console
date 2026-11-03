import { notFound } from 'next/navigation'
import { requirePrimary, type ResumeDoc, type MasterDoc } from '../../../lib/resumes'
import { CoverLetter } from '../../CoverLetter'
import { PrintControls } from '../../PrintControls'
import { carlito } from '../../cvFont'

export const dynamic = 'force-dynamic'

/** The cover letter of the application draft that belongs to resume draft `id`. */
async function load(id: string) {
  const { supabase } = await requirePrimary()
  const { data: cv } = await supabase.from('resume_drafts').select('job_id').eq('id', id).maybeSingle()
  if (!cv) return null
  const [{ data: ad }, { data: job }] = await Promise.all([
    supabase.from('application_drafts').select('cover_text,master_version,status').eq('job_id', cv.job_id).maybeSingle(),
    supabase.from('jobs').select('company,title').eq('id', cv.job_id).maybeSingle(),
  ])
  if (!ad?.cover_text || !job || ad.status !== 'draft') return null
  const { data: master } = await supabase.from('master_cv').select('doc').eq('version', ad.master_version).maybeSingle()
  const doc = master?.doc as (MasterDoc & Pick<ResumeDoc, 'name' | 'contact'>) | undefined
  if (!doc) return null
  return { name: doc.name, contact: doc.contact, company: job.company as string, title: job.title as string, body: ad.cover_text as string }
}

// Browsers use the page title as the PDF file name.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await load((await params).id)
  return { title: c ? `${c.name.replace(/\s+/g, '_')}_Cover_Letter` : 'Cover letter' }
}

export default async function CoverPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await load((await params).id)
  if (!c) notFound()
  return (
    <div className={`cv-stage ${carlito.className}`}>
      <PrintControls />
      <CoverLetter {...c} />
    </div>
  )
}
