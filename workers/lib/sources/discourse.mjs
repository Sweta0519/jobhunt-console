import { UA, sleep } from '../sources.mjs';

export async function fetchDiscourse(entry, { since }) {
  const out = [];
  for (const cat of entry.categories) {
    const url = `https://${entry.host}/c/${cat.slug}/${cat.id}/l/latest.json?order=created`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${entry.host} ${cat.slug} -> ${r.status}`);
    const j = await r.json();
    for (const t of j.topic_list?.topics || []) {
      if (t.pinned || /^about the .* category/i.test(t.title)) continue;
      if (new Date(t.created_at) < since) continue;
      out.push({ id: `dc:${entry.host}/${t.id}`, source: 'discourse', site: `${entry.host}/${cat.slug}`, company: entry.company, title: t.title, url: `https://${entry.host}/t/${t.slug}/${t.id}`, excerpt: (t.excerpt || '').replace(/\s+/g, ' ').slice(0, 200), author: '', createdAt: t.created_at, score: Math.min(5, Math.round((t.views || 0) / 60)), comments: Math.max(0, (t.posts_count || 1) - 1), hasAnswer: !!t.has_accepted_answer, tags: (t.tags || []).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean) });
    }
    await sleep(800);
  }
  return { items: out };
}
