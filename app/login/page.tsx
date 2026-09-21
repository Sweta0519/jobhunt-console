import { redirect } from 'next/navigation'
import { getSupabase } from '../lib/supabase'

export const metadata = { title: 'Sign in' }

const FIELD: React.CSSProperties = {
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
}

async function signIn(formData: FormData) {
  'use server'
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')
  if (!email || !password) redirect('/login?error=1')

  const supabase = await getSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  redirect(error ? '/login?bad=1' : '/')
}

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

  if (!error) redirect('/login?sent=1')

  // Two separate refusals used to render as one unhelpful "that did not work",
  // and the obvious response to it — press the button again — is the one thing
  // guaranteed to fail, because a second mail to the same address inside sixty
  // seconds is refused outright.
  const rateLimited =
    error.status === 429 ||
    /rate limit|after \d+ seconds|only request this/i.test(error.message)
  redirect(rateLimited ? '/login?wait=1' : '/login?error=1')
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string; error?: string; denied?: string; wait?: string; bad?: string
  }>
}) {
  const sp = await searchParams
  return (
    <main className="shell" style={{ maxWidth: 400, paddingTop: 80 }}>
      <h1>Jobhunt Console</h1>
      <p className="sub">Sign in with your email and password.</p>

      {sp.bad && <div className="notice">That email and password do not match.</div>}
      {sp.sent && (
        <div className="notice">
          Link sent. It can take a minute or two to arrive, and checking spam is
          worth it. Sending again inside sixty seconds will be refused, so give it
          that long before trying.
        </div>
      )}
      {sp.wait && (
        <div className="notice">
          A link was already sent to that address. Wait a minute before asking for
          another one, then check spam. Only two can be sent an hour.
        </div>
      )}
      {sp.error && (
        <div className="notice">
          That did not work. Check the address is the one this console belongs to.
        </div>
      )}
      {sp.denied && (
        <div className="notice">
          That account is signed in but is not the owner of this console.
        </div>
      )}

      <form action={signIn} className="card" style={{ marginTop: 16 }}>
        <label htmlFor="email" style={{ fontSize: 14, fontWeight: 600 }}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          style={FIELD}
        />
        <label htmlFor="password" style={{ fontSize: 14, fontWeight: 600 }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          style={FIELD}
        />
        <button type="submit" className="btn primary" style={{ width: '100%' }}>
          Sign in
        </button>
      </form>

      {/* Kept as the way back in if the password is lost, not as the usual door:
          the built-in mailer is best effort and allows two sends an hour. */}
      <form action={sendLink} style={{ marginTop: 18 }}>
        <label htmlFor="link-email" className="sub" style={{ fontSize: 13 }}>
          Forgotten it? Email a one-time sign-in link instead.
        </label>
        <input
          id="link-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          placeholder="you@example.com"
          style={FIELD}
        />
        <button type="submit" className="btn" style={{ width: '100%' }}>
          Email me a link
        </button>
      </form>
    </main>
  )
}
