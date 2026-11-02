import { notFound } from 'next/navigation'
import { Carlito } from 'next/font/google'
import { requirePrimary, type ResumeDoc } from '../../../lib/resumes'
import { Cv } from '../../Cv'
import { PrintControls } from '../../PrintControls'

// Metric-compatible with Calibri, served from /_next/static: the same letters on
// every device, and no request to Google at runtime.
const carlito = Carlito({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap' })

export const dynamic = 'force-dynamic'

async function load(id: string) {
  const { supabase } = await requirePrimary()
  const { data } = await supabase.from('resume_drafts').select('doc,status').eq('id', id).maybeSingle()
  if (!data?.doc || !['draft', 'approved'].includes(data.status)) return null
  return data.doc as ResumeDoc
}

// Browsers use the page title as the PDF file name.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const doc = await load((await params).id)
  return { title: doc ? `${doc.name.replace(/\s+/g, '_')}_CV` : 'Resume' }
}

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const doc = await load((await params).id)
  if (!doc) notFound()
  return (
    <div className={`cv-stage ${carlito.className}`}>
      <PrintControls />
      <Cv doc={doc} />
    </div>
  )
}
