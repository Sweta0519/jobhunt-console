-- Her edits ask for the requirement status to be rechecked against the edited CV.
-- The browser may only set the request; the worker clears it and writes the result.
alter table jobhunt.resume_drafts
  add column if not exists requirements_requested_at timestamptz,
  add column if not exists requirements_checked_at  timestamptz,
  add column if not exists requirements_reason      text,      -- recheck_invalid, timeout, tool_drift ...
  add column if not exists requirements_attempts    int not null default 0;
create index if not exists resume_drafts_recheck_idx on jobhunt.resume_drafts (owner, requirements_requested_at)
  where requirements_requested_at is not null;
grant update (requirements_requested_at) on jobhunt.resume_drafts to authenticated;
notify pgrst, 'reload schema';
