import { searchIssues } from '../sources.mjs';

export async function fetchIssues(token, entry, { sinceDate }) {
  const q = `repo:${entry.repo} is:issue is:open comments:0 created:>${sinceDate}${entry.label ? ` label:"${entry.label}"` : ''}`;
  const items = await searchIssues(token, q);
  return items.map((it) => ({
    id: `gh-issue:${entry.repo}#${it.number}`, source: 'gh-issue', site: `${entry.repo} Issues`, company: entry.company, bugTracker: !!entry.bugTracker,
    title: it.title, url: it.html_url, excerpt: (it.body || '').replace(/\s+/g, ' ').trim().slice(0, 200), author: it.user?.login || '',
    createdAt: it.created_at, score: it.reactions?.total_count || 0, comments: it.comments || 0, hasAnswer: false, tags: (it.labels || []).map((l) => l.name),
  }));
}
