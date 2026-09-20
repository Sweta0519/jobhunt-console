import { NextResponse, type NextRequest } from 'next/server'
import { getSupabase } from '../../lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = await getSupabase()
  await supabase.auth.signOut()
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 })
}
