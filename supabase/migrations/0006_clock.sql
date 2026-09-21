-- Postgres as the clock.
--
-- GitHub's own cron is best effort and it has not been good enough here: in the
-- first two days exactly one scheduled run fired, four and a half hours late,
-- and on 21 September nothing fired at all, so the morning post sat unpublished.
-- pg_cron fires on the minute, and pg_net posts a workflow_dispatch to GitHub.
--
-- The GitHub schedules stay in place as a second chance. That is safe because
-- the workers are idempotent: publish refuses a post that already carries a
-- published_url, and the refresh workers upsert.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Which dispatches were fired, so a silent failure is visible rather than a
-- morning with no post. pg_net is asynchronous: the request id is all we have
-- at fire time and the status arrives later, which the reaper below collects.
create table if not exists jobhunt.clock_dispatch (
  id bigint generated always as identity primary key,
  workflow text not null,
  request_id bigint not null,
  fired_at timestamptz not null default now(),
  status_code int,
  error text,
  checked_at timestamptz
);

alter table jobhunt.clock_dispatch enable row level security;
alter table jobhunt.clock_dispatch force row level security;
revoke all on jobhunt.clock_dispatch from anon, authenticated;
grant all on jobhunt.clock_dispatch to service_role;

-- The console may read the clock's history, so "nothing ran" has an answer in
-- the app rather than only in a terminal. It may never write it.
grant select on jobhunt.clock_dispatch to authenticated;
create policy clock_dispatch_read on jobhunt.clock_dispatch
  for select to authenticated using ((select jobhunt.is_me()));

/**
 * Fire one GitHub workflow. The token is read from jobhunt.secrets, which is
 * granted to nobody and carries force row level security with no policies, so
 * it is unreachable through the API; only a security definer function like this
 * one can see it.
 */
create or replace function jobhunt.dispatch_workflow(p_workflow text)
returns bigint
language plpgsql
security definer
set search_path = jobhunt, net, pg_catalog
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select value #>> '{}' into v_token
  from jobhunt.secrets
  where key = 'github_dispatch_token';

  if v_token is null or v_token = '' then
    raise exception 'no github_dispatch_token in jobhunt.secrets';
  end if;

  select net.http_post(
    url := format(
      'https://api.github.com/repos/Sweta0519/jobhunt-console/actions/workflows/%s/dispatches',
      p_workflow
    ),
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'jobhunt-console-clock',
      'Content-Type', 'application/json'
    )
  ) into v_request_id;

  insert into jobhunt.clock_dispatch (workflow, request_id)
  values (p_workflow, v_request_id);

  return v_request_id;
end;
$$;

revoke all on function jobhunt.dispatch_workflow(text) from public, anon, authenticated;

/**
 * Collect the results pg_net left behind. GitHub answers a dispatch with 204;
 * anything else means the run did not start, and the most likely cause is a
 * token that was rotated or revoked. pg_net prunes its own response table after
 * a few hours, so a dispatch we never managed to read is recorded as such
 * rather than left looking pending forever.
 */
create or replace function jobhunt.reap_dispatches()
returns void
language plpgsql
security definer
set search_path = jobhunt, net, pg_catalog
as $$
begin
  update jobhunt.clock_dispatch d
  set status_code = r.status_code,
      error = case when r.status_code = 204 then null else left(r.content, 500) end,
      checked_at = now()
  from net._http_response r
  where r.id = d.request_id
    and d.checked_at is null;

  update jobhunt.clock_dispatch
  set error = 'no response recorded before pg_net pruned it',
      checked_at = now()
  where checked_at is null
    and fired_at < now() - interval '6 hours';

  delete from jobhunt.clock_dispatch where fired_at < now() - interval '30 days';
end;
$$;

revoke all on function jobhunt.reap_dispatches() from public, anon, authenticated;

-- Same wall-clock times the workflow files use, so the two clocks agree.
-- cron.schedule replaces a job of the same name, which makes this re-runnable.
select cron.schedule(
  'jobhunt-daily',
  '40 5 * * *',
  $$select jobhunt.dispatch_workflow('daily.yml')$$
);

select cron.schedule(
  'jobhunt-publish',
  '5 8 * * 1-5',
  $$select jobhunt.dispatch_workflow('publish.yml')$$
);

select cron.schedule(
  'jobhunt-reap',
  '*/10 * * * *',
  $$select jobhunt.reap_dispatches()$$
);
