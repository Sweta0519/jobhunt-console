// Public job boards, each normalised to one shape:
//   { nativeId, title, url, location, description, fullText, html, postedAt }
// `html` is the raw posting markup, kept only so a probe can see who the board
// links to. It is never stored.
//
// Errors carry .status (and .retryAfter) and a message with the URL in it. The
// URL names the company, so callers print the message locally only
// (publiclog.mjs) and the status code in Actions.

import { UA } from '../sources.mjs';
import { cleanText, leverFullText } from '../resume/text.mjs';
import { validToken } from './hosts.mjs';
import { isoOrNull } from './policy.mjs';

export const strip = (html) =>
  String(html || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function httpError(url, r) {
  const e = new Error(`${url} -> ${r.status}`);
  e.status = r.status;
  const ra = Number(r.headers?.get?.('retry-after'));
  if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
  return e;
}

async function getText(url, accept, timeout = 20000) {
  // redirect: 'manual' would hide a moved board as a 3xx; follow, but the URL
  // is always built from a validated token on a fixed host.
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw httpError(url, r);
  return r.text();
}

async function getJson(url) {
  return JSON.parse(await getText(url, 'application/json'));
}

const one = (s, tag) => {
  const m = s.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};

/** Personio's XML feed. Exported so it can be tested on a fixture body. */
export function parsePersonio(xml, token) {
  return String(xml)
    .split('<position>')
    .slice(1)
    .map((pos) => {
      const id = one(pos, 'id');
      const offices = [one(pos, 'office'), ...[...pos.matchAll(/<additionalOffices>([\s\S]*?)<\/additionalOffices>/g)].flatMap((m) => [...m[1].matchAll(/<office>([\s\S]*?)<\/office>/g)].map((o) => o[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()))]
        .filter(Boolean);
      const html = [...(pos.match(/<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/)?.[1] || '').matchAll(/<value>([\s\S]*?)<\/value>/g)]
        .map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, ''))
        .join(' ');
      // "Remote DE" would otherwise fail eligibleFrom, which wants a word for the country.
      const location = [...new Set(offices)].join('; ').replace(/\bDE\b/g, 'Germany');
      return {
        nativeId: id,
        title: one(pos, 'name'),
        url: `https://${token}.jobs.personio.de/job/${id}?language=en`,
        location,
        description: strip(html),
        fullText: cleanText(html),
        html,
        postedAt: isoOrNull(one(pos, 'createdAt')),
      };
    })
    .filter((p) => p.nativeId && p.title);
}

/** Each reader returns { name, careersUrl, postings }. */
const READERS = {
  async greenhouse(token) {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    const jobs = j.jobs || [];
    return {
      name: jobs[0]?.company_name || null,
      postings: jobs.map((x) => ({
        nativeId: String(x.id),
        title: x.title,
        url: x.absolute_url,
        location: x.location?.name || '',
        description: strip(x.content),
        fullText: cleanText(x.content),
        html: String(x.content || ''),
        // updated_at moves on every edit and would make old roles look new.
        postedAt: isoOrNull(x.first_published),
      })),
    };
  },
  async ashby(token) {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`);
    return {
      name: null, // Ashby publishes no board name; description evidence decides
      postings: (j.jobs || []).filter((x) => x.isListed !== false).map((x) => ({
        nativeId: String(x.id),
        title: x.title,
        url: x.jobUrl,
        location: [x.location, x.isRemote ? 'Remote' : ''].filter(Boolean).join(' '),
        description: strip(x.descriptionHtml || x.descriptionPlain),
        fullText: cleanText(x.descriptionHtml || x.descriptionPlain),
        html: String(x.descriptionHtml || ''),
        postedAt: isoOrNull(x.publishedAt),
      })),
    };
  },
  async lever(token) {
    const j = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
    return {
      name: null,
      postings: (j || []).map((x) => ({
        nativeId: String(x.id),
        title: x.text,
        url: x.hostedUrl,
        location: x.categories?.location || '',
        description: strip(x.descriptionPlain || x.description),
        fullText: leverFullText(x),
        html: String(x.description || ''),
        postedAt: x.createdAt ? new Date(x.createdAt).toISOString() : null,
      })),
    };
  },
  /**
   * Teamtailor. No JSON API, but every career site publishes /jobs.rss with the
   * full description and a tt:location block per country, which is a better
   * location signal than the prose: a role open in five named countries says so
   * in the feed even when the page header only reads "Multiple locations".
   *
   * The token is the career host, e.g. careers.example.com.
   */
  async teamtailor(token) {
    const xml = await getText(`https://${token}/jobs.rss`, 'application/rss+xml, application/xml');
    const postings = xml
      .split('<item>')
      .slice(1)
      .map((item) => {
        const url = one(item, 'link');
        // .../jobs/8066197-technical-customer-engineer-emea
        const nativeId = (url.match(/\/jobs\/(\d+)/) || [])[1] || url;
        const countries = [
          ...new Set([...item.matchAll(/<tt:country>([^<]*)<\/tt:country>/g)].map((m) => m[1].trim()).filter(Boolean)),
        ];
        const rawDescription = one(item, 'description');
        const description = strip(rawDescription);
        const remote = /\bremote\b/i.test(description);
        return {
          nativeId,
          title: one(item, 'title'),
          url,
          location: [countries.join(', '), remote ? 'Remote' : ''].filter(Boolean).join(' '),
          description,
          fullText: cleanText(rawDescription),
          html: rawDescription,
          postedAt: isoOrNull(one(item, 'pubDate')),
        };
      })
      .filter((p) => p.title && p.url);
    return { name: one(xml.split('<item>')[0], 'title') || null, postings };
  },
  async workable(token) {
    const j = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`);
    return {
      name: j.name || null,
      postings: (j.jobs || []).map((x) => ({
        nativeId: String(x.shortcode),
        title: x.title,
        url: x.url || x.application_url,
        location: [x.city, x.state, x.country, x.telecommuting ? 'Remote' : ''].filter(Boolean).join(', '),
        description: strip(x.description),
        fullText: cleanText(x.description),
        html: String(x.description || ''),
        postedAt: isoOrNull(x.published_on || x.created_at),
      })),
    };
  },
  async recruitee(token) {
    const j = await getJson(`https://${token}.recruitee.com/api/offers/`);
    const offers = j.offers || [];
    return {
      name: offers[0]?.company_name || null,
      careersUrl: offers[0]?.careers_url || null,
      postings: offers.map((x) => {
        const html = `${x.description || ''} ${x.requirements || ''}`;
        return {
          nativeId: String(x.id),
          title: x.title,
          url: x.careers_url,
          location: [x.location, x.remote ? 'Remote' : ''].filter(Boolean).join(' '),
          description: strip(html),
          fullText: cleanText(html),
          html,
          // "2026-10-30 16:32:58 UTC"
          postedAt: isoOrNull(String(x.published_at || '').replace(' UTC', 'Z').replace(' ', 'T')),
        };
      }),
    };
  },
  async personio(token) {
    const xml = await getText(`https://${token}.jobs.personio.de/xml?language=en`, 'application/xml');
    if (!/<workzag-jobs/.test(xml)) throw Object.assign(new Error('personio: unexpected body'), { status: 200, unexpected: true });
    const name = (xml.match(/<subcompany>([\s\S]*?)<\/subcompany>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    return { name: name || null, postings: parsePersonio(xml, token) };
  },
};

/** Each board as a plain function of its token. Exported so a board can be tested alone. */
export const BOARDS = Object.fromEntries(
  Object.entries(READERS).map(([kind, read]) => [kind, async (token) => (await read(token)).postings])
);

const memo = new Map();

/**
 * A board's postings. The token is checked before any request is made. The
 * answer is kept for the life of the process, so two people watching one
 * board cost one fetch: public board data only, never written to a shared row.
 */
export async function readBoard(kind, token) {
  const read = READERS[kind];
  if (!read) throw Object.assign(new Error('unsupported board kind'), { code: 'bad_kind' });
  if (!validToken(kind, token)) throw Object.assign(new Error('invalid board token'), { code: 'bad_token' });
  const key = `${kind}:${token}`;
  if (!memo.has(key)) {
    const p = read(token);
    memo.set(key, p);
    p.catch(() => { if (memo.get(key) === p) memo.delete(key); });
  }
  return memo.get(key);
}

export const fetchBoard = async (kind, token) => (await readBoard(kind, token)).postings;
export const clearBoardMemo = () => memo.clear();

/**
 * For the probe: the board's name and postings, or null for a clean miss (404,
 * or an unexpected body). A transport failure, 429 or 5xx throws.
 */
export async function fetchProbe(kind, token) {
  try {
    const b = await readBoard(kind, token);
    return { name: b.name, careersUrl: b.careersUrl || null, posts: b.postings.map((p) => ({ title: p.title, html: p.html || p.description })), postings: b.postings };
  } catch (e) {
    if (e?.status === 404 || e?.unexpected) return null;
    throw e;
  }
}

/** Lever carries no board name in the API: read it from the public page title, only after the API answered. */
export async function leverName(token) {
  try {
    const html = await getText(`https://jobs.lever.co/${token}`, 'text/html', 12000);
    const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1] || '';
    return t.replace(/\s*(?:-|\|)?\s*jobs?\b.*$/i, '').trim() || null;
  } catch {
    return null;
  }
}
