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
It belongs only in GitHub Actions secrets and in `.env.local`.

### 5. Schedule

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Actions secrets. The
workflow commits a timestamp on each run, which keeps the schedule alive past
GitHub's 60-day inactivity cut-off for public repositories.

---

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
