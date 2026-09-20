// LinkedIn REST client for member posts (scope w_member_social). Docs: Microsoft Learn, Posts / Images / Documents API.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://api.linkedin.com';

export function makeClient({ token, apiVersion }) {
  const headers = (extra = {}) => ({
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
    ...extra,
  });

  async function call(method, path, body, { raw = false, headersOverride } = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { method, headers: headersOverride || headers(), body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const text = await res.text().catch(() => '');
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    const out = { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), json, text };
    if (!res.ok) { const err = new Error(`${method} ${path} -> ${res.status} ${json?.message || json?.code || text.slice(0, 300)}`); err.status = res.status; err.body = json || text; throw err; }
    return out;
  }

  return {
    async userinfo() { const r = await call('GET', '/v2/userinfo', undefined, { headersOverride: { Authorization: `Bearer ${token}` } }); return r.json; },

    async initImage(owner) { const r = await call('POST', '/rest/images?action=initializeUpload', { initializeUploadRequest: { owner } }); return r.json.value; },
    async initDocument(owner) { const r = await call('POST', '/rest/documents?action=initializeUpload', { initializeUploadRequest: { owner } }); return r.json.value; },
    async putBinary(uploadUrl, filePath) {
      const bytes = readFileSync(filePath);
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
      if (!res.ok) throw new Error(`upload ${basename(filePath)} -> ${res.status} ${await res.text().catch(() => '')}`);
      return res.status;
    },
    // May 403 with w_member_social-only tokens; callers treat null as "unknown".
    async mediaStatus(urn) {
      try { const r = await call('GET', `/rest/${urn.includes(':image:') ? 'images' : 'documents'}/${encodeURIComponent(urn)}`); return r.json?.status || null; }
      catch (e) { return e.status === 403 || e.status === 404 ? null : Promise.reject(e); }
    },

    // content: undefined | { media: { id, altText? , title? } } | { multiImage: { images: [...] } }
    async createPost({ author, commentary, visibility = 'PUBLIC', content }) {
      const body = { author, commentary, visibility, distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
      if (content) body.content = content;
      const r = await call('POST', '/rest/posts', body);
      const urn = r.headers['x-restli-id'] || r.headers['x-linkedin-id'] || '';
      return { urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '', status: r.status };
    },
    async deletePost(urn) { const r = await call('DELETE', `/rest/posts/${encodeURIComponent(urn)}`); return r.status; },
    // Comment on a post (Social Actions API). text is plain; LinkedIn auto-links URLs in comments.
    async createComment(postUrn, actor, text) {
      const r = await call('POST', `/rest/socialActions/${encodeURIComponent(postUrn)}/comments`, { actor, object: postUrn, message: { text } });
      return { urn: r.headers['x-restli-id'] || r.json?.['$URN'] || r.json?.commentUrn || '', status: r.status, json: r.json };
    },
  };
}

export const retryable = (e) => [409, 429, 500, 502, 503, 504].includes(e.status) || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
