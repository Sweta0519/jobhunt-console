import { UA } from '../sources.mjs';

export async function fetchStackOverflow(entry, { sinceUnix, key }) {
  const u = new URL('https://api.stackexchange.com/2.3/questions/no-answers');
  u.search = new URLSearchParams({ tagged: entry.tag, site: 'stackoverflow', sort: 'creation', order: 'desc', pagesize: '50', fromdate: String(sinceUnix), ...(key ? { key } : {}) }).toString();
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error_id) throw new Error(`stackexchange ${r.status} ${j.error_message || ''}`);
  const items = (j.items || []).map((q) => ({
    id: `so:${q.question_id}`, source: 'stackoverflow', site: `stackoverflow/${entry.tag}`, company: entry.company, requireKeyword: !!entry.requireKeyword,
    title: decode(q.title), url: q.link, excerpt: '', author: q.owner?.display_name || '', createdAt: new Date(q.creation_date * 1000).toISOString(),
    score: q.score || 0, comments: q.answer_count || 0, hasAnswer: !!q.is_answered, tags: q.tags || [],
  }));
  return { items, quota: { remaining: j.quota_remaining, max: j.quota_max }, backoff: j.backoff || 0 };
}
const decode = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
