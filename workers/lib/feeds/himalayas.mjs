// Himalayas: documented public API, no key. Terms: apply through
// applicationLink, show a credit, do not pass jobs on. Page 1 of at most four
// searches a day. Location lists here can be broader than the employer's own,
// which is why a board posting always wins over a feed listing (jobs.mjs).

import { createHash } from 'node:crypto';
import { httpJson } from './http.mjs';
import { cleanText } from '../resume/text.mjs';
import { isoOrNull } from '../boards/policy.mjs';

const MAX_REQUESTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (v, n = 300) => String(v ?? '').slice(0, n);

const when = (v) => {
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  return isoOrNull(v);
};

export function mapHimalayas(x) {
  const guid = text(x.guid || x.applicationLink, 500);
  if (!guid || !x.title || !x.applicationLink) return null;
  const restrictions = Array.isArray(x.locationRestrictions) ? x.locationRestrictions.map((r) => text(r, 60)) : [];
  const html = String(x.description || '');
  const full = cleanText(html);
  return {
    nativeId: createHash('sha256').update(guid).digest('hex').slice(0, 16),
    title: text(x.title, 200),
    url: text(x.applicationLink, 500),
    location: [restrictions.join(', '), 'Remote'].filter(Boolean).join(' '),
    description: full,
    fullText: full || null,
    postedAt: when(x.pubDate),
    company: { name: text(x.companyName, 120), slug: text(x.companySlug, 120), homepage: null },
    remote: true,
    germanFlag: false,
    languageNote: '',
    senior: false,
    ghostScore: null,
  };
}

export default {
  id: 'himalayas',
  idPrefix: 'him',
  label: 'Himalayas',
  creditUrl: 'https://himalayas.app',
  textKind: 'aggregator',
  staleDays: 30,
  config: (profile) => profile.feeds?.himalayas ?? null,
  async fetch(cfg, { wait = sleep } = {}) {
    const out = [];
    let n = 0;
    for (const q of cfg.queries || []) {
      for (const country of cfg.countries || []) {
        if (n >= MAX_REQUESTS) return out;
        if (n++) await wait(2000);
        const j = await httpJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}`);
        for (const x of j.jobs || j.data || []) {
          const l = mapHimalayas(x);
          if (l) out.push(l);
        }
      }
    }
    return out;
  },
};
