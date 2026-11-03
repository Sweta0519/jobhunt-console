-- Link to the employer's own careers page instead of the board. jobs.url stays the
-- board link (dedupe and description resolving read it); careers_url is display only,
-- written by the poll from companies.careers_url_template ({slug} = slugified title).
-- The browser keeps select (table-level grant, so select * still works) and gets no
-- update grant on either column: the existing column-level update grants do not cover them.
alter table jobhunt.companies add column if not exists careers_url_template text;
alter table jobhunt.jobs      add column if not exists careers_url          text;
