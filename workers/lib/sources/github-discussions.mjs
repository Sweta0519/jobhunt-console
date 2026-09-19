import { graphql } from '../sources.mjs';

const Q = `query($owner:String!, $name:String!, $cat:ID, $after:String) {
  repository(owner:$owner, name:$name) {
    discussions(first:50, after:$after, categoryId:$cat, answered:false, orderBy:{field:CREATED_AT, direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { number title url createdAt upvoteCount category { name } answer { id } comments { totalCount } author { login } body }
    }
  }
  rateLimit { remaining resetAt }
}`;
const CATS = `query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { discussionCategories(first:25) { nodes { id name isAnswerable } } } }`;

export async function fetchDiscussions(token, entry, { since }) {
  let cat = entry.categoryId;
  if (!cat) {
    const d = await graphql(token, CATS, { owner: entry.owner, name: entry.name });
    const found = d.repository?.discussionCategories?.nodes?.find((c) => c.name === entry.category) || d.repository?.discussionCategories?.nodes?.find((c) => c.isAnswerable);
    if (!found) return { items: [], note: 'no answerable category' };
    cat = found.id; entry.categoryId = cat; // caller may persist
  }
  const out = [];
  let after = null, remaining = null;
  for (let page = 0; page < 3; page++) {
    const d = await graphql(token, Q, { owner: entry.owner, name: entry.name, cat, after });
    remaining = d.rateLimit?.remaining;
    const nodes = d.repository?.discussions?.nodes || [];
    for (const n of nodes) {
      if (new Date(n.createdAt) < since) return { items: out, remaining };
      out.push({ id: `gh-disc:${entry.owner}/${entry.name}#${n.number}`, source: 'gh-discussion', site: `${entry.owner}/${entry.name} Discussions`, company: entry.company, title: n.title, url: n.url, excerpt: (n.body || '').replace(/\s+/g, ' ').trim().slice(0, 200), author: n.author?.login || '', createdAt: n.createdAt, score: n.upvoteCount || 0, comments: n.comments?.totalCount || 0, hasAnswer: !!n.answer, tags: [n.category?.name].filter(Boolean) });
    }
    if (!d.repository?.discussions?.pageInfo?.hasNextPage) break;
    after = d.repository.discussions.pageInfo.endCursor;
  }
  return { items: out, remaining };
}
