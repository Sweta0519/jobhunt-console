'use client'

import { useEffect, useState } from 'react'
import { browserSupabase } from '../../lib/supabase-browser'

/**
 * Completes a sign-in whose tokens arrive in the URL fragment.
 *
 * The normal email link uses PKCE and comes back as `?code=`, which
 * /auth/callback handles on the server. Some links (an admin-generated one, or
 * an older implicit-flow client) instead return `#access_token=…`. A fragment
 * is never sent to the server, so it has to be read here.
 */
export default function Finish() {
  const [message, setMessage] = useState('Signing you in…')

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const access_token = hash.get('access_token')
    const refresh_token = hash.get('refresh_token')

    if (!access_token || !refresh_token) {
      window.location.replace('/login?error=1')
      return
    }

    browserSupabase()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        // Drop the tokens from the address bar either way.
        window.location.replace(error ? '/login?error=1' : '/')
      })
      .catch(() => window.location.replace('/login?error=1'))
  }, [])

  return (
    <main className="shell" style={{ maxWidth: 400, paddingTop: 80 }}>
      <p className="sub">{message}</p>
      <noscript>This page needs JavaScript to finish signing you in.</noscript>
    </main>
  )
}
