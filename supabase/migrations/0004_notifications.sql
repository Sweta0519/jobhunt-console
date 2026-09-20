-- Things that happened, or are about to, that she should look at.
--
-- Two kinds, kept visually distinct in the bell:
--   action  something is waiting on her (a follow-up is due, a token is expiring)
--   news    somebody replied, a pull request merged
--
-- `dedupe_key` is what stops the same reply being announced every run. It is a
-- natural key built by the worker, e.g. `reply:dc:community.vercel.com/49420:4`.

create table if not exists jobhunt.notifications (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default jobhunt.owner_id(),
  kind        text not null,                 -- pr_merged | pr_comment | answer_reply | followup_due | token_expiring | run_failed | post_failed
  severity    text not null default 'news' check (severity in ('action', 'news')),
  title       text not null,
  body        text,
  url         text,
  entity_ref  text,                          -- q_0014 | manual:supabase/supabase#50594 | dc:…
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create unique index if not exists notifications_dedupe_idx
  on jobhunt.notifications (dedupe_key);
create index if not exists notifications_unread_idx
  on jobhunt.notifications (created_at desc) where read_at is null;

alter table jobhunt.notifications enable row level security;
alter table jobhunt.notifications force row level security;

drop policy if exists notifications_select on jobhunt.notifications;
create policy notifications_select on jobhunt.notifications for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_me()));

-- She may only mark them read; the workers write everything else.
drop policy if exists notifications_update on jobhunt.notifications;
create policy notifications_update on jobhunt.notifications for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_me()))
  with check (owner = auth.uid() and (select jobhunt.is_me()));

revoke all on jobhunt.notifications from anon, authenticated;
grant select on jobhunt.notifications to authenticated;
grant update (read_at) on jobhunt.notifications to authenticated;
grant all on jobhunt.notifications to service_role;

-- Watermarks, so a reply is only new once.
alter table jobhunt.contributions add column if not exists last_seen_count int;
alter table jobhunt.contributions add column if not exists last_checked_at timestamptz;
alter table jobhunt.contributions add column if not exists state text;   -- open | merged | closed
grant all on jobhunt.contributions to service_role;
