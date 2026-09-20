// Company-name normalizer so "Acme GmbH", "ACME, Inc." and "acme" collide.
const SUFFIXES = [
  'inc', 'inc.', 'incorporated', 'llc', 'l.l.c.', 'ltd', 'ltd.', 'limited', 'plc', 'corp', 'corp.', 'corporation',
  'co', 'co.', 'company', 'gmbh', 'mbh', 'ag', 'se', 'kg', 'kgaa', 'ug', 'ohg', 'e.v.', 'ev', 'sa', 's.a.', 'sas',
  'sarl', 'bv', 'b.v.', 'nv', 'n.v.', 'oy', 'ab', 'as', 'a/s', 'aps', 'pty', 'pvt', 'pvt.', 'private', 'holding',
  'holdings', 'group', 'technologies', 'technology', 'tech', 'labs', 'software', 'solutions', 'services', 'international',
  'global', 'europe', 'deutschland', 'germany', 'india', 'usa',
];

export function normCompany(name) {
  if (!name) return '';
  let s = String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/\(.*?\)/g, ' ');            // drop parentheticals
  s = s.replace(/[&+]/g, ' and ');
  s = s.replace(/[^a-z0-9 ]+/g, ' ');
  let words = s.split(/\s+/).filter(Boolean);
  // strip trailing suffix words repeatedly, but keep at least one word
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function slugify(s) {
  return normCompany(s).replace(/\s+/g, '-');
}

export function firstName(fullOrFirst) {
  return String(fullOrFirst || '').trim().split(/\s+/)[0] || '';
}

// Stable short hash for ids.
export function shortHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function cleanProfileUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    u.search = ''; u.hash = '';
    let p = u.pathname.replace(/\/+$/, '');
    return `https://www.linkedin.com${p}`;
  } catch { return url.trim(); }
}

export function jobIdFromUrl(url) {
  const m = String(url || '').match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/) || String(url || '').match(/currentJobId=(\d{6,})/);
  return m ? m[1] : '';
}
