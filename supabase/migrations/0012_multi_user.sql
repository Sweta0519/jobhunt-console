-- A second person in the same console.
--
-- A family member runs their own job hunt here: their own companies, jobs,
-- people, outreach, prep and notifications, behind their own sign-in. Every
-- table already carried `owner` and every policy already checked
-- `owner = auth.uid()`, so reads were per-person from the start. Three things
-- were still single-user, and this fixes them:
--
--   * primary keys were global. Two people tracking Supabase need two
--     `companies` rows called 'supabase', so the job-hunt tables now key on
--     (owner, id), and the foreign keys between them carry owner too;
--   * owner_id(), the column default, picked "the" allowed user with
--     `limit 1`. With two rows that is a coin toss. It now prefers the signed-in
--     user and falls back to the primary owner for service-role writes;
--   * the things only she has (LinkedIn publishing, the clock's history, the
--     contact photos) were gated on is_me(), which a second allowed user also
--     passes. Those now check is_primary().
--
-- Posts, questions and contributions stay hers and keep their keys: the
-- second person uses the job-hunt half only, and their rows there are simply
-- empty.

-- ---------------------------------------------------------------------------
-- Who is primary
-- ---------------------------------------------------------------------------
alter table jobhunt.allowed_user add column if not exists is_primary boolean not null default false;
alter table jobhunt.allowed_user add column if not exists label text;

-- Today there is exactly one row, and it is hers.
update jobhunt.allowed_user set is_primary = true
 where (select count(*) from jobhunt.allowed_user) = 1;

do $$
begin
  if not exists (select 1 from jobhunt.allowed_user where is_primary) then
    raise exception 'no primary owner: mark one allowed_user row is_primary before applying';
  end if;
end $$;

create unique index if not exists allowed_user_one_primary
  on jobhunt.allowed_user ((true)) where is_primary;

create or replace function jobhunt.is_primary() returns boolean
  language sql stable security definer set search_path = jobhunt, pg_catalog as $$
  select exists (select 1 from jobhunt.allowed_user where user_id = auth.uid() and is_primary);
$$;
revoke all on function jobhunt.is_primary() from public;
grant execute on function jobhunt.is_primary() to authenticated;

-- Security definer now: as a column default it runs as whoever inserts, and
-- `authenticated` has no grant on allowed_user.
create or replace function jobhunt.owner_id() returns uuid
  language sql stable security definer set search_path = jobhunt, pg_catalog as $$
  select coalesce(auth.uid(), (select user_id from jobhunt.allowed_user where is_primary));
$$;

-- ---------------------------------------------------------------------------
-- Per-owner keys
-- ---------------------------------------------------------------------------

-- Every foreign key into companies or people names the old single-column key,
-- so they go first and come back composite below.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'f'
       and confrelid in ('jobhunt.companies'::regclass, 'jobhunt.people'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table jobhunt.companies drop constraint companies_pkey, add primary key (owner, slug);
alter table jobhunt.people    drop constraint people_pkey,    add primary key (owner, id);
alter table jobhunt.jobs      drop constraint jobs_pkey,      add primary key (owner, id);
alter table jobhunt.outreach  drop constraint outreach_pkey,  add primary key (owner, id);
alter table jobhunt.prep      drop constraint prep_pkey,      add primary key (owner, id);
alter table jobhunt.settings  drop constraint settings_pkey,  add primary key (owner, key);

-- A row can only point at a company or person of the same owner. Deleting one
-- clears the slug or person, never the owner.
alter table jobhunt.jobs add constraint jobs_company_fkey
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete set null (company_slug);
alter table jobhunt.people add constraint people_company_fkey
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete set null (company_slug);
alter table jobhunt.outreach add constraint outreach_company_fkey
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete set null (company_slug);
alter table jobhunt.questions add constraint questions_company_fkey
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete set null (company_slug);
alter table jobhunt.contributions add constraint contributions_company_fkey
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete set null (company_slug);
alter table jobhunt.outreach add constraint outreach_person_fkey
  foreign key (owner, person_id) references jobhunt.people (owner, id) on delete set null (person_id);

-- The same reminder may exist once per person.
drop index if exists jobhunt.notifications_dedupe_idx;
create unique index notifications_dedupe_idx on jobhunt.notifications (owner, dedupe_key);

-- ---------------------------------------------------------------------------
-- Hers only
-- ---------------------------------------------------------------------------
drop policy if exists clock_dispatch_read on jobhunt.clock_dispatch;
create policy clock_dispatch_read on jobhunt.clock_dispatch
  for select to authenticated using ((select jobhunt.is_primary()));

-- Photos of the people she messages, fetched from her own LinkedIn session.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select jobhunt.is_primary()));

-- Same function as 0005, with two changes: only the primary owner may store a
-- token, and the settings mirror upserts on the new (owner, key) key.
create or replace function jobhunt.store_linkedin_token(
  p_access_token text,
  p_person_urn   text,
  p_expires_at   timestamptz
) returns void
language plpgsql security definer set search_path = jobhunt, pg_catalog as $$
begin
  if not (select jobhunt.is_primary()) then
    raise exception 'not permitted';
  end if;

  insert into jobhunt.secrets (key, value, updated_at)
  values (
    'linkedin_token',
    jsonb_build_object(
      'access_token', p_access_token,
      'person_urn',   p_person_urn,
      'expires_at',   p_expires_at,
      'api_version',  coalesce((select value->>'api_version' from jobhunt.secrets where key = 'linkedin_token'), '202608'),
      'visibility',   coalesce((select value->>'visibility'  from jobhunt.secrets where key = 'linkedin_token'), 'PUBLIC')
    ),
    now()
  )
  on conflict (key) do update set value = excluded.value, updated_at = now();

  insert into jobhunt.settings (owner, key, value, updated_at)
  values (auth.uid(), 'linkedin_token_status', jsonb_build_object('expires_at', p_expires_at), now())
  on conflict (owner, key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function jobhunt.store_linkedin_token(text, text, timestamptz) from public, anon;
grant execute on function jobhunt.store_linkedin_token(text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
