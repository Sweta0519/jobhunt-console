-- Jobhunt Console — schema, grants and row level security.
--
-- Apply with:  supabase db push   (or paste into the SQL editor)
--
-- AFTER APPLYING, two manual steps in the Supabase dashboard:
--   1. Settings -> API -> Exposed schemas: add `jobhunt`.
--      Without this PostgREST resolves against `public` and every query 404s.
--   2. Authentication -> Providers -> disable new sign-ups.
--      auth.users is shared with other apps in this project.

create schema if not exists jobhunt;
grant usage on schema jobhunt to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Single-user identity
--
-- One row, not a UUID hardcoded into thirty policies. `allowed_user` has RLS on
-- and deliberately NO policies, so it is unreachable through the API and can
-- only be read by the security-definer function below.
-- ---------------------------------------------------------------------------
create table if not exists jobhunt.allowed_user (
  user_id uuid primary key references auth.users(id) on delete restrict,
  note    text
);
alter table jobhunt.allowed_user enable row level security;

create or replace function jobhunt.is_me() returns boolean
  language sql stable security definer set search_path = jobhunt, pg_catalog as $$
  select exists (select 1 from jobhunt.allowed_user where user_id = auth.uid());
$$;
revoke all on function jobhunt.is_me() from public;
grant execute on function jobhunt.is_me() to authenticated;

-- Stamps `owner` on rows the service role inserts, where auth.uid() is null.
create or replace function jobhunt.owner_id() returns uuid
  language sql stable set search_path = jobhunt, pg_catalog as $$
  select user_id from jobhunt.allowed_user limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists jobhunt.companies (
  slug            text primary key,
  name            text not null,
  owner           uuid not null default jobhunt.owner_id(),
  board_kind      text check (board_kind in ('greenhouse','ashby','lever','manual')),
  board_token     text,                       -- e.g. 'vercel' for boards-api.greenhouse.io/v1/boards/vercel
  is_target       boolean not null default false,
  weight          int not null default 0,     -- community-question ranking weight
  applied_at      date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists jobhunt.jobs (
  id              text primary key,           -- '<source>:<native id>'
  owner           uuid not null default jobhunt.owner_id(),
  source          text not null,              -- greenhouse|ashby|lever|linkedin-export|manual
  company_slug    text references jobhunt.companies(slug) on delete set null,
  company         text not null,
  title           text not null,
  url             text,
  location        text,
  workplace_type  text,
  posted_date     date,
  excerpt         text,                       -- first 400 chars; never the full description
  score           int,
  score_breakdown jsonb,
  score_notes     jsonb,
  german_required boolean not null default false,
  remote          boolean,
  eligible        boolean,                    -- passes the Germany-remote / EU-remote rule
  status          text not null default 'found'
                  check (status in ('found','saved','applied','shortlisted','interview','rejected','closed')),
  applied_at      date,
  notes           text,
  closed          boolean not null default false,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jobs_rank_idx on jobhunt.jobs (score desc nulls last)
  where closed = false and eligible = true;
create index if not exists jobs_company_idx on jobhunt.jobs (company_slug);

-- People she knows or has identified. PII: real names and profile URLs.
create table if not exists jobhunt.people (
  id              text primary key,
  owner           uuid not null default jobhunt.owner_id(),
  name            text not null,
  url             text,
  headline        text,
  company_slug    text references jobhunt.companies(slug) on delete set null,
  company         text,
  position        text,
  relationship    text,                       -- connection|ex-colleague|recruiter|hiring-team|found
  tier            int check (tier between 1 and 4),
  connected_on    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists people_company_idx on jobhunt.people (company_slug);

-- Outreach. The app drafts and tracks; sending happens by hand in LinkedIn.
create table if not exists jobhunt.outreach (
  id              text primary key,           -- q_0001
  owner           uuid not null default jobhunt.owner_id(),
  person_id       text references jobhunt.people(id) on delete set null,
  person_name     text not null,
  person_url      text,
  company_slug    text references jobhunt.companies(slug) on delete set null,
  company         text,
  job_id          text,
  channel         text not null check (channel in ('connect_note','connect_blank','message')),
  kind            text not null default 'initial' check (kind in ('initial','intro','F1','F2')),
  parent_id       text,
  body            text,
  reason          text,                       -- why this person, shown before asking to approve
  status          text not null default 'draft'
                  check (status in ('draft','approved','sent','accepted','replied','skipped','closed')),
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  sent_at         timestamptz,
  replied_at      timestamptz,
  followup_due_at timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists outreach_status_idx on jobhunt.outreach (status, created_at desc);

create table if not exists jobhunt.posts (
  id              text primary key,           -- p_0001
  owner           uuid not null default jobhunt.owner_id(),
  post_date       date,
  format          text check (format in ('card','deck','text')),
  pillar          text,
  title           text,
  size            text,
  card            jsonb,
  slides          jsonb,
  caption         jsonb,                      -- {hook, body, cta, hashtags[]}
  alt_text        text,
  sources         jsonb,
  status          text not null default 'draft'
                  check (status in ('draft','approved','rendered','published','skipped','failed')),
  preview_path    text,                       -- object path in the private bucket
  asset_paths     jsonb,
  published_urn   text,
  published_url   text,
  published_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  rendered_at     timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists posts_date_idx on jobhunt.posts (post_date desc);

create table if not exists jobhunt.questions (
  id              text primary key,           -- 'dc:…' | 'so:…' | 'gh-issue:…' | 'gh-disc:…' | 'manual:…'
  owner           uuid not null default jobhunt.owner_id(),
  source          text not null,
  site            text,
  company_slug    text references jobhunt.companies(slug) on delete set null,
  company         text,
  title           text not null,
  url             text not null,
  excerpt         text,
  author          text,
  asked_at        timestamptz,
  score           int,
  comments        int,
  has_answer      boolean not null default false,
  tags            text[],
  rank            numeric,
  why             text,
  status          text not null default 'new' check (status in ('new','answered','skipped')),
  answered_at     timestamptz,
  answer_url      text,
  note            text,
  starred         boolean not null default false,   -- "save for desktop" from the phone
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists questions_open_idx on jobhunt.questions (rank desc) where status = 'new';

-- Public artifacts: the evidence list. Answers land here automatically; PRs and
-- issues are added by hand.
create table if not exists jobhunt.contributions (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default jobhunt.owner_id(),
  kind            text not null check (kind in ('answer','pr','issue','post','runbook')),
  company_slug    text references jobhunt.companies(slug) on delete set null,
  company         text,
  title           text not null,
  url             text not null,
  source_ref      text,                       -- question id, post id, repo#number
  happened_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create unique index if not exists contributions_url_idx on jobhunt.contributions (url);

-- Non-secret config the app may read: schedule, thresholds, token EXPIRY (not the
-- token itself), last-run summaries.
create table if not exists jobhunt.settings (
  key             text primary key,
  owner           uuid not null default jobhunt.owner_id(),
  value           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- Secrets: the LinkedIn access token lives here and NOWHERE the browser can reach.
-- RLS is on with no policies and no grants, so PostgREST returns nothing for any
-- session. Only the service role (workers) can read or write it.
create table if not exists jobhunt.secrets (
  key             text primary key,           -- 'linkedin_token'
  value           jsonb not null,
  updated_at      timestamptz not null default now()
);
alter table jobhunt.secrets enable row level security;
alter table jobhunt.secrets force row level security;

-- Worker run log, and the heartbeat the app reads.
create table if not exists jobhunt.runs (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default jobhunt.owner_id(),
  worker          text not null,              -- questions|jobs|publish|repo|import
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  ok              boolean,
  summary         jsonb,
  error           text
);
create index if not exists runs_worker_idx on jobhunt.runs (worker, started_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Read is allowed for the one user. Writes from the browser are confined to the
-- decision columns by COLUMN-LEVEL GRANTS below; a policy alone cannot stop an
-- UPDATE of a column it permits.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['companies','jobs','people','outreach','posts',
                           'questions','contributions','settings','runs'] loop
    execute format('alter table jobhunt.%I enable row level security', t);
    execute format('alter table jobhunt.%I force row level security', t);

    execute format('drop policy if exists %I on jobhunt.%I', t || '_select', t);
    execute format($f$
      create policy %I on jobhunt.%I for select to authenticated
        using (owner = auth.uid() and (select jobhunt.is_me()))
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on jobhunt.%I', t || '_update', t);
    execute format($f$
      create policy %I on jobhunt.%I for update to authenticated
        using (owner = auth.uid() and (select jobhunt.is_me()))
        with check (owner = auth.uid() and (select jobhunt.is_me()))
    $f$, t || '_update', t);
  end loop;
end $$;

-- Contributions and people are the two things she adds by hand from the app.
drop policy if exists contributions_insert on jobhunt.contributions;
create policy contributions_insert on jobhunt.contributions for insert to authenticated
  with check (owner = auth.uid() and (select jobhunt.is_me()));
drop policy if exists people_insert on jobhunt.people;
create policy people_insert on jobhunt.people for insert to authenticated
  with check (owner = auth.uid() and (select jobhunt.is_me()));

-- ---------------------------------------------------------------------------
-- Column-level grants: the real lock on what the browser may change.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema jobhunt from anon, authenticated;

grant select on jobhunt.companies, jobhunt.jobs, jobhunt.people, jobhunt.outreach,
                jobhunt.posts, jobhunt.questions, jobhunt.contributions,
                jobhunt.settings, jobhunt.runs
  to authenticated;

grant update (status, applied_at, notes, updated_at)        on jobhunt.jobs      to authenticated;
grant update (status, approved_at, sent_at, replied_at, body, followup_due_at, updated_at)
                                                            on jobhunt.outreach  to authenticated;
grant update (status, approved_at, post_date, updated_at)   on jobhunt.posts     to authenticated;
grant update (status, answered_at, answer_url, note, starred, updated_at)
                                                            on jobhunt.questions to authenticated;
grant update (notes, is_target, updated_at)                 on jobhunt.companies to authenticated;
grant update (notes, updated_at)                            on jobhunt.people    to authenticated;
grant insert on jobhunt.contributions, jobhunt.people to authenticated;

-- anon gets nothing: a leaked anon key with no session sees an empty schema.
alter default privileges in schema jobhunt revoke all on tables from anon, authenticated;

-- The workers run as service_role. It bypasses RLS but still needs table
-- privileges, and a fresh schema has none of Supabase's `public` defaults.
grant all on all tables in schema jobhunt to service_role;
grant all on all sequences in schema jobhunt to service_role;
alter default privileges in schema jobhunt grant all on tables to service_role;

-- `secrets` is never granted to anyone. Left out of every grant above on purpose;
-- this makes that explicit and survives someone running a blanket GRANT later.
revoke all on jobhunt.secrets from anon, authenticated;
