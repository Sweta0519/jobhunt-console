-- A notify-only tick every three hours during her day.
--
-- The daily run checks threads once a morning. Once a maintainer is actually
-- replying, a day is too long: three replies to her on supabase/supabase#50628
-- landed between 00:39 and 03:21 and were not seen until she read the mail
-- herself. This dispatches .github/workflows/notify.yml, which runs only the
-- notifier, at 07:00, 10:00, 13:00, 16:00, 19:00 and 22:00 Berlin.
--
-- Times are UTC in cron. Berlin is UTC+2 until 25 October; the winter shift of
-- one hour does not matter for a check that runs every three hours anyway.

select cron.schedule(
  'jobhunt-notify',
  '0 5,8,11,14,17,20 * * *',
  $$select jobhunt.dispatch_workflow('notify.yml')$$
);
