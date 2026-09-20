import { NextResponse, type NextRequest } from 'next/server'
import { requireOwner } from '../../../lib/supabase'

/**
 * Completes LinkedIn's authorisation and stores the token.
 *
 * The token is written through a security-definer function, so this app can
 * store one and can never read one back. The client secret stays server side
 * and is never sent to the browser.
 */
export async function GET(request: NextRequest) {
  const { supabase } = await requireOwner()
  const { origin, searchParams } = request.nextUrl
  const back = (status: string) => NextResponse.redirect(`${origin}/settings?linkedin=${status}`)

  const error = searchParams.get('error')
  if (error) return back(error === 'user_cancelled_login' ? 'cancelled' : 'denied')

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const expected = request.cookies.get('li_oauth_state')?.value
  if (!code || !state || !expected || state !== expected) return back('badstate')

  const clientId = process.env.LINKEDIN_CLIENT_ID
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET
  if (!clientId || !clientSecret) return back('unconfigured')

  // Authorisation code -> access token.
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${origin}/auth/linkedin/callback`,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const token = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok || !token?.access_token) return back('exchange_failed')

  // Who the token belongs to. The publisher posts as this urn.
  const infoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const info = await infoRes.json().catch(() => null)
  if (!infoRes.ok || !info?.sub) return back('userinfo_failed')

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 5184000) * 1000).toISOString()
  const { error: rpcError } = await supabase.rpc('store_linkedin_token', {
    p_access_token: token.access_token,
    p_person_urn: `urn:li:person:${info.sub}`,
    p_expires_at: expiresAt,
  })
  if (rpcError) return back('store_failed')

  const res = back('connected')
  res.cookies.delete('li_oauth_state')
  return res
}
