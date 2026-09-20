'use client'

import { createBrowserClient } from '@supabase/ssr'

/** Browser client. Writes the same cookies the server reads. */
export function browserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'jobhunt' } }
  )
}
