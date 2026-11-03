-- Application answers: the form of a job, answers and a cover letter drafted from
-- the CV, and her saved answers. The console never submits anything.
--
-- answer_bank holds her fixed facts (notice period, salary expectation, work
-- authorization). Workers have NO grant on it, on purpose: a draft stores only a
-- bank_key and the value is joined in later, in her own browser session. Claude
-- therefore cannot leak what it never saw. Do not add a service_role grant here.
-- Values are plain text under RLS, the same as the master CV.
--
-- Every policy checks is_primary() as well as owner, as in 0013. The browser gets
-- select plus update on the decision columns only; the worker's results (form,
-- answers, generated_cover, model, suspicious) are not writable from a browser.
--
-- Apply order: .github/workflows/applications.yml must already be on main, or the
-- cron dispatch below gets a 404 and the clock health banner raises
-- "could not be started". Write config after: no application_config row means no work.

-- Her fixed facts. Workers have no grant on this table.
create table if not exists jobhunt.answer_bank (
  owner      uuid not null default jobhunt.owner_id(),
  key        text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value      text not null check (char_length(value) between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

-- What the form asks, one row per job. Its lifecycle is apart from the draft.
create table if not exists jobhunt.application_forms (
  id                  uuid primary key default gen_random_uuid(),
  owner               uuid not null default jobhunt.owner_id(),
  job_id              text not null,
  source              text check (source in ('greenhouse','ashby','lever','browser','paste')),
  status              text not null default 'queued'
                      check (status in ('queued','reading','read','needs_paste','failed','skipped')),
  reason              text,            -- machine code: robots_disallowed, shape_changed, feed_listing ...
  apply_url           text,            -- https only
  form                jsonb,           -- normalised questions. Worker only.
  form_sha            text,
  completeness        text check (completeness in ('complete','may_be_incomplete')),
  pasted_text         text check (char_length(pasted_text) <= 20000),
  paste_mode          text check (paste_mode in ('replace','add')),
  pilot_verdict       text check (pilot_verdict in ('all_seen','some_missing','wrong')),
  reread_requested_at timestamptz,
  normalised_at       timestamptz,
  attempts            int not null default 0,
  last_attempt_at     timestamptz,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (owner, job_id),
  foreign key (owner, job_id) references jobhunt.jobs (owner, id) on delete cascade,
  check (form is null or (jsonb_typeof(form) = 'object' and pg_column_size(form) < 200000))
);

create table if not exists jobhunt.application_drafts (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null default jobhunt.owner_id(),
  job_id           text not null,
  resume_draft_id  uuid not null references jobhunt.resume_drafts (id) on delete cascade,
  master_version   int  not null,
  form_sha         text,
  status           text not null default 'queued'
                   check (status in ('queued','drafting','draft','failed','skipped','discarded')),
  reason           text,
  answers          jsonb,              -- the worker's classification and text. Browser cannot change it.
  edits            jsonb not null default '{}'::jsonb,   -- { q_id: {text?, option_ids?} }, hers
  cover_text       text check (char_length(cover_text) <= 6000),   -- current, edits included
  generated_cover  text,               -- exactly what the worker produced
  cover_reason     text,
  cover_requested_at timestamptz,
  cover_drafted_at timestamptz,
  fact_flags       jsonb,
  suspicious       boolean not null default false,
  description_sha  text,
  model            text,
  generation       int  not null default 0,
  attempts         int  not null default 0,
  last_attempt_at  timestamptz,
  not_before       timestamptz,        -- cap or usage limit hit: the clock stays quiet until then
  drafted_at       timestamptz,
  edited_at        timestamptz,
  discarded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (owner, job_id),
  foreign key (owner, job_id) references jobhunt.jobs (owner, id) on delete cascade,
  foreign key (owner, master_version) references jobhunt.master_cv (owner, version),
  check (answers is null or (jsonb_typeof(answers) = 'array' and pg_column_size(answers) < 200000)),
  check (pg_column_size(edits) < 100000)
);
create index if not exists application_forms_status_idx  on jobhunt.application_forms  (owner, status);
create index if not exists application_drafts_status_idx on jobhunt.application_drafts (owner, status, created_at desc);
create index if not exists application_drafts_attempt_idx on jobhunt.application_drafts (owner, last_attempt_at desc);

alter table jobhunt.answer_bank        enable row level security;
alter table jobhunt.answer_bank        force  row level security;
alter table jobhunt.application_forms  enable row level security;
alter table jobhunt.application_forms  force  row level security;
alter table jobhunt.application_drafts enable row level security;
alter table jobhunt.application_drafts force  row level security;

drop policy if exists answer_bank_select on jobhunt.answer_bank;
create policy answer_bank_select on jobhunt.answer_bank for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));
drop policy if exists answer_bank_insert on jobhunt.answer_bank;
create policy answer_bank_insert on jobhunt.answer_bank for insert to authenticated
  with check (owner = auth.uid() and (select jobhunt.is_primary()));
drop policy if exists answer_bank_update on jobhunt.answer_bank;
create policy answer_bank_update on jobhunt.answer_bank for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()))
  with check (owner = auth.uid() and (select jobhunt.is_primary()));
drop policy if exists answer_bank_delete on jobhunt.answer_bank;
create policy answer_bank_delete on jobhunt.answer_bank for delete to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

drop policy if exists application_forms_select on jobhunt.application_forms;
create policy application_forms_select on jobhunt.application_forms for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

-- The browser may only move a form into states that are hers to set, and never
-- touch one the worker is reading.
drop policy if exists application_forms_update on jobhunt.application_forms;
create policy application_forms_update on jobhunt.application_forms for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('queued','read','needs_paste','failed','skipped'))
  with check (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('queued','read','needs_paste','failed','skipped'));

drop policy if exists application_drafts_select on jobhunt.application_drafts;
create policy application_drafts_select on jobhunt.application_drafts for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary()));

-- 'drafting' belongs to the worker: not settable, and a drafting row is not editable.
drop policy if exists application_drafts_update on jobhunt.application_drafts;
create policy application_drafts_update on jobhunt.application_drafts for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('queued','draft','failed','skipped','discarded'))
  with check (owner = auth.uid() and (select jobhunt.is_primary())
         and status in ('queued','draft','failed','skipped','discarded'));

-- A fresh table has no grants worth trusting: state them all. The service role has
-- a default grant on every new table in this schema (0001), so it is revoked here.
revoke all on jobhunt.answer_bank from public, anon, authenticated, service_role;
revoke all on jobhunt.application_forms, jobhunt.application_drafts from public, anon, authenticated;

grant select, delete on jobhunt.answer_bank to authenticated;
grant insert (key, value, updated_at) on jobhunt.answer_bank to authenticated;
grant update (value, updated_at) on jobhunt.answer_bank to authenticated;

grant select on jobhunt.application_forms, jobhunt.application_drafts to authenticated;
grant update (pasted_text, paste_mode, source, status, reason, reread_requested_at, pilot_verdict, updated_at)
  on jobhunt.application_forms to authenticated;
grant update (edits, cover_text, fact_flags, status, cover_requested_at, edited_at, discarded_at, updated_at)
  on jobhunt.application_drafts to authenticated;

grant all on jobhunt.application_forms, jobhunt.application_drafts to service_role;

-- Fires the workflow when something is waiting, at most every 30 minutes, so a
-- pasted form or a cover letter she asked for is picked up within about 15 minutes
-- with her PC off and no browser path to dispatch. It reads settings and the
-- queues only; it never reads answer_bank. Copies dispatch_boards_if_requested (0015).
create or replace function jobhunt.dispatch_applications_if_waiting()
returns void language plpgsql security definer set search_path = jobhunt, net, pg_catalog as $$
begin
  if exists (select 1 from jobhunt.settings
              where key = 'application_config' and value ->> 'enabled' = 'true')
     and not exists (select 1 from jobhunt.clock_dispatch
                      where workflow = 'applications.yml' and fired_at > now() - interval '30 minutes')
     and (
       exists (select 1 from jobhunt.resume_drafts r
                where r.status in ('draft','approved')
                  and exists (select 1 from jobhunt.jobs j
                               where j.owner = r.owner and j.id = r.job_id
                                 and not j.closed and j.status in ('found','saved'))
                  and not exists (select 1 from jobhunt.application_forms f
                                   where f.owner = r.owner and f.job_id = r.job_id))
       or exists (select 1 from jobhunt.application_forms where status = 'queued')
       or exists (select 1 from jobhunt.application_drafts
                   where status = 'queued' and (not_before is null or not_before < now()))
     ) then
    perform jobhunt.dispatch_workflow('applications.yml');
  end if;
end $$;
revoke all on function jobhunt.dispatch_applications_if_waiting() from public, anon, authenticated;

select cron.schedule('jobhunt-applications', '*/15 * * * *', $$select jobhunt.dispatch_applications_if_waiting()$$);

notify pgrst, 'reload schema';
