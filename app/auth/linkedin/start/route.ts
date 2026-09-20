import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireOwner } from '../../../lib/supabase'

/**
 * Starts LinkedIn's authorisation flow.
 *
 * Only the owner can begin it, and the `state` value is kept in an httpOnly
 * cookie so the callback can prove the redirect came from here rather than
 * from a link someone sent her.
 */
export async function GET(request: NextRequest) {
  await requireOwner()

  const clientId = process.env.LINKEDIN_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(`${request.nextUrl.origin}/settings?linkedin=unconfigured`)
  }

  const state = randomBytes(16).toString('hex')
  const redirectUri = `${request.nextUrl.origin}/auth/linkedin/callback`

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  // Exactly what the publisher needs: post as her, and read her member id.
  url.searchParams.set('scope', 'openid profile w_member_social')

  const res = NextResponse.redirect(url.toString())
  res.cookies.set('li_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
