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

Apply `supabase/migrations/0001_jobhunt_schema.sql`, then two things that are
easy to miss:

- **Settings → API → Exposed schemas**: add `jobhunt`. Without it every query
  returns 404.
- **Authentication → Providers**: disable new sign-ups. `auth.users` is shared
  with other apps in this project.

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
`NEXT_PUBLIC_SITE_URL` on Vercel.

**Do not put `SUPABASE_SERVICE_ROLE_KEY` on Vercel.** It bypasses row level
security across the whole project and the app has no operation that needs it.
It belongs only in GitHub Actions secrets and in `.env.local`.

### 5. Schedule

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Actions secrets. The
workflow commits a timestamp on each run, which keeps the schedule alive past
GitHub's 60-day inactivity cut-off for public repositories.

---

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
