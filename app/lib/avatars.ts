import type { DB } from './supabase'

/**
 * Signed URLs for the private avatar bucket.
 *
 * Company logos live in a public bucket because they are brand assets. A
 * person's photograph is not, so these are minted server-side from her session
 * and expire within the hour.
 */
export async function signAvatars(
  supabase: DB,
  paths: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean) as string[])]
  const out = new Map<string, string>()
  if (!wanted.length) return out

  const { data, error } = await supabase.storage.from('avatars').createSignedUrls(wanted, 3600)
  if (error || !data) return out

  for (const row of data) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl)
  }
  return out
}

/** person id -> signed photo URL, for the people she is in conversation with. */
export async function peopleAvatars(supabase: DB): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('people')
    .select('id,avatar_path')
    .not('avatar_path', 'is', null)
  const rows = (data as { id: string; avatar_path: string }[]) || []
  const signed = await signAvatars(supabase, rows.map((r) => r.avatar_path))

  const byPerson = new Map<string, string>()
  for (const r of rows) {
    const url = signed.get(r.avatar_path)
    if (url) byPerson.set(r.id, url)
  }
  return byPerson
}
