-- Teamtailor as a fourth job board.
--
-- Reap's Technical Customer Engineer (EMEA) names Germany, describes exactly
-- the work she does, and sat open for three months without ever reaching the
-- Jobs tab, because careers.reap.global runs on Teamtailor and the worker only
-- knew Greenhouse, Ashby and Lever. Her own July application to the same
-- company surfaced only through the Gmail scan.
--
-- Teamtailor publishes /jobs.rss per career site: full descriptions and a
-- tt:location block per country. board_token is the career host.

alter table jobhunt.companies drop constraint if exists companies_board_kind_check;
alter table jobhunt.companies add constraint companies_board_kind_check
  check (board_kind in ('greenhouse', 'ashby', 'lever', 'teamtailor', 'manual'));

update jobhunt.companies
   set board_kind = 'teamtailor',
       board_token = 'careers.reap.global',
       updated_at = now()
 where slug = 'reap';
