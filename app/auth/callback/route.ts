import { NextResponse, type NextRequest } from 'next/server'
import { getSupabase } from '../../lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  // No code means an implicit-flow link: the tokens are in the fragment,
  // which never reaches the server. The client page reads them.
  if (!code) return NextResponse.redirect(`${origin}/auth/finish`)

  const supabase = await getSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  return NextResponse.redirect(error ? `${origin}/login?error=1` : `${origin}/`)
}
