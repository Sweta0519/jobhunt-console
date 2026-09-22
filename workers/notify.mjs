#!/usr/bin/env node
// Builds the notification list: replies to her public work, and anything
// waiting on her.
//
//   node workers/notify.mjs [--dry-run]
//
// What can be watched from the cloud:
//   * GitHub pull requests and issues she opened  (state, new comments)
//   * GitHub discussion comments she posted       (replies after hers)
//   * Discourse topics she answered               (posts after hers)
//   * Her own console state                       (follow-ups, token, failures)
//
// What cannot: LinkedIn. Replies to a message need her signed-in browser, and
// comments on her posts need partner API access she does not have. Those come
// from `scripts/linkedin-replies.mjs` on her PC instead.

import { select, upsert, updateEach, startRun, parseArgs } from './lib/db.mjs';
import { UA, githubToken, graphql, sleep } from './lib/sources.mjs';

const out = [];
const add = (n) => out.push(n);

/** A pull request or issue she opened, or a comment she left on one. */
async function checkGitHubThread(c, token) {
  const m = c.url.match(/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
  if (!m) return null;
  const [, owner, repo, , number] = m;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!r.ok) return null;
  const issue = await r.json();

  const state = issue.pull_request?.merged_at ? 'merged' : issue.state;
  const comments = issue.comments ?? 0;
  const label = `${owner}/${repo}#${number}`;

  if (state !== c.state && (state === 'merged' || state === 'closed')) {
    add({
      kind: state === 'merged' ? 'pr_merged' : 'pr_closed',
      severity: 'news',
      title: state === 'merged' ? `Merged: ${label}` : `Closed: ${label}`,
      body: issue.title,
      url: issue.html_url,
      entity_ref: c.source_ref || c.url,
      dedupe_key: `${state}:${label}`,
    });
  }
  if (c.last_seen_count != null && comments > c.last_seen_count) {
    // The count alone cannot tell her reply from someone else's. Her own two
    // comments on vercel/vercel#17605 rang the bell as "new reply", so look at
    // who wrote the new ones and stay quiet if it was only her.
    const fresh = await newCommentsBy(owner, repo, number, comments - c.last_seen_count, token);
    if (fresh.some((login) => login !== ME)) {
      add({
        kind: 'pr_comment',
        severity: 'action',
        title: `New reply on ${label}`,
        body: issue.title,
        url: issue.html_url,
        entity_ref: c.source_ref || c.url,
        dedupe_key: `comment:${label}:${comments}`,
      });
    }
  }
  return { id: c.id, state, last_seen_count: comments, last_checked_at: new Date().toISOString() };
}

/** Her GitHub login; anything she writes herself is not news to her. */
const ME = 'Sweta0519';

/** Logins of the newest `n` comments on an issue or pull request. */
async function newCommentsBy(owner, repo, number, n, token) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=${Math.min(100, Math.max(1, n))}&sort=created&direction=desc`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  );
  if (!r.ok) return ['unknown']; // fail open: better one spurious bell than a missed reply
  const list = await r.json();
  return list.slice(0, n).map((x) => x.user?.login || 'unknown');
}

/** A discussion comment she posted; watch for replies after hers. */
async function checkDiscussion(c, token) {
  const m = c.url.match(/github\.com\/([^/]+)\/([^/]+)\/discussions\/(\d+)/);
  if (!m || !token) return null;
  const [, owner, repo, number] = m;
  // The newest few comments come back with their authors, so a rise in the
  // count that is only her own answer does not ring the bell.
  const q = `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){discussion(number:$n){title url comments(last:5){totalCount nodes{author{login}}}}}}`;
  let d;
  try {
    d = await graphql(token, q, { owner, repo, n: Number(number) });
  } catch {
    return null;
  }
  const disc = d?.repository?.discussion;
  if (!disc) return null;
  const count = disc.comments?.totalCount ?? 0;
  const label = `${owner}/${repo} discussion #${number}`;
  const newest = (disc.comments?.nodes || []).slice(-(Math.max(0, count - (c.last_seen_count ?? count))));
  const someoneElse = newest.length === 0 ? true : newest.some((x) => (x.author?.login || 'unknown') !== ME);

  if (c.last_seen_count != null && count > c.last_seen_count && someoneElse) {
    add({
      kind: 'answer_reply',
      severity: 'action',
      title: `New reply on ${label}`,
      body: disc.title,
      url: disc.url,
      entity_ref: c.source_ref || c.url,
      dedupe_key: `disc:${label}:${count}`,
    });
  }
  return { id: c.id, last_seen_count: count, last_checked_at: new Date().toISOString() };
}

/** A Discourse topic she answered; watch the reply count. */
async function checkDiscourse(c) {
  const m = c.url.match(/^https:\/\/([^/]+)\/t\/[^/]+\/(\d+)/);
  if (!m) return null;
  const [, host, topicId] = m;
  const r = await fetch(`https://${host}/t/${topicId}.json`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const t = await r.json();
  const count = t.posts_count ?? 0;

  if (c.last_seen_count != null && count > c.last_seen_count) {
    add({
      kind: 'answer_reply',
      severity: 'action',
      title: `New reply on ${host}`,
      body: t.title,
      url: c.url,
      entity_ref: c.source_ref || c.url,
      dedupe_key: `dc:${host}/${topicId}:${count}`,
    });
  }
  return { id: c.id, last_seen_count: count, last_checked_at: new Date().toISOString() };
}

/** Her own state: nothing external, but it is what actually needs doing. */
async function checkInternal() {
  const today = new Date().toISOString().slice(0, 10);
  const [outreach, posts, token, runs] = await Promise.all([
    select('outreach', '?select=id,person_name,status,followup_due_at&status=in.(sent,accepted)&replied_at=is.null'),
    select('posts', '?select=id,title,status,post_date,last_error&status=eq.failed'),
    select('settings', "?select=value&key=eq.linkedin_token_status"),
    select('runs', '?select=worker,ok,error,finished_at&order=started_at.desc&limit=6'),
  ]);

  for (const o of outreach || []) {
    if (!o.followup_due_at || o.followup_due_at > new Date().toISOString()) continue;
    add({
      kind: 'followup_due',
      severity: 'action',
      title: `Follow up with ${o.person_name}`,
      body: 'Sent, no reply yet.',
      url: '/outreach',
      entity_ref: o.id,
      // One reminder per person per day, not one per run.
      dedupe_key: `followup:${o.id}:${today}`,
    });
  }

  for (const p of posts || []) {
    add({
      kind: 'post_failed',
      severity: 'action',
      title: `Post failed to publish`,
      body: p.last_error || p.title || p.id,
      url: '/posts',
      entity_ref: p.id,
      dedupe_key: `postfail:${p.id}:${today}`,
    });
  }

  const expires = token?.[0]?.value?.expires_at;
  if (expires) {
    const days = Math.floor((new Date(expires).getTime() - Date.now()) / 86_400_000);
    if (days <= 7) {
      add({
        kind: 'token_expiring',
        severity: 'action',
        title: `LinkedIn access expires in ${days} day${days === 1 ? '' : 's'}`,
        body: 'Posts stop publishing when it lapses.',
        url: '/settings',
        entity_ref: 'linkedin_token',
        dedupe_key: `token:${expires.slice(0, 10)}`,
      });
    }
  }

  // The publish worker can only post what exists. Better to hear on Sunday that
  // the week is empty than to watch it find nothing four mornings running.
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = await select(
    'posts',
    `?select=post_date,status&post_date=gte.${today}&post_date=lte.${horizon}&status=in.(draft,approved,rendered)`
  );
  const covered = new Set((upcoming || []).map((p) => p.post_date));
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // weekdays only, as the cadence is
    const iso = d.toISOString().slice(0, 10);
    if (!covered.has(iso)) gaps.push(iso);
  }
  if (gaps.length) {
    add({
      kind: 'pipeline_gap',
      severity: 'action',
      title: `${gaps.length} weekday${gaps.length === 1 ? '' : 's'} with no post`,
      body: `Nothing scheduled for ${gaps.map((g) => g.slice(5)).join(', ')}. Drafting happens in Claude Code.`,
      url: '/posts',
      entity_ref: 'pipeline',
      // Once a day, and again only if the gaps change.
      dedupe_key: `pipeline:${today}:${gaps.join(',')}`,
    });
  }

  for (const r of runs || []) {
    if (r.ok !== false) continue;
    add({
      kind: 'run_failed',
      severity: 'action',
      title: `The ${r.worker} job failed`,
      body: String(r.error || '').slice(0, 200),
      url: '/',
      entity_ref: r.worker,
      dedupe_key: `run:${r.worker}:${(r.finished_at || today).slice(0, 13)}`,
    });
  }
}

async function main() {
  const args = parseArgs();
  const finish = args['dry-run'] ? async () => {} : await startRun('notify');
  const token = githubToken();

  const contributions = await select(
    'contributions',
    '?select=id,kind,url,source_ref,title,state,last_seen_count&order=happened_at.desc&limit=100'
  );

  const updates = [];
  for (const c of contributions || []) {
    let u = null;
    if (/github\.com\/[^/]+\/[^/]+\/discussions\//.test(c.url)) u = await checkDiscussion(c, token);
    else if (/github\.com\//.test(c.url)) u = await checkGitHubThread(c, token);
    else if (/^https:\/\/[^/]+\/t\//.test(c.url)) u = await checkDiscourse(c);
    // LinkedIn post URLs are skipped: comments need partner API access.
    if (u) updates.push(u);
    await sleep(400);
  }

  await checkInternal();

  if (args['dry-run']) {
    console.log(`${out.length} notification(s) would be raised:`);
    for (const n of out) console.log(`  [${n.severity}] ${n.title}${n.body ? ` — ${n.body.slice(0, 60)}` : ''}`);
    return;
  }

  if (updates.length) await updateEach('contributions', 'id', updates);
  // The unique index on dedupe_key makes re-running harmless.
  if (out.length) await upsert('notifications', out, { onConflict: 'dedupe_key' });

  const unread = await select('notifications', '?select=id&read_at=is.null');
  await finish(true, { raised: out.length, unread: unread?.length ?? 0, watched: updates.length });
  console.log(`raised ${out.length}, watching ${updates.length} thread(s), ${unread?.length ?? 0} unread`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 150))
  .catch((e) => {
    console.error(e.message);
    setTimeout(() => process.exit(1), 150);
  });
