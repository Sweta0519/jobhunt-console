import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireOwner } from '../lib/supabase'
import { tokenDaysLeft } from '../lib/queries'
import { NavBar, Section, Empty, relative, formatDay } from '../components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

type Run = {
  worker: string
  started_at: string
  finished_at: string | null
  ok: boolean | null
  summary: Record<string, unknown> | null
  error: string | null
}

const MESSAGES: Record<string, string> = {
  connected: 'LinkedIn reconnected.',
  cancelled: 'You cancelled the LinkedIn sign-in. Nothing changed.',
  denied: 'LinkedIn refused the request. Nothing changed.',
  badstate: 'That link did not come from here, so it was ignored. Start again from this page.',
  unconfigured: 'The LinkedIn app credentials are not set on the server yet.',
  exchange_failed: 'LinkedIn would not exchange the code. Try again.',
  userinfo_failed: 'Could not read your LinkedIn profile with the new token.',
  store_failed: 'The token could not be stored.',
}

/**
 * Change the password on the signed-in account. This runs as her own session
 * rather than through the admin API, so the service role key stays off Vercel.
 */
async function changePassword(formData: FormData) {
  'use server'
  const password = String(formData.get('password') || '')
  if (password.length < 12) redirect('/settings?password=short')

  const { supabase } = await requireOwner()
  const { error } = await supabase.auth.updateUser({ password })
  redirect(error ? '/settings?password=failed' : '/settings?password=changed')
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ linkedin?: string; password?: string }>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireOwner()

  const [runs, token, counts] = await Promise.all([
    supabase.from('runs').select('*').order('started_at', { ascending: false }).limit(12),
    supabase.from('settings').select('value').eq('key', 'linkedin_token_status').maybeSingle(),
    Promise.all(
      (['jobs', 'questions', 'outreach', 'posts', 'people', 'contributions'] as const).map(
        async (t) => {
          const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
          return [t, count ?? 0] as const
        }
      )
    ),
  ])

  const days = tokenDaysLeft((token.data?.value as { expires_at?: string }) ?? null)
  const rows = (runs.data as Run[]) || []
  const lastOk = rows.find((r) => r.ok === true)

  return (
    <>
      <NavBar current="/settings" waiting={0} />
      <main className="shell">
        <h1>Settings</h1>
        <p className="sub">Signed in as {user.email}</p>

        <Section title="LinkedIn access">
          {sp.linkedin && (
            <div className={sp.linkedin === 'connected' ? 'card' : 'notice'}>
              <p style={{ margin: 0 }}>{MESSAGES[sp.linkedin] || 'Something went wrong.'}</p>
            </div>
          )}
          <div className={days !== null && days <= 7 ? 'notice' : 'card'}>
            <p style={{ marginTop: 0 }}>
              {days === null
                ? 'No token is recorded, so posts cannot publish.'
                : days <= 0
                  ? 'LinkedIn access has expired. Posts are not publishing.'
                  : `LinkedIn access expires in ${days} day${days === 1 ? '' : 's'}.`}
            </p>
            <p className="sub">
              The token lasts sixty days and cannot renew itself, so this needs doing roughly every
              two months. It takes one tap and works from a phone.
            </p>
            <a className="btn primary" href="/auth/linkedin/start">
              {days === null ? 'Connect LinkedIn' : 'Reconnect LinkedIn'}
            </a>
          </div>
        </Section>

        <Section title="Scheduled jobs" hint="These run in GitHub Actions, with your laptop closed.">
          {rows.length === 0 ? (
            <Empty>Nothing has run yet.</Empty>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((r, i) => (
                <div
                  key={r.started_at + r.worker}
                  style={{
                    padding: '12px 18px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 500, minWidth: 80 }}>{r.worker}</span>
                  <span
                    className="badge"
                    style={{
                      background: r.ok === false ? 'var(--fail-soft)' : 'var(--done-soft)',
                      color: r.ok === false ? 'var(--fail)' : 'var(--done)',
                    }}
                  >
                    <span aria-hidden="true">{r.ok === false ? '▲' : '✓'}</span>
                    {r.ok === false ? 'failed' : 'ok'}
                  </span>
                  <span className="card-meta">{relative(r.started_at)}</span>
                  {r.summary && (
                    <span className="card-meta mono">
                      {Object.entries(r.summary)
                        .filter(([, v]) => typeof v === 'number')
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ')}
                    </span>
                  )}
                  {r.error && <span className="card-meta mono">{r.error.slice(0, 90)}</span>}
                </div>
              ))}
            </div>
          )}
          {lastOk && (
            <p className="sub">
              Last successful run {relative(lastOk.started_at)}, on {formatDay(lastOk.started_at)}.
            </p>
          )}
        </Section>

        <Section title="What is stored">
          <div className="card">
            <ul style={{ margin: 0, paddingLeft: 18 }} className="num">
              {counts.map(([table, n]) => (
                <li key={table}>
                  {n} {table}
                </li>
              ))}
            </ul>
          </div>
          <p className="sub">
            Company logos are public brand assets. Profile photos sit in a private bucket, only for
            people with a live conversation, and are deleted when it closes.
          </p>
        </Section>

        <Section title="What runs where">
          <div className="card">
            <p style={{ marginTop: 0 }}>
              <strong>In the cloud, daily:</strong> the community question list, and the checks
              behind the notification bell. Neither needs your laptop, and neither uses a paid
              model.
            </p>
            <p>
              <strong>On your PC:</strong> publishing today&apos;s post, profile photos, and
              checking LinkedIn for replies. LinkedIn&apos;s API exposes neither message threads
              nor comments on your own posts, so those cannot move to a server.
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>In Claude Code:</strong> drafting answers, posts and messages. That is
              covered by your existing subscription, which is why this console costs nothing to
              run.
            </p>
          </div>
        </Section>

        <Section title="Password" hint="Signing in with a password avoids the built-in mailer, which allows only two sends an hour and does not guarantee delivery.">
          {sp.password === 'changed' && <div className="notice">Password changed.</div>}
          {sp.password === 'short' && (
            <div className="notice">Use at least twelve characters.</div>
          )}
          {sp.password === 'failed' && (
            <div className="notice">That could not be saved. Try again.</div>
          )}
          <form action={changePassword} className="card">
            <label htmlFor="new-password" style={{ fontSize: 14, fontWeight: 600 }}>
              New password
            </label>
            <input
              id="new-password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
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
            <button className="btn" type="submit">
              Change password
            </button>
          </form>
        </Section>

        <Section title="Sign out">
          <form action="/auth/signout" method="post">
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        </Section>

        <p className="sub" style={{ marginTop: 28 }}>
          <Link href="/">← Today</Link>
        </p>
      </main>
    </>
  )
}
