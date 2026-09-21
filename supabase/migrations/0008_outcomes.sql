-- Application outcomes.
--
-- A job row knew when she applied and nothing after. Five months of inbox
-- showed the rest: which applications were rejected, which reached an
-- interview, and when. Those live here, next to the application, so the Jobs
-- tab can say "interviewed, then rejected 27 Aug" instead of "Applied" forever.
--
-- `outcome_source` records where the fact came from (gmail, manual) so a
-- later inbox scan can refresh gmail-sourced outcomes without touching ones
-- she typed herself.

alter table jobhunt.jobs add column if not exists outcome_at     date;
alter table jobhunt.jobs add column if not exists outcome_note   text;
alter table jobhunt.jobs add column if not exists outcome_source text;
alter table jobhunt.jobs add column if not exists interviewed    boolean not null default false;

-- She may record or correct an outcome from the browser; the existing column
-- grant on jobs did not cover these, and a grant is additive.
grant update (outcome_at, outcome_note, outcome_source, interviewed) on jobhunt.jobs to authenticated;
grant all on jobhunt.jobs to service_role;
