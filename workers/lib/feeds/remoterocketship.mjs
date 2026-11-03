// Remote Rocketship, an aggregator, filtered to her titles and Germany. Its
// listing page is server-rendered Next.js with the jobs in __NEXT_DATA__, and
// robots.txt allows the path. Pagination is client-side and ?page= is ignored
// by the server, so this reads the first page only: sorted newest first and
// with about fourteen additions a week, twenty a day covers everything that
// arrives. Descriptions are not in the payload; the two summaries, the tech
// stack and the language flags stand in, and requiredLanguages is a cleaner
// German signal than any regex over prose.

import { httpGet } from './http.mjs';

export const RR_URL =
  'https://www.remoterocketship.com/remote-jobs/?page=1&sort=DateAdded' +
  '&jobTitle=Customer%2520Support%2520Engineer%2CTechnical%2520Support%2520Engineer%2CSupport%2520Engineer' +
  '%2CTechnical%2520Support%2520Specialist%2CCustomer%2520Success%2520Engineer%2CClient%2520Support%2520Engineer' +
  '&locations=Germany';

export async function fetchRemoteRocketship(url) {
  const html = await httpGet(url, 'text/html');
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('remoterocketship: __NEXT_DATA__ not found (page layout changed?)');
  const jobs = JSON.parse(m[1])?.props?.pageProps?.initialJobOpenings || [];
  return jobs.map((x) => {
    const langs = Array.isArray(x.requiredLanguages) ? x.requiredLanguages : [];
    return {
      nativeId: String(x.id),
      title: x.roleTitle || '',
      url: x.url,
      location: [x.location, x.locationType === 'remote' ? 'Remote' : x.locationType || ''].filter(Boolean).join(' '),
      description: [x.jobDescriptionSummary, x.twoLineJobDescriptionSummary, (x.techStack || []).join(', ')].filter(Boolean).join(' '),
      // The listing carries only summaries; the full text is looked up later, once per run budget.
      fullText: null,
      postedAt: x.created_at || null,
      company: { name: x.company?.name || '', slug: x.company?.slug || '', homepage: x.company?.homePageURL || null },
      remote: x.locationType === 'remote',
      // The aggregator read the posting; trust its language flags over our regex.
      germanFlag: langs.includes('de') || x.descriptionLanguage === 'de',
      languageNote:
        x.descriptionLanguage === 'de'
          ? 'posting written in German (Remote Rocketship)'
          : langs.length
            ? `required languages per Remote Rocketship: ${langs.join(', ')}`
            : '',
      senior: !!x.isSenior,
      ghostScore: x.ghostScore ?? null,
    };
  });
}

export default {
  id: 'remoterocketship',
  idPrefix: 'rr',
  label: 'Remote Rocketship',
  creditUrl: 'https://www.remoterocketship.com',
  textKind: 'summary',
  staleDays: null, // never closes a row: a search page drops live roles too
  // The URL encodes her titles, so anyone else polls it only with their own.
  config: (profile, primary) => profile.remoteRocketshipUrl || (primary ? RR_URL : null),
  fetch: (url) => fetchRemoteRocketship(url),
};
