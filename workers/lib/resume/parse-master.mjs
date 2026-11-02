// HTML master CV -> master JSON. Pure: no imports, no env, no regex engine
// tricks beyond what a small known structure needs.
//
// Runs on the PC at seed time only. An unexpected structure throws: a half
// parsed CV must never be seeded.
//
// Expected structure (class names, not content):
//   h1 name, .tagline, .contact (pieces split by .sep, a gives the href),
//   h2 sections: summary, skills (.skills p with <b>Label:</b> items),
//   experience (.role > .role-title, .meta "company | location | dates", li),
//   open source (li), projects (.role, meta whole), education, awards ("a | b").

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', middot: '-', bull: '-' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/** Long dashes become hyphens at seed time: the source file is untouched. */
const dashes = (s) => s.replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, '-').replace(/\s*[–—]\s*/g, ' - ');
const text = (html) => dashes(decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());

function fail(msg) { throw new Error(`master CV: ${msg}`); }

/** Inner html of every element carrying a class, with nested same-name tags balanced. */
function byClass(html, cls) {
  const out = [];
  const open = new RegExp(`<(\\w+)\\b[^>]*\\bclass="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`, 'gi');
  let m;
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase();
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = open.lastIndex;
    let depth = 1;
    let n;
    while ((n = re.exec(html))) {
      depth += n[1] ? -1 : 1;
      if (!depth) { out.push({ inner: html.slice(open.lastIndex, n.index), outer: html.slice(m.index, re.lastIndex) }); break; }
    }
    if (depth) fail(`unclosed <${tag}> with class ${cls}`);
    open.lastIndex = m.index + m[0].length;
  }
  return out;
}

function sections(html) {
  const parts = html.split(/<h2[^>]*>/i);
  const out = new Map();
  for (const p of parts.slice(1)) {
    const end = p.indexOf('</h2>');
    if (end < 0) fail('unterminated h2');
    out.set(text(p.slice(0, end)).toLowerCase(), p.slice(end + 5));
  }
  return out;
}

function pick(secs, re, name) {
  for (const [k, v] of secs) if (re.test(k)) return v;
  return fail(`missing section: ${name}`);
}

const lis = (html) => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);

/** Split on commas that sit outside parentheses. */
export function splitOutsideParens(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/\.$/, '').trim()).filter(Boolean);
}

function parseSkills(html) {
  const groups = [];
  for (const blk of byClass(html, 'skills')) {
    // <b>Label:</b> items ... <b>Label2:</b> items2 ...
    const bits = blk.inner.split(/<b\b[^>]*>/i).slice(1);
    for (const bit of bits) {
      const end = bit.indexOf('</b>');
      if (end < 0) fail('unterminated <b> in skills');
      const label = text(bit.slice(0, end)).replace(/:$/, '').trim();
      const items = splitOutsideParens(text(bit.slice(end + 4)));
      if (!label || !items.length) fail('empty skills group');
      groups.push({ label, items });
    }
  }
  if (!groups.length) fail('no skills groups');
  return groups;
}

function parseRoles(html, { metaParts }) {
  const roles = byClass(html, 'role');
  return roles.map((r) => {
    const title = byClass(r.inner, 'role-title')[0];
    if (!title) fail('role without .role-title');
    const meta = byClass(r.inner, 'meta')[0];
    const metaText = meta ? text(meta.inner) : '';
    if (metaParts) {
      const parts = metaText.split('|').map((x) => x.trim());
      if (parts.length !== metaParts || parts.some((x) => !x)) fail(`role meta needs ${metaParts} parts`);
    }
    const bullets = lis(r.inner).map(text).filter(Boolean);
    return { title: text(title.inner), meta: metaText, bullets };
  });
}

function collectLinks(html) {
  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]).trim();
    if (!/^(https:\/\/|mailto:)/i.test(href)) fail('a link is neither https nor mailto');
    const label = text(m[2]);
    const key = `${label}\n${href}`;
    if (label && !seen.has(key)) { seen.add(key); links.push({ label, href }); }
  }
  return links;
}

export function parseMaster(html) {
  html = String(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!h1) fail('missing h1');
  const tag = byClass(html, 'tagline')[0];
  if (!tag) fail('missing .tagline');
  // A decoy empty span.contact can sit inside the tagline: prefer p.contact, else the first non-empty one.
  const contacts = byClass(html, 'contact');
  const contactBlk = contacts.find((c) => /^<p[\s>]/i.test(c.outer)) || contacts.find((c) => text(c.inner));
  if (!contactBlk) fail('missing .contact');

  const contact = contactBlk.inner
    .split(/<[^>]+\bclass="[^"]*\bsep\b[^"]*"[^>]*>[\s\S]*?<\/\w+>/i)
    .map((piece) => {
      const a = /<a\b[^>]*\bhref="([^"]*)"/i.exec(piece);
      return { label: text(piece), href: a ? decode(a[1]).trim() : null };
    })
    .filter((c) => c.label);
  if (!contact.length) fail('empty .contact');

  const secs = sections(html);
  const summary = text((/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(pick(secs, /summary|profile/, 'summary')) || [])[1] || '');
  if (!summary) fail('empty summary');

  const raw = parseSkills(pick(secs, /skill/, 'skills'));
  const langIdx = raw.findIndex((g) => /^languages?$/i.test(g.label));
  if (langIdx < 0) fail('no Languages group');
  const languages = raw.splice(langIdx, 1)[0];
  const skills = raw.map((g, i) => ({ id: `s${i + 1}`, label: g.label, items: g.items }));

  const experience = parseRoles(pick(secs, /experience/, 'experience'), { metaParts: 3 }).map((r, i) => {
    if (!r.bullets.length) fail('a role has no bullets');
    const [company, location, dates] = r.meta.split('|').map((x) => x.trim());
    return {
      id: `r${i + 1}`, title: r.title, company, location, dates,
      bullets: r.bullets.map((t, j) => ({ id: `r${i + 1}.b${j + 1}`, text: t })),
    };
  });
  if (!experience.length) fail('no roles');

  const osItems = lis(pick(secs, /open.?source/, 'open source'));
  if (!osItems.length) fail('empty open source section');
  const open_source = osItems.map((li, i) => {
    const b = /^\s*<b\b[^>]*>([\s\S]*?)<\/b>([\s\S]*)$/i.exec(li);
    return b
      ? { id: `o${i + 1}`, label: text(b[1]).replace(/:$/, ''), text: text(b[2]).replace(/^[:\s]+/, '') }
      : { id: `o${i + 1}`, label: '', text: text(li) };
  });

  const projects = parseRoles(pick(secs, /project/, 'projects'), { metaParts: 0 }).map((p, i) => {
    if (!p.bullets.length) fail('a project has no bullets');
    return {
      id: `p${i + 1}`, title: p.title, meta: p.meta,
      bullets: p.bullets.map((t, j) => ({ id: `p${i + 1}.b${j + 1}`, text: t })),
    };
  });
  if (!projects.length) fail('no projects');

  const eduHtml = pick(secs, /education/, 'education');
  const eduRoles = byClass(eduHtml, 'role');
  const education = eduRoles.length
    ? eduRoles.map((r) => ({
        title: text((byClass(r.inner, 'role-title')[0] || fail('education entry without .role-title')).inner),
        meta: text((byClass(r.inner, 'meta')[0] || { inner: '' }).inner),
      }))
    : byClass(eduHtml, 'role-title').length
      // no .role wrapper: titles and metas sit directly in the section, in pairs
      ? byClass(eduHtml, 'role-title').map((t, i) => ({
          title: text(t.inner),
          meta: text((byClass(eduHtml, 'meta')[i] || { inner: '' }).inner),
        }))
      : lis(eduHtml).map((li) => ({ title: text(li), meta: '' }));
  if (!education.length) fail('empty education section');

  const awardsHtml = pick(secs, /award|certif|honou?r/, 'awards');
  const awardSrc = lis(awardsHtml).length ? lis(awardsHtml) : [(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(awardsHtml) || [])[1] || ''];
  const awards = awardSrc.flatMap((a) => text(a).split('|')).map((a) => a.trim()).filter(Boolean);
  if (!awards.length) fail('empty awards section');

  return {
    schema: 1,
    name: text(h1[1]),
    tagline: text(tag.inner),
    contact,
    summary,
    skills,
    languages: { label: languages.label, items: languages.items },
    experience,
    open_source,
    projects,
    education,
    awards,
    links: collectLinks(html),
  };
}
