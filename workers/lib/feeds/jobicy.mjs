// Jobicy: public JSON feed, once a day. Terms: credit with a direct link, and
// application buttons go to the feed's own URL.

import { httpJson } from './http.mjs';
import { cleanText } from '../resume/text.mjs';
import { isoOrNull } from '../boards/policy.mjs';

const text = (v, n = 300) => String(v ?? '').slice(0, n);

export function mapJobicy(x) {
  if (!x?.id || !x.jobTitle || !x.url) return null;
  const html = String(x.jobDescription || '');
  const full = cleanText(html);
  const geo = Array.isArray(x.jobGeo) ? x.jobGeo.join(', ') : text(x.jobGeo, 120);
  // "2026-10-30 12:00:00", read as UTC
  const raw = String(x.pubDate || '').trim();
  const stamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  return {
    nativeId: String(x.id).replace(/[^A-Za-z0-9._-]/g, ''),
    title: text(x.jobTitle, 200),
    url: text(x.url, 500),
    location: [geo, 'Remote'].filter(Boolean).join(' '),
    description: full || text(x.jobExcerpt, 600),
    fullText: full || null,
    postedAt: isoOrNull(stamp),
    company: { name: text(x.companyName, 120), slug: '', homepage: null },
    remote: true,
    germanFlag: false,
    languageNote: '',
    senior: false,
    ghostScore: null,
  };
}

export default {
  id: 'jobicy',
  idPrefix: 'jobicy',
  label: 'Jobicy',
  creditUrl: 'https://jobicy.com',
  textKind: 'aggregator',
  staleDays: 30,
  config: (profile) => profile.feeds?.jobicy ?? null,
  async fetch(cfg) {
    const geo = encodeURIComponent(String(cfg.geo || 'germany'));
    const j = await httpJson(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}`);
    return (j.jobs || []).map(mapJobicy).filter(Boolean);
  },
};
