import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireOwner } from '../lib/supabase'
import { tokenDaysLeft } from '../lib/queries'
import { NavBar, PageHeader, Section, Empty, StatusBadge, List, ListRow, KeyValues, Field, relative, formatDay } from '../components/ui'

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

  // LinkedIn publishing, questions and posts are the primary owner's alone.
  const { data: primary } = await supabase.rpc('is_primary')
  const tables = primary
    ? (['jobs', 'questions', 'outreach', 'posts', 'people', 'contributions'] as const)
    : (['jobs', 'outreach', 'people'] as const)

  const [runs, token, counts] = await Promise.all([
    supabase.from('runs').select('*').order('started_at', { ascending: false }).limit(12),
    supabase.from('settings').select('value').eq('key', 'linkedin_token_status').maybeSingle(),
    Promise.all(
      tables.map(
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
        <PageHeader title="Settings">
          <p>Signed in as {user.email}</p>
        </PageHeader>

        {primary && <Section title="LinkedIn access">
          {sp.linkedin && (
            <div className={sp.linkedin === 'connected' ? 'notice ok' : 'notice fail'}>
              <p>{MESSAGES[sp.linkedin] || 'Something went wrong.'}</p>
            </div>
          )}
          <div className={days !== null && days <= 7 ? 'notice' : 'card'}>
            <p>
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
        </Section>}

        <Section title="Scheduled jobs" hint="These run in GitHub Actions, with your laptop closed.">
          {rows.length === 0 ? (
            <Empty>Nothing has run yet.</Empty>
          ) : (
            <List>
              {rows.map((r) => (
                <ListRow
                  key={r.started_at + r.worker}
                  title={r.worker}
                  trail={<StatusBadge status={r.ok === false ? 'failed' : 'run_ok'} />}
                  meta={
                    <>
                      {relative(r.started_at)}
                      {r.summary && (
                        <span className="mono">
                          {' · '}
                          {Object.entries(r.summary)
                            .filter(([, v]) => typeof v === 'number')
                            .map(([k, v]) => `${k} ${v}`)
                            .join(' · ')}
                        </span>
                      )}
                      {r.error && <span className="mono">{' · '}{r.error.slice(0, 90)}</span>}
                    </>
                  }
                />
              ))}
            </List>
          )}
          {lastOk && (
            <p className="sub">
              Last successful run {relative(lastOk.started_at)}, on {formatDay(lastOk.started_at)}.
            </p>
          )}
        </Section>

        <Section title="What is stored">
          <div className="card">
            <KeyValues items={counts.map(([table, n]) => ({ k: table, v: n }))} />
          </div>
          <p className="sub">
            Company logos are public brand assets. Profile photos sit in a private bucket, only for
            people with a live conversation, and are deleted when it closes.
          </p>
        </Section>

        <Section title="What runs where">
          <div className="card prose">
            <p>
              <strong>In the cloud, daily:</strong> the community question list, and the checks
              behind the notification bell. Neither needs your laptop, and neither uses a paid
              model.
            </p>
            <p>
              <strong>On your PC:</strong> publishing today&apos;s post, profile photos, and
              checking LinkedIn for replies. LinkedIn&apos;s API exposes neither message threads
              nor comments on your own posts, so those cannot move to a server.
            </p>
            <p>
              <strong>In Claude Code:</strong> drafting answers, posts and messages. That is
              covered by your existing subscription, which is why this console costs nothing to
              run.
            </p>
          </div>
        </Section>

        <Section title="Password" hint="Signing in with a password avoids the built-in mailer, which allows only two sends an hour and does not guarantee delivery.">
          {sp.password === 'changed' && <div className="notice ok">Password changed.</div>}
          {sp.password === 'short' && (
            <div className="notice fail">Use at least twelve characters.</div>
          )}
          {sp.password === 'failed' && (
            <div className="notice fail">That could not be saved. Try again.</div>
          )}
          <form action={changePassword} className="card form-stack">
            <Field label="New password" htmlFor="new-password">
              <input
                className="input"
                id="new-password"
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </Field>
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

        <Link className="back-link" href="/">
          ← Today
        </Link>
      </main>
    </>
  )
}
