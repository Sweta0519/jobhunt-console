// Where community questions come from, and the GitHub helpers the fetchers need.
//
// Ported from the visibility skill. The source list lives in code, not in the
// database: a stale saved copy silently masked a newly added source twice
// before, so there is deliberately no override layer.

export const UA = 'jobhunt-console (personal digest; github.com/Sweta0519)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const COMPANY_WEIGHT = {
  supabase: 10,
  clickhouse: 10,
  docker: 10,
  vercel: 10,
  n8n: 5,
  camunda: 5,
  stripe: 5,
  general: 0,
};

export const SOURCES = {
  ghDiscussions: [
    { owner: 'supabase', name: 'supabase', company: 'supabase', categoryId: 'MDE4OkRpc2N1c3Npb25DYXRlZ29yeTI5NjM4MjYz', category: 'Questions' },
    { owner: 'ClickHouse', name: 'ClickHouse', company: 'clickhouse', categoryId: 'MDE4OkRpc2N1c3Npb25DYXRlZ29yeTMzMDQxNzIz', category: 'Q&A' },
    { owner: 'docker', name: 'cli', company: 'docker', categoryId: 'DIC_kwDOBT74_c4CgjED', category: 'Q&A' },
    { owner: 'vercel', name: 'vercel', company: 'vercel', categoryId: 'MDE4OkRpc2N1c3Npb25DYXRlZ29yeTY2MTYw', category: 'Help' },
    // vercel/next.js Help is deliberately absent: a 50-item discussions query
    // times out server-side there, and its unanswered threads run weeks old.
    { owner: 'stripe', name: 'stripe-node', company: 'stripe', categoryId: 'DIC_kwDOACW3fM4C2Yat', category: 'Q&A' },
    { owner: 'stripe', name: 'stripe-cli', company: 'stripe', categoryId: 'MDE4OkRpc2N1c3Npb25DYXRlZ29yeTMyMDgwMTM2', category: 'Q&A' },
  ],
  ghIssues: [
    { repo: 'docker/compose', company: 'docker', label: 'kind/question' },
    { repo: 'docker/for-win', company: 'docker', label: 'kind/support' },
    { repo: 'docker/docs', company: 'docker', label: '' },
    { repo: 'supabase/supabase', company: 'supabase', label: '', bugTracker: true },
    { repo: 'ClickHouse/ClickHouse', company: 'clickhouse', label: '', bugTracker: true },
    { repo: 'n8n-io/n8n', company: 'n8n', label: '', bugTracker: true },
    // Camunda's docs repo, the same shape as docker/docs above: 582 open and
    // pushed daily, and a docs fix is the contribution that already landed at
    // Supabase. camunda/camunda itself is deliberately absent, being an
    // engineering monorepo of 2,830 mostly internal issues whose "good first
    // issue" label means a first issue for a new Camunda engineer, not an
    // outside one.
    { repo: 'camunda/camunda-docs', company: 'camunda', label: '' },
    // Of Stripe's public repos only the CLI is both hand-written and busy. The
    // server SDKs are generated from a private OpenAPI spec, require a CLA, and
    // took between zero and one new issue in the last thirty days.
    { repo: 'stripe/stripe-cli', company: 'stripe', label: '', bugTracker: true },
    // Work Supabase maintainers have explicitly opened to outsiders. These are
    // the issues they stage on their public Open Source Maintainers board,
    // which cannot be read directly without a read:project scope. Deliberately
    // narrow: 10, 3 and 2 open respectively, against 270 carrying
    // `external-issue`, which is almost every issue and therefore no signal.
    { repo: 'supabase/supabase', company: 'supabase', label: 'needs-analysis', invited: true },
    { repo: 'supabase/supabase', company: 'supabase', label: 'help wanted', invited: true },
    { repo: 'supabase/supabase', company: 'supabase', label: 'good first issue', invited: true },
  ],
  stackoverflow: [
    { tag: 'supabase', company: 'supabase' },
    { tag: 'clickhouse', company: 'clickhouse' },
    { tag: 'docker', company: 'docker', requireKeyword: true },
    { tag: 'n8n', company: 'n8n' },
    { tag: 'camunda', company: 'camunda' },
    { tag: 'vercel', company: 'vercel' },
    // `stripe-payments` is the live tag; a bare `stripe` tag returns nothing.
    // It is broad enough to need the keyword filter, the way `docker` does.
    { tag: 'stripe-payments', company: 'stripe', requireKeyword: true },
    { tag: 'postgresql', company: 'general', requireKeyword: true },
    { tag: 'oauth-2.0', company: 'general', requireKeyword: true },
    { tag: 'rest', company: 'general', requireKeyword: true },
  ],
  discourse: [
    { host: 'community.n8n.io', company: 'n8n', categories: [{ slug: 'questions', id: 12 }, { slug: 'help-me-build-my-workflow', id: 36 }] },
    { host: 'forum.camunda.io', company: 'camunda', categories: [{ slug: 'camunda-platform-8-topics', id: 40 }, { slug: 'camunda-platform-7-topics', id: 39 }, { slug: 'bpmn-modeling', id: 6 }] },
    { host: 'forums.docker.com', company: 'docker', categories: [{ slug: 'docker-desktop', id: 48 }, { slug: 'docker-engine', id: 22 }, { slug: 'general-discussions', id: 23 }, { slug: 'image-builds', id: 105 }] },
    { host: 'community.vercel.com', company: 'vercel', categories: [{ slug: 'help', id: 9 }] },
  ],
};

/** In Actions this is the workflow token; locally, GITHUB_TOKEN or `gh auth token`. */
export function githubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

export async function graphql(token, query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) {
    throw new Error(`graphql ${r.status}: ${(j.errors || []).map((e) => e.message).join('; ') || r.statusText}`);
  }
  return j.data;
}

export async function searchIssues(token, q) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=30`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (r.status === 403 || r.status === 429) {
    const reset = r.headers.get('x-ratelimit-reset');
    throw Object.assign(
      new Error(`rate limited (${r.status}), resets ${reset ? new Date(reset * 1000).toISOString() : '?'}`),
      { rateLimited: true }
    );
  }
  if (!r.ok) throw new Error(`search ${r.status} ${await r.text().catch(() => '')}`.slice(0, 200));
  return (await r.json()).items || [];
}
