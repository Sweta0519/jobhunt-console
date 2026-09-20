import { getSupabase } from '../lib/supabase'
import { BellMenu, type Note } from './BellMenu'

/**
 * Unread count and the list behind it.
 *
 * Two severities, kept apart in the menu: `action` is waiting on her, `news` is
 * something that happened. Only `action` drives the count on the bell, so the
 * badge always means "there is something to do", not "something occurred".
 */
export async function Bell() {
  const supabase = await getSupabase()
  const { data } = await supabase
    .from('notifications')
    .select('id,kind,severity,title,body,url,created_at,read_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(30)

  const notes = (data as Note[]) || []
  return <BellMenu notes={notes} />
}
