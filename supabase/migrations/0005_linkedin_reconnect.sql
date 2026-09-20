-- Reconnecting LinkedIn from the browser, without handing the app a key that
-- could read the token back.
--
-- The obvious approach is to give the app the service role key so it can write
-- to `secrets`. That key bypasses row level security on every schema in the
-- project, so it must never sit in a web app. Instead: one security-definer
-- function that writes the token and returns nothing. The caller can store a
-- token and can never read one.

create or replace function jobhunt.store_linkedin_token(
  p_access_token text,
  p_person_urn   text,
  p_expires_at   timestamptz
) returns void
language plpgsql security definer set search_path = jobhunt, pg_catalog as $$
begin
  if not (select jobhunt.is_me()) then
    raise exception 'not permitted';
  end if;

  insert into jobhunt.secrets (key, value, updated_at)
  values (
    'linkedin_token',
    jsonb_build_object(
      'access_token', p_access_token,
      'person_urn',   p_person_urn,
      'expires_at',   p_expires_at,
      -- Keep whatever the worker was already using, so a reconnect cannot
      -- silently change the API version or the post visibility.
      'api_version',  coalesce((select value->>'api_version' from jobhunt.secrets where key = 'linkedin_token'), '202608'),
      'visibility',   coalesce((select value->>'visibility'  from jobhunt.secrets where key = 'linkedin_token'), 'PUBLIC')
    ),
    now()
  )
  on conflict (key) do update set value = excluded.value, updated_at = now();

  -- Only the expiry is mirrored where the console can read it.
  insert into jobhunt.settings (key, value, updated_at)
  values ('linkedin_token_status', jsonb_build_object('expires_at', p_expires_at), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function jobhunt.store_linkedin_token(text, text, timestamptz) from public, anon;
grant execute on function jobhunt.store_linkedin_token(text, text, timestamptz) to authenticated;
