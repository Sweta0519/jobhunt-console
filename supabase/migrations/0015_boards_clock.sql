-- Apply order: .github/workflows/boards.yml must already be on main, or the dispatch
-- gets a 404 and the clock health banner raises "could not be started".

-- A company added in the console should not wait for tomorrow. Fires only when
-- something was asked for, and at most every 30 minutes. The worker clears the
-- request after an attempt, so a failing run does not retry past the guard.
create or replace function jobhunt.dispatch_boards_if_requested()
returns void language plpgsql security definer set search_path = jobhunt, net, pg_catalog as $$
begin
  if exists (select 1 from jobhunt.companies
              where probe_requested_at > now() - interval '6 hours')
     and not exists (select 1 from jobhunt.clock_dispatch
                      where workflow = 'boards.yml' and fired_at > now() - interval '30 minutes') then
    perform jobhunt.dispatch_workflow('boards.yml');
  end if;
end $$;
revoke all on function jobhunt.dispatch_boards_if_requested() from public, anon, authenticated;

-- Before jobhunt-daily at 05:40, so a board found today is read on its first poll
-- by the same workflow, and the daily run only sees baselined boards.
select cron.schedule('jobhunt-boards', '20 4 * * *', $$select jobhunt.dispatch_workflow('boards.yml')$$);
select cron.schedule('jobhunt-boards-requested', '*/15 * * * *', $$select jobhunt.dispatch_boards_if_requested()$$);
