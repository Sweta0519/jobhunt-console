-- More job boards, found rather than listed by hand.
--
-- A role was missed because its company was in no list, while most of the
-- companies in the console were never polled. This stores where each company's
-- board is, how sure we are, and which roles were already open when a board was
-- first read, so a new board does not count weeks-old postings as news.
--
-- Apply BEFORE the code that uses it: the workers select the new columns, and
-- old code simply ignores them.

-- job_descriptions.kind gains 'aggregator' (full text from a feed such as Himalayas).
-- 0013 declares the check inline, so Postgres named it job_descriptions_kind_check.
alter table jobhunt.job_descriptions drop constraint if exists job_descriptions_kind_check;
alter table jobhunt.job_descriptions add constraint job_descriptions_kind_check
  check (kind in ('board', 'resolved', 'summary', 'aggregator'));

alter table jobhunt.companies drop constraint if exists companies_board_kind_check;
alter table jobhunt.companies add constraint companies_board_kind_check
  check (board_kind in ('greenhouse','ashby','lever','teamtailor','workable','recruitee','personio','manual'));

alter table jobhunt.companies add column if not exists origin text
  check (origin in ('import','aggregator','discovered','seed','manual'));
alter table jobhunt.companies add column if not exists priority boolean not null default false;
alter table jobhunt.companies add column if not exists board_block text
  check (board_block in ('staffing','user'));
alter table jobhunt.companies add column if not exists board_added_at timestamptz;
alter table jobhunt.companies add column if not exists board_baselined_at timestamptz;
alter table jobhunt.companies add column if not exists board_fail_count int not null default 0;
alter table jobhunt.companies add column if not exists next_probe_at timestamptz;
alter table jobhunt.companies add column if not exists probe_requested_at timestamptz;
alter table jobhunt.companies add column if not exists domain_source text
  check (domain_source in ('manual','aggregator','seed'));
alter table jobhunt.companies add column if not exists careers_checked_at timestamptz;
alter table jobhunt.companies add column if not exists careers_baselined_at timestamptz;
alter table jobhunt.companies add column if not exists careers_status text
  check (careers_status in ('board','postings','hint','shell','none','moved','disallowed','blocked','unreachable'));
create index if not exists companies_probe_idx on jobhunt.companies (owner, next_probe_at);

alter table jobhunt.jobs add column if not exists backlog boolean not null default false;
alter table jobhunt.jobs add column if not exists draft_requested_at timestamptz;
grant update (draft_requested_at) on jobhunt.jobs to authenticated;

-- Boards already polled have nothing to protect: their rows exist.
update jobhunt.companies c
   set board_baselined_at = now(), board_added_at = coalesce(c.board_added_at, now())
 where c.board_kind is not null and c.board_token is not null and c.board_kind <> 'manual'
   and exists (select 1 from jobhunt.jobs j
                where j.owner = c.owner and starts_with(j.id, c.board_kind || ':' || c.board_token || ':'));

create table if not exists jobhunt.board_candidates (
  owner           uuid not null default jobhunt.owner_id(),
  company_slug    text not null,
  kind            text not null check (kind in ('greenhouse','ashby','lever','teamtailor','workable','recruitee','personio','smartrecruiters','workday','gem','careers')),
  token           text not null check (char_length(token) <= 255),
  status          text not null check (status in ('confirmed','review','parked','accepted','rejected','unsupported','hint')),
  board_name      text,
  board_url       text,
  postings        int not null default 0,
  relevant        int not null default 0,
  sample_titles   jsonb not null default '[]',
  evidence        jsonb not null default '{}',
  first_seen_at   timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  decided_at      timestamptz,
  primary key (owner, company_slug, kind, token),
  foreign key (owner, company_slug) references jobhunt.companies (owner, slug) on delete cascade
);
create index if not exists board_candidates_review_idx on jobhunt.board_candidates (owner, status);

alter table jobhunt.board_candidates enable row level security;
alter table jobhunt.board_candidates force row level security;
drop policy if exists board_candidates_select on jobhunt.board_candidates;
create policy board_candidates_select on jobhunt.board_candidates for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_me()));
revoke all on jobhunt.board_candidates from public, anon, authenticated;
grant select on jobhunt.board_candidates to authenticated;
grant all on jobhunt.board_candidates to service_role;

-- The browser cannot write board columns, and must not: the three functions below
-- are its only way to change them. Each acts on auth.uid() only and takes no owner.

create or replace function jobhunt.add_company(p_slug text, p_name text, p_domain text default null)
returns text language plpgsql security definer set search_path = jobhunt, pg_catalog as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null or not (select jobhunt.is_me()) then raise exception 'not permitted'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{0,59}$' or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'invalid company';
  end if;
  if p_domain is not null and p_domain !~ '^([a-z0-9-]{1,63}\.)+[a-z]{2,}$' then
    raise exception 'invalid domain';
  end if;
  insert into jobhunt.companies (owner, slug, name, domain, domain_source, origin, is_target, priority, probe_requested_at, next_probe_at)
  values (v_owner, p_slug, btrim(p_name), p_domain, case when p_domain is not null then 'manual' end, 'manual', true, true, now(), now())
  on conflict (owner, slug) do update
    set is_target = true, priority = true, board_block = null,
        domain = coalesce(excluded.domain, jobhunt.companies.domain),
        domain_source = case when excluded.domain is not null then 'manual' else jobhunt.companies.domain_source end,
        careers_checked_at = null,
        probe_requested_at = case when jobhunt.companies.board_token is null then now() end,
        updated_at = now();
  return p_slug;
end $$;

create or replace function jobhunt.decide_board_candidate(p_slug text, p_kind text, p_token text, p_accept boolean)
returns void language plpgsql security definer set search_path = jobhunt, pg_catalog as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null or not (select jobhunt.is_me()) then raise exception 'not permitted'; end if;
  -- Only a board the worker found can be accepted: the browser never supplies a token of its own.
  update jobhunt.board_candidates
     set status = case when p_accept then 'accepted' else 'rejected' end, decided_at = now()
   where owner = v_owner and company_slug = p_slug and kind = p_kind and token = p_token
     and status in ('review','parked','confirmed');
  if not found then raise exception 'no such candidate'; end if;
  if p_accept then
    if p_kind in ('smartrecruiters','workday','gem','careers') then raise exception 'unsupported board'; end if;
    update jobhunt.companies
       set board_kind = p_kind, board_token = p_token, board_block = null,
           board_added_at = now(), board_baselined_at = null, updated_at = now()
     where owner = v_owner and slug = p_slug;
  else
    update jobhunt.companies
       set board_kind = null, board_token = null, updated_at = now()
     where owner = v_owner and slug = p_slug and board_kind = p_kind and board_token = p_token;
  end if;
end $$;

create or replace function jobhunt.set_company_watch(p_slug text, p_watch boolean)
returns void language plpgsql security definer set search_path = jobhunt, pg_catalog as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null or not (select jobhunt.is_me()) then raise exception 'not permitted'; end if;
  update jobhunt.companies
     set board_block = case when p_watch then null else 'user' end, updated_at = now()
   where owner = v_owner and slug = p_slug;
  if not found then raise exception 'no such company'; end if;
  -- A board no longer read can never close its rows. Her decisions stay; the rest go.
  if not p_watch then
    update jobhunt.jobs set closed = true, updated_at = now()
     where owner = v_owner and company_slug = p_slug and status = 'found' and closed = false
       and id ~ '^(greenhouse|ashby|lever|teamtailor|workable|recruitee|personio):';
  end if;
end $$;

revoke all on function jobhunt.add_company(text, text, text) from public, anon;
revoke all on function jobhunt.decide_board_candidate(text, text, text, boolean) from public, anon;
revoke all on function jobhunt.set_company_watch(text, boolean) from public, anon;
grant execute on function jobhunt.add_company(text, text, text) to authenticated;
grant execute on function jobhunt.decide_board_candidate(text, text, text, boolean) to authenticated;
grant execute on function jobhunt.set_company_watch(text, boolean) to authenticated;

notify pgrst, 'reload schema';
