-- Tailored CV drafts for human review. The console never submits anything.
--
-- The master CV and the drafts are personal data in a project shared by two
-- people, so every policy checks is_primary() as well as owner: is_me() alone
-- is also true for the second person. Workers use the service role. The browser
-- gets select, plus update on the decision columns only.
--
-- Apply order: .github/workflows/resumes.yml must already be on main, or the
-- cron dispatch below gets a 404 and the clock health banner raises
-- "could not be started".

create table if not exists jobhunt.master_cv (
  owner       uuid not null default jobhunt.owner_id(),
  version     int  not null,
  doc         jsonb not null check (jsonb_typeof(doc) = 'object'),
  source_sha  text not null,
  created_at  timestamptz not null default now(),
  primary key (owner, version),
  unique (owner, source_sha)
);

-- Full posting text, kept apart from jobs because /jobs selects * over 400 rows.
create table if not exists jobhunt.job_descriptions (
  owner       uuid not null default jobhunt.owner_id(),
  job_id      text not null,
  description text not null check (char_length(description) <= 60000),
  kind        text not null check (kind in ('board', 'resolved', 'summary')),
  chars       int generated always as (char_length(description)) stored,
  sha         text not null,
  fetched_at  timestamptz not null default now(),
  primary key (owner, job_id),
  foreign key (owner, job_id) references jobhunt.jobs (owner, id) on delete cascade
);

create table if not exists jobhunt.resume_drafts (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default jobhunt.owner_id(),
  job_id          text not null,
  master_version  int  not null,
  status          text not null default 'queued'
                  check (status in ('queued','drafting','draft','approved','discarded','failed','skipped')),
  reason          text,            -- machine code: thin_description, facts_failed, job_closed ...
  doc             jsonb,           -- current text, edits included
  generated_doc   jsonb,           -- exactly what the worker produced; browser cannot change it
  requirements    jsonb,           -- [{text, kind, status, evidence, note}]
  gaps            jsonb,           -- [{text, kind, note}], never rendered into the CV
  fact_flags      jsonb,           -- [{code, ref, token}]
  suspicious      boolean not null default false,
  description_sha text,
  model           text,
  generation      int  not null default 0,
  attempts        int  not null default 0,
  last_attempt_at timestamptz,
  drafted_at      timestamptz,
  edited_at       timestamptz,
  approved_at     timestamptz,
  discarded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner, job_id),
  foreign key (owner, job_id) references jobhunt.jobs (owner, id) on delete cascade,
  foreign key (owner, master_version) references jobhunt.master_cv (owner, version),
  check (status not in ('draft','approved') or doc is not null),
  check (doc is null or (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 200000))
);
create index if not exists resume_drafts_status_idx on jobhunt.resume_drafts (owner, status, created_at desc);
create index if not exists resume_drafts_attempt_idx on jobhunt.resume_drafts (owner, last_attempt_at desc);

alter table jobhunt.master_cv        enable row level security;
alter table jobhunt.master_cv        force  row level security;
alter table jobhunt.job_descriptions enable row level security;
alter table jobhunt.job_descriptions force  row level security;
alter table jobhunt.resume_drafts    enable row level security;
alter table jobhunt.resume_drafts    force  row level security;

drop policy if exists master_cv_select on jobhunt.master_cv;
create policy master_cv_select on jobhunt.master_cv for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

drop policy if exists job_descriptions_select on jobhunt.job_descriptions;
create policy job_descriptions_select on jobhunt.job_descriptions for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

drop policy if exists resume_drafts_select on jobhunt.resume_drafts;
create policy resume_drafts_select on jobhunt.resume_drafts for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

-- The browser may only move a row into states that are hers to set. 'drafting'
-- and 'skipped' and 'failed' belong to the worker.
drop policy if exists resume_drafts_update on jobhunt.resume_drafts;
create policy resume_drafts_update on jobhunt.resume_drafts for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('draft','approved','discarded','failed','skipped'))
  with check (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('draft','approved','discarded','queued'));

-- A fresh table has no grants worth trusting: state them all.
revoke all on jobhunt.master_cv, jobhunt.job_descriptions, jobhunt.resume_drafts from public, anon, authenticated;
grant select on jobhunt.master_cv, jobhunt.job_descriptions, jobhunt.resume_drafts to authenticated;
grant update (doc, fact_flags, status, edited_at, approved_at, discarded_at, updated_at)
  on jobhunt.resume_drafts to authenticated;
grant all on jobhunt.master_cv, jobhunt.job_descriptions, jobhunt.resume_drafts to service_role;

-- 25 minutes after jobhunt-daily's latest finish (05:40 + 15 min timeout + margin),
-- and once more in the afternoon so a morning usage limit drains the same day.
-- An empty queue costs one short plan step and no Claude call.
select cron.schedule(
  'jobhunt-resumes',
  '10 6,13 * * *',
  $$select jobhunt.dispatch_workflow('resumes.yml')$$
);

notify pgrst, 'reload schema';
