import { searchIssues } from '../sources.mjs';

export async function fetchIssues(token, entry, { sinceDate }) {
  // An issue a maintainer has explicitly opened to outside help does not go
  // stale the way a support question does, and it often already carries a
  // comment or two, so neither the date window nor the zero-comment gate
  // applies to it. supabase#34526 sat eighteen months labelled needs-analysis
  // and both gates would have kept it out of the queue forever.
  const gates = entry.invited ? 'comments:<6' : `comments:0 created:>${sinceDate}`;
  const q = `repo:${entry.repo} is:issue is:open ${gates}${entry.label ? ` label:"${entry.label}"` : ''}`;
  const items = await searchIssues(token, q);
  return items.map((it) => ({
    id: `gh-issue:${entry.repo}#${it.number}`, source: 'gh-issue', site: `${entry.repo} Issues`, company: entry.company, bugTracker: !!entry.bugTracker,
    title: it.title, url: it.html_url, excerpt: (it.body || '').replace(/\s+/g, ' ').trim().slice(0, 200), author: it.user?.login || '',
    createdAt: it.created_at, score: it.reactions?.total_count || 0, comments: it.comments || 0, hasAnswer: false, tags: (it.labels || []).map((l) => l.name),
  }));
}
