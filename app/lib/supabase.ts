import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const SCHEMA = 'jobhunt'

/** The schema-bound client type, so query helpers do not fall back to `public`. */
export type DB = Awaited<ReturnType<typeof getSupabase>>

/**
 * Cookie-bound client. Every read goes through row level security as the signed
 * in user, so a missing policy fails closed rather than leaking.
 *
 * Only the anon key is ever used here. The service role key must never reach
 * this process: it bypasses RLS across the whole Supabase project.
 */
export async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: SCHEMA },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component: middleware refreshes the session instead.
          }
        },
      },
    }
  )
}

/**
 * The second lock. Middleware redirects unauthenticated requests, but a
 * misconfigured matcher must never render data, so every console page runs
 * this too.
 */
export async function requireOwner() {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // `allowed_user` is unreachable through the API by design, so ask the
  // security-definer function instead. auth.users is shared with her other
  // apps in this project; a stray account must not see this data.
  const { data: isMe, error } = await supabase.rpc('is_me')
  if (error || !isMe) redirect('/login?denied=1')

  return { supabase, user }
}
