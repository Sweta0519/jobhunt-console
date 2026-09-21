-- Hands-on preparation, per company she has applied to.
--
-- Three applications to ClickHouse sat next to zero hands-on and zero public
-- work there, while the Supabase hands-on was deep and recorded nowhere: the
-- console itself is a Supabase project. This table makes both visible and
-- gives each company a short list of drills, calibrated to what the postings
-- she applied to actually ask for and to what a support engineer's interview
-- loop actually tests: diagnose one realistic ticket live, write the reply.
--
-- `level` says what a drill is for:
--   1  know it     run the thing, see the moving parts
--   2  ticket      reproduce a realistic failure, diagnose with the tool's own
--                  diagnostics, write the customer-facing reply
--   3  public      turn it into an artifact with a URL, or a story with evidence
--
-- The drills are seeded here, in code, for the same reason the question
-- sources are: a saved copy can silently mask a newer default. Her progress
-- (status, evidence, note) is hers and is preserved on re-run.

create table if not exists jobhunt.prep (
  id            text primary key,
  owner         uuid not null default jobhunt.owner_id(),
  company_slug  text not null,
  seq           int not null,
  level         int not null check (level between 1 and 3),
  title         text not null,
  why           text not null,     -- the line in the posting or the interview shape this answers
  how           text not null,     -- concrete steps, enough to start without looking anything up
  status        text not null default 'todo' check (status in ('todo', 'doing', 'done', 'skipped')),
  evidence_url  text,
  note          text,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists prep_company_idx on jobhunt.prep (company_slug, seq);

alter table jobhunt.prep enable row level security;
alter table jobhunt.prep force row level security;

drop policy if exists prep_select on jobhunt.prep;
create policy prep_select on jobhunt.prep for select to authenticated
  using (owner = auth.uid() and (select jobhunt.is_me()));

drop policy if exists prep_update on jobhunt.prep;
create policy prep_update on jobhunt.prep for update to authenticated
  using (owner = auth.uid() and (select jobhunt.is_me()))
  with check (owner = auth.uid() and (select jobhunt.is_me()));

-- She records progress; the drill text itself is not hers to rewrite from the
-- browser, so the column grant stops at the progress columns.
revoke all on jobhunt.prep from anon, authenticated;
grant select on jobhunt.prep to authenticated;
grant update (status, evidence_url, note, done_at, updated_at) on jobhunt.prep to authenticated;
grant all on jobhunt.prep to service_role;

-- ---------------------------------------------------------------------------
-- Seed. `on conflict` updates only the drill text, never her progress.
-- ---------------------------------------------------------------------------

insert into jobhunt.prep (id, company_slug, seq, level, title, why, how) values

-- ClickHouse: Technical Customer Support Engineer, EMEA (posting fd8daa96).
-- It wants breadth in ClickHouse OSS or Cloud, SQL, OLAP and distributed
-- systems, 24x7 coverage, and writing for docs, knowledge base, blogs and
-- webinars; OSS community contribution is a bonus. The AI Infrastructure &
-- Observability posting is open and eligible but was not applied to, so
-- nothing here is calibrated to it.
('ch-01', 'clickhouse', 1, 1,
 'Run ClickHouse in Docker and load a real dataset into a MergeTree table you designed',
 'The posting asks for depth in ClickHouse open-source or Cloud, or in SQL databases and OLAP. Applications in, none of this yet.',
 'docker run -d --name ch -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server. Load the UK property prices or NYC taxi sample from the docs. Create the MergeTree table yourself and write one sentence on why you chose that ORDER BY. Evidence: the DDL and one query, in a gist.'),

('ch-02', 'clickhouse', 2, 1,
 'Watch parts, merges and the write path happen',
 'Almost every insert-related ticket is about parts. You cannot explain them until you have watched them appear.',
 'Insert in many small batches and watch system.parts grow. Watch system.merges while it merges. Run OPTIMIZE TABLE ... FINAL and look again. Note what changed in the parts count and on disk.'),

('ch-03', 'clickhouse', 3, 2,
 'Ticket: "Too many parts"',
 'The most common ClickHouse support ticket. A live-troubleshoot round is likely to be this or one of the next two.',
 'Reproduce it (lower parts_to_throw_insert or hammer with single-row inserts). Diagnose with system.parts and system.part_log. Write the customer reply: cause in one line, the query that proves it, the fix (batch inserts, async_insert, or a Buffer table) and when to pick which.'),

('ch-04', 'clickhouse', 4, 2,
 'Ticket: "Memory limit (for query) exceeded"',
 'Second most common ticket, and it tests whether you understand where memory goes in a GROUP BY.',
 'Reproduce with a high-cardinality GROUP BY under a low max_memory_usage. Read the failure in system.query_log. Write the reply covering max_memory_usage, max_bytes_before_external_group_by, and when the real answer is a better ORDER BY or a projection.'),

('ch-05', 'clickhouse', 5, 2,
 'Ticket: "This query is slow"',
 'Tests the diagnostic sequence, not the answer: what you look at first, and what you rule out.',
 'Take a slow query against your dataset. EXPLAIN, then EXPLAIN PIPELINE. Read read_rows and read_bytes in system.query_log. Show the difference a matching ORDER BY or a data-skipping index makes. Write the reply as you would to a customer.'),

('ch-06', 'clickhouse', 6, 1,
 'Ingest from a stream: Kafka engine table plus a materialized view',
 'Bonus points in the posting: "data pipelines such as Kafka, Kinesis, Spark, RabbitMQ". Kafka is the one ClickHouse has a table engine for, so it is the one customers ask about.',
 'Use the ClickHouse and Kafka docker quickstart. Kafka engine table, materialized view into a MergeTree target. Break it once (bad message, wrong format) and find where the error surfaces in system.kafka_consumers and the server log.'),

('ch-11', 'clickhouse', 11, 2,
 'Ticket: a replica is read-only, or "Keeper session expired"',
 'The general posting lists distributed systems alongside SQL and OLAP, and a two-node replicated setup is where most distributed tickets come from.',
 'Docker compose with two ClickHouse nodes and one ClickHouse Keeper. Create a ReplicatedMergeTree table, insert on one node, read on the other. Stop Keeper and watch inserts fail with the read-only error; check system.replicas and system.zookeeper. Write the reply for a customer whose writes suddenly fail after a Keeper restart.'),

('ch-08', 'clickhouse', 8, 1,
 'ClickHouse Cloud trial: connect, and note what differs from open source',
 'The posting says "ClickHouse Cloud and ClickHouse open-source". Customers will ask why something works locally and not in Cloud.',
 'Start the free trial. Connect with clickhouse-client and the SQL console. Note the differences you hit: SharedMergeTree, no ON CLUSTER, settings you cannot change, how backups work.'),

('ch-09', 'clickhouse', 9, 3,
 'Answer one ClickHouse issue or discussion with a diagnosis you actually ran',
 'The posting names community support as part of the job and lists "experience with OSS ... as a community member or contributor" as a bonus. You have zero public artifacts at ClickHouse against three applications.',
 'Take a question from the Today queue that matches something you reproduced in ch-03 to ch-05. Answer it with the query that proves the cause. Record the link.'),

('ch-10', 'clickhouse', 10, 3,
 'Write one knowledge-base article from a ticket drill, in customer voice',
 'The posting asks you to "develop solutions ... shared via documentation, knowledge base, blogs". Show you can already do it.',
 'Pick ch-03, ch-04 or ch-05. Write it as a KB article: symptom, cause, how to confirm, fix, prevention. Publish it in your support-engineering-notes repo. Record the link.'),

-- Supabase: Support Engineer (EMEA)
('sb-01', 'supabase', 1, 3,
 'Write up the RLS story from the console as an interview answer',
 'The posting wants complex SQL, ideally Postgres, DBA experience a plus. You built it: is_me() as an InitPlan, force row level security, column-level grants as the real write lock, a secrets table granted to nobody.',
 'Write it as you would say it in ten minutes, with the migration as evidence. Include the one thing that would have gone wrong without security_invoker on views, and how you verified with the anon key that every table refused.'),

('sb-02', 'supabase', 2, 3,
 'Write up the pg_cron and pg_net story, including the pg_net-in-public near miss',
 'Extensions, scheduling and a real security catch, on their own product. Nobody else in the loop will have this story.',
 'Cover why Postgres became the clock, how the dispatch is recorded, and the moment pg_net installed into public, which PostgREST exposes. Evidence: migration 0006.'),

('sb-03', 'supabase', 3, 1,
 'Self-host Supabase with docker compose, and hit the PG_META_CRYPTO_KEY mismatch you analysed',
 'Self-hosted is a large share of GitHub issues and most of the Open Source Maintainers board. You already know this failure from the outside; now see it from the inside.',
 'Follow DEVELOPERS.md. Run Studio outside Docker and confirm it cannot read the database. Fix it with .env.local. Then break something else on purpose and find it in the container logs.'),

('sb-04', 'supabase', 4, 2,
 'Ticket: "prepared statement does not exist" through the pooler',
 'The pooler is one of the biggest ticket classes, and it extends your #50573 answer on what pg_stat_ssl shows behind Supavisor.',
 'Connect in session mode and in transaction mode. Show what breaks in transaction mode: prepared statements, SET, LISTEN. Write the reply for a customer whose ORM fails on port 6543 but works on 5432.'),

('sb-05', 'supabase', 5, 2,
 'Ticket: "the magic link never arrives"',
 'Auth is the largest Discussions category, and you lived this exact one today.',
 'Reproduce against a test project: the built-in mailer, two sends an hour, the sixty-second smtp_max_frequency, the misleading error. Write the reply explaining what the customer is seeing and the two real fixes: custom SMTP, or a different sign-in method.'),

('sb-06', 'supabase', 6, 1,
 'Supabase CLI end to end: init, start, a migration, db diff, db push',
 'Linux and command line are in the posting, and CLI and config.toml questions are what your docs PR #50594 came from.',
 'supabase init and start locally. Write one migration by hand, one by db diff. Push to a throwaway hosted project and read what config push actually changed, which is what your PR documents.'),

('sb-07', 'supabase', 7, 2,
 'EXPLAIN ANALYZE the slowest query in your own schema and fix it with an index',
 '"Comfortable with complex SQL queries" is tested by showing your reasoning on a plan, not by recall.',
 'Find the slowest query the console runs. EXPLAIN ANALYZE before and after adding the right index. Add one window-function query you can explain. Keep both plans as evidence.'),

('sb-08', 'supabase', 8, 1,
 'Edge Functions and Realtime, once each, with the CLI',
 'Two product areas with no story yet. You already probed x-region routing at the gateway; now deploy something behind it.',
 'Deploy one edge function locally with supabase functions serve, invoke it, read its logs. Subscribe to a Realtime channel on a table that has RLS and confirm the policy applies to the stream.'),

('sb-09', 'supabase', 9, 3,
 'Tighten your three best Supabase answers into a written-communication pack',
 'Supabase evaluates written communication at every step of the loop. These are the samples.',
 'Pick the three strongest: the pooler TLS answer, the x-region reproduction, the config push PR. Check each has the answer-guide shape: cause, the check that proves it, the fix, one docs link. Keep the links together.'),

-- Docker: Senior Implementation Engineer (EMEA)
('dk-01', 'docker', 1, 1,
 'Docker Business trial: create an org, teams, members and roles',
 'This is an onboarding and provisioning role, not troubleshooting. Provisioning an org is the daily work.',
 'Start a Docker Business trial. Create the org, two teams, invite a second account, assign roles. Note every step a customer could get stuck on.'),

('dk-02', 'docker', 2, 1,
 'SSO with SAML or OIDC, then SCIM provisioning',
 'SSO and SCIM are the classic onboarding blockers, and the posting asks for smooth transitions between onboarding and support.',
 'Use a free identity provider tier. Verify the domain, connect SSO, enforce it, then turn on SCIM and watch a user provision. Write down the domain-verification step, since that is where customers stall.'),

('dk-03', 'docker', 3, 1,
 'Registry Access Management, Image Access Management and Settings Management',
 'Enterprise rollout questions: what can the admin lock down, and what does the developer then see.',
 'Enable Registry Access Management and try to pull from a blocked registry. Set Image Access Management. Deploy an admin-settings.json to Docker Desktop and confirm which settings became locked.'),

('dk-04', 'docker', 4, 2,
 'Ticket: "Docker Desktop cannot sign in behind our proxy"',
 'The onboarding failure that turns into a support ticket on day one.',
 'Run a local proxy (mitmproxy or squid). Point Docker Desktop at it and make sign-in fail, then make it work: proxy settings, certificate trust. Write the reply as the onboarding engineer, not the support engineer.'),

('dk-05', 'docker', 5, 2,
 'Ticket: two Compose services cannot reach each other by name',
 'The forum thread class you already answer, done as a repeatable diagnosis.',
 'Compose file with two services, break the network deliberately (different networks, wrong service name, a port clash). Diagnose with docker network inspect and docker compose logs. Write the reply.'),

('dk-06', 'docker', 6, 3,
 'Write the runbook: roll Docker Business out to a fifty-seat organisation in one week',
 'The posting asks you to contribute to the team knowledge base and to automate onboarding. A runbook is the artifact that proves both.',
 'Order the steps from dk-01 to dk-03, add the checks between them and where each customer usually stalls. Publish it in your support-engineering-notes repo. Record the link.')

on conflict (id) do update
  set title = excluded.title,
      why   = excluded.why,
      how   = excluded.how,
      level = excluded.level,
      seq   = excluded.seq;

-- Drills withdrawn from the seed. The upsert above cannot remove a row, so a
-- drill that no longer belongs is deleted here by id; otherwise the database
-- would keep showing work the plan no longer asks for. ch-07 was a Langfuse
-- exercise for an AI Infrastructure application that was never made.
delete from jobhunt.prep where id in ('ch-07') and status in ('todo', 'skipped');
