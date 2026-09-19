import { redirect } from 'next/navigation'
import { getSupabase } from '../lib/supabase'

export const metadata = { title: 'Sign in' }

async function sendLink(formData: FormData) {
  'use server'
  const email = String(formData.get('email') || '').trim()
  if (!email) redirect('/login?error=1')

  const supabase = await getSupabase()
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // Sign-ups are disabled in the project; this is belt and braces so a typo
      // cannot create an account in the auth.users shared with her other apps.
      shouldCreateUser: false,
    },
  })
  redirect(error ? '/login?error=1' : '/login?sent=1')
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; denied?: string }>
}) {
  const sp = await searchParams
  return (
    <main className="shell" style={{ maxWidth: 400, paddingTop: 80 }}>
      <h1>Jobhunt Console</h1>
      <p className="sub">Sign in with a link sent to your email.</p>

      {sp.sent && <div className="notice">Check your email for the sign-in link.</div>}
      {sp.error && <div className="notice">That did not work. Try again.</div>}
      {sp.denied && (
        <div className="notice">
          That account is signed in but is not the owner of this console.
        </div>
      )}

      <form action={sendLink} className="card" style={{ marginTop: 16 }}>
        <label htmlFor="email" style={{ fontSize: 14, fontWeight: 600 }}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-strong)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 16,
            fontFamily: 'inherit',
          }}
        />
        <button type="submit" className="btn primary" style={{ width: '100%' }}>
          Send sign-in link
        </button>
      </form>
    </main>
  )
}
