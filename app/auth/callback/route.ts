import { NextResponse, type NextRequest } from 'next/server'
import { getSupabase } from '../../lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  if (!code) return NextResponse.redirect(`${origin}/login?error=1`)

  const supabase = await getSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  return NextResponse.redirect(error ? `${origin}/login?error=1` : `${origin}/`)
}
