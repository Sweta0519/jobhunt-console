# Jobhunt Console

A private console for running a job search: what to answer in target companies'
communities today, what goes out on LinkedIn, who is waiting on a reply, and the
record of public work to show when applying.

Built on Next.js, Supabase and GitHub Actions. **Running cost is zero** on the
free tiers.

The code is public. The data is not: the deployment sits behind a single login,
every table is protected by row level security, and nothing here is indexed.

---

## Why it is shaped like this

**Nothing runs on a laptop.** The scheduled work happens in GitHub Actions and
the state lives in Supabase, so posts publish and the question list refreshes
with the machine closed.

**The app never sends a LinkedIn message.** LinkedIn's official APIs do not
send connection requests or member-to-member messages at any partner tier, and
driving a browser session from a datacentre breaks their terms and risks the
account. So the console drafts, shows the text with a copy button and a link to
the conversation, and the message is sent by hand. Then it records that it went.

**"Approved" never reads as "sent".** One component prints status words, teal is
reserved for something that actually happened and has a link behind it, and
every badge carries a glyph as well as a colour.

**Approving a post is scheduling a publish**, so the button names the date and a
same-day approval asks first.

---

## Layout

```
app/                 Next.js console (server components; no data route handlers)
  actions.ts         every write, carried by the browser session so RLS applies
  lib/supabase.ts    cookie-bound client + requireOwner()
  lib/prompts.ts     handoff prompts for Claude Code
  components/ui.tsx  StatusBadge — the only place a status word is printed
workers/             scheduled jobs, plain Node, no dependencies
  questions.mjs      refreshes the community-question list
  lib/db.mjs         minimal PostgREST client over fetch
  lib/rank.mjs       question ranking (pure, tested)
scripts/import.mjs   one-time import from the local skills' JSON
supabase/migrations/ schema, grants and row level security
```

---

## Setup

### 1. Database

Use a Supabase project of its own. Sharing one with another app means that
app's users all get a valid session against this database, and then the only
thing standing between them and the data is `is_me()`.

Apply `supabase/migrations/0001_jobhunt_schema.sql`, then two things that are
easy to miss:

- **Settings → API → Exposed schemas**: add `jobhunt`. Without it every query
  returns 404.
- **Authentication → Providers**: disable new sign-ups.

Then record the owner:

```sql
insert into jobhunt.allowed_user (user_id)
select id from auth.users where email = 'you@example.com';
```

### 2. Local

```bash
cp .env.example .env.local     # fill in the four values
npm install
npm run dev
```

### 3. Import the existing data

```bash
npm run import:dry             # transform only, writes out/import-preview.json
node scripts/import.mjs        # upsert
```

### 4. Deploy

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`NEXT_PUBLIC_SITE_URL` on Vercel, and add the deployed origin to Supabase's
redirect allow list or the sign-in link bounces.

Turn **off** Vercel's own Deployment Protection. It is on by default for new
projects and would put the whole console behind a Vercel team login, on top of
the sign-in this app already has.

**Do not put `SUPABASE_SERVICE_ROLE_KEY` on Vercel.** It bypasses row level
security across the whole project and the app has no operation that needs it.
It belongs only in GitHub Actions secrets and in `.env.local`. Vercel's import
screen offers to create it for you, because it reads the key names out of
`.env.example`; remove that row before creating the project.

The Vercel project is connected to this repository, so a push to `main`
deploys itself. That connection is worth checking rather than assuming: while
it was missing, three commits sat on `main` for a day without ever reaching
the live site, and a deployment that silently does not happen looks exactly
like one that did.

### 5. Schedule

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Actions secrets. The
workflow commits a timestamp on each run, which keeps the schedule alive past
GitHub's 60-day inactivity cut-off for public repositories.

---

## Reconnecting LinkedIn

The access token lasts sixty days and cannot renew itself, so publishing stops
roughly every two months until it is replaced. Settings has a button that runs
the authorisation flow and stores the new token, and it works from a phone.

The token is written by `jobhunt.store_linkedin_token`, a security-definer
function. The alternative was giving the web app the service role key so it
could write to `secrets`, and that key bypasses row level security across the
whole project. This way the app can store a token and can never read one back,
which is verified: calling the function from a browser session succeeds, reading
the table from the same session is refused.

The client secret stays in a server-only environment variable and never reaches
the browser. The deployed callback URL must also be listed under Authorized
redirect URLs on the LinkedIn app, or the flow is rejected before it starts.

## Notifications

A bell in the top bar. Two severities, kept apart: **needs you** (a follow-up is
due, a token is expiring, someone replied) and **happened** (a pull request
merged). Only the first drives the count, so the badge always means there is
something to do rather than something occurred.

`workers/notify.mjs` watches what it can from the cloud: pull requests and
issues she opened, GitHub discussion comments she left, Discourse topics she
answered, plus her own state. Each row carries a `dedupe_key`, so the same reply
is announced once rather than every run.

LinkedIn is the exception. Its API does not expose message threads, and reading
comments on her own posts needs partner access. `scripts/linkedin-replies.mjs`
covers that from her PC against the browser she is already signed in on, reading
only the conversation list she can see anyway and never marking anything replied
on its own.

## Images

Two buckets, deliberately different.

**`logos` is public.** Company favicons are brand assets. A worker fetches each
one once and serves it from here, rather than hot-linking a favicon service that
would otherwise learn, on every page view, which companies are being tracked.

**`avatars` is private.** A person's photograph is not a brand asset, so these
are read through signed URLs that expire within the hour, and never sit on a
guessable address. They are fetched only for people with a live conversation
(nine today, not the 418 contacts), from the owner's own signed-in browser while
she is looking at that profile anyway, and `--prune` deletes a photo once the
conversation is skipped or closed. Everything falls back to an initials
monogram, so nothing is ever a broken image.

## Resume drafts

For each new role that scores 70 or more, `workers/resumes.mjs` drafts a tailored
resume from the master CV, for her to read, edit and save as a PDF. Nothing is
sent or submitted anywhere.

- **Runs** in `.github/workflows/resumes.yml`, started by pg_cron (migration
  0013) at 06:10 and 13:10 UTC, with a GitHub schedule as a second chance. A
  read-only token, no `npm ci`, and a pinned, checksum-verified Claude Code
  binary. It signs in with `CLAUDE_CODE_OAUTH_TOKEN` (made with
  `claude setup-token`, valid one year, a `resume_auth` bell appears when it
  stops working).
- **Claude has no tools** and answers in JSON with ids. Employers, titles, dates
  and contact details are copied from the master, never written by the model.
  Name and contact row are not sent at all.
- **Limits**: at most 5 drafts a day (`settings.resume_config.daily_cap`), and it
  stops at 85% usage, on overage, or at a usage limit (the rest stay queued).
  `resume_config.enabled = false` is the kill switch; no config means no work.
- **Logs are public**, so the worker prints job ids and counts only. A test
  runs the whole pipeline with canary strings and fails if one reaches the log.
- **Hers only**: the master CV, the posting text and the drafts have row level
  security for the primary owner. The second user sees nothing and the token
  never drafts for them.
- **Master CV** lives outside the repo. `node scripts/seed-master-cv.mjs --file
  "<path>" --dry-run` shows what would be stored; without `--dry-run` it stores
  the next version. `node scripts/check-no-cv-leak.mjs --file "<path>"` counts
  CV strings in tracked files, or in a downloaded run log with `--log`.
- **PDF**: the review page opens `/resumes/<id>/print`, a print stylesheet in
  Carlito (same metrics as Calibri); the browser saves the PDF. Nothing is
  stored.

## Application answers

For each role that has a ready resume draft, `workers/applications.mjs` reads the
application form and drafts answers and, when the form asks for one, a cover
letter, for her to read, edit and copy. Nothing is submitted. She submits on the
employer's site herself, and `setJobStatus` still records "applied".

- **Tabs**: `/resumes/<id>?tab=application` shows the questions in form order,
  each with a badge, the text or the chosen option, Edit and Copy. The cover
  letter has its own card and a PDF at `/resumes/<id>/cover`. `/resumes/answers`
  holds her saved answers.
- **Rules first, model second.** `workers/lib/apply/classify.mjs` decides what it
  can without Claude: demographic, consent and sensitive questions are left blank
  for her, an AI-use question and anything about how long she used something need
  her, personal facts map to a saved-answer key, and a work-rights question is
  mapped only for Germany and the EU. Only the rest goes to Claude, which has no
  tools, answers with ids, and cites the CV items it used.
- **Saved answers never reach a worker.** The `answer_bank` table has no grant for
  the service role (migration 0017 revokes it on purpose). A draft stores a key
  such as `notice_period`; the page joins the value in, in her own session.
  Values are plain text under row level security. Salary is one free text value
  (a range with a currency is fine) and can be edited per job. "Fill from my CV"
  fills empty inputs only and saves nothing until she presses Save.
- **Fact check**: `workers/lib/apply/answer-facts.mjs` rejects an added number,
  date, link, contact detail, tool the CV does not name, or a first-person claim
  taken from the posting. One bad answer never loses the others: it becomes a
  question for her. Her own edits get warnings only.
- **English only** for now, also on German forms.
- **Forms** are read from the Greenhouse, Ashby and Lever public pages, on fixed
  hosts, with no redirects and a size cap (Lever also checks `robots.txt` and keeps
  a 1.1 second gap). Anything else, a failed read or a form that may be incomplete
  is handled by pasting the questions: one per line, choices below with `- `, a
  trailing `*` for required. Pasting more later adds to the form. The Ashby field
  shape and the Lever page markup were built from fixtures, not checked against
  live pages, so a first dry run per source is part of going live.
- **Runs** in `.github/workflows/applications.yml`, started by pg_cron (migration
  0017) every 15 minutes but only when something is waiting, with a GitHub
  schedule as a second chance. Two jobs on two machines: `plan` reads forms and
  has the database key, `draft` has the database key and the Claude token. There
  is no job input, because Actions prints a step's `env` block.
- **Config**: `settings.application_config`. No row, or `enabled: false`, means no
  work.

  ```json
  { "enabled": true, "daily_cap": 5, "hard_cap": 12, "stop_at_utilization": 0.70,
    "model": "sonnet", "sources": { "greenhouse": true, "ashby": true, "lever": true } }
  ```

  `daily_cap` counts drafts attempted today. A cover letter or redraft she asks
  for jumps the queue but counts against `hard_cap`. Drafting stops at 70% usage,
  below the resume worker's 85%, so resumes keep priority. A source set to `false`
  sends its forms to paste with no deploy.
- **Leak scan**: `node scripts/check-no-cv-leak.mjs --private-strings <file>` and
  `--drafts` print counts only, against tracked files or a downloaded log.
- **Not built yet**: a headless browser reader for other employers' forms.
  `browser_mode` in the config is reserved and ignored.

## Checks

```bash
npm test                                   # ranking and import transforms
node workers/questions.mjs --dry-run       # hits the live sources, writes nothing
```

The security check that matters, given the database holds other people's names:

```bash
curl -s "$SUPABASE_URL/rest/v1/outreach?select=id" \
  -H "apikey: $ANON_KEY" -H "Accept-Profile: jobhunt"
# must return []
```
