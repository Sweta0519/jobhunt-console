// Job-fit scoring (0-100) and job-page parsing helpers.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_DIR, DATA_DIR } from './paths.mjs';
import { normCompany } from './norm.mjs';

export const PROFILE_PATH = join(DATA_DIR, 'profile.json');

export const DEFAULT_PROFILE = {
  _comment: 'Your job-search profile. Edit freely; scoring uses it. Skills are matched as case-insensitive phrases in the job description.',
  roles: ['senior customer support engineer', 'technical support engineer', 'customer support engineer', 'senior technical support engineer', 'support engineer', 'technical support specialist', 'customer engineer', 'solutions support engineer', 'product support engineer', 'application support engineer', 'customer success engineer'],
  rolePenalties: ['manager', 'director', 'head of', 'vp ', 'intern', 'working student', 'werkstudent', 'junior', 'sales', 'account executive', 'field service', 'hardware technician'],
  seniority: 'senior',
  skills: {
    core: ['b2b saas', 'saas', 'rest api', 'apis', 'api', 'sql', 'incident management', 'troubleshooting', 'root cause', 'log analysis', 'logs', 'escalation', 'technical support', 'customer support', 'tier 2', 'l2', 'l3', 'debugging'],
    tools: ['zendesk', 'jira', 'intercom', 'salesforce', 'freshdesk', 'servicenow', 'postman', 'grafana', 'datadog', 'kibana', 'splunk', 'sentry', 'confluence', 'slack'],
    tech: ['linux', 'http', 'json', 'javascript', 'python', 'bash', 'networking', 'dns', 'tcp/ip', 'oauth', 'sso', 'saml', 'webhooks', 'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'chrome devtools', 'browser', 'mobile', 'ios', 'android'],
    ai: ['ai', 'llm', 'claude', 'copilot', 'chatgpt', 'automation', 'ai-powered', 'triage', 'machine learning', 'prompt'],
    soft: ['knowledge base', 'documentation', 'sla', 'customer-facing', 'cross-functional', 'on-call', 'english', 'communication', 'enterprise customers', 'developer', 'developers'],
  },
  yearsExperience: 8,
  locations: {
    home: 'Hamburg',
    remoteRegions: ['germany', 'european union', 'eu', 'europe', 'emea', 'eea', 'dach', 'worldwide', 'global', 'anywhere', 'european economic area'],
    // Remote postings tied to one other country do not work for a Germany-based candidate (payroll/entity), so they score 0 on location.
    okCountriesRemote: ['netherlands', 'austria', 'switzerland', 'ireland', 'spain', 'portugal', 'poland', 'estonia', 'united kingdom', 'france', 'italy', 'sweden', 'denmark', 'finland', 'belgium', 'czech', 'romania', 'hungary', 'lithuania', 'latvia', 'bulgaria', 'greece', 'croatia', 'slovakia', 'slovenia'],
    hybridOkCities: ['hamburg'],
  },
  languages: { excludeGermanRequired: true },
  scan: {
    queries: ['senior customer support engineer', 'technical support engineer', 'customer support engineer', 'support engineer saas', 'customer engineer'],
    locations: [
      { label: 'Germany remote', location: 'Germany', remote: true },
      { label: 'EU remote', location: 'European Union', remote: true },
      { label: 'EMEA remote', location: 'Germany', remote: true, keywordsSuffix: ' EMEA' },
    ],
    days: 7,
  },
};

export function loadProfile() {
  if (!existsSync(PROFILE_PATH)) return structuredClone(DEFAULT_PROFILE);
  const p = JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
  return { ...structuredClone(DEFAULT_PROFILE), ...p, skills: { ...DEFAULT_PROFILE.skills, ...(p.skills || {}) }, locations: { ...DEFAULT_PROFILE.locations, ...(p.locations || {}) }, scan: { ...DEFAULT_PROFILE.scan, ...(p.scan || {}) } };
}

let unicornCache = null;
export function loadUnicorns() {
  if (unicornCache) return unicornCache;
  const p = join(SKILL_DIR, 'data', 'unicorns.json');
  const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { unicorns: [], startupSignals: [] };
  unicornCache = { set: new Set(j.unicorns.map(normCompany)), signals: j.startupSignals || [] };
  return unicornCache;
}

// ---------- German requirement detection
const GERMAN_REQUIRED = [
  /\b(fluent|fluency|proficien\w*|business[- ]level|professional|advanced|native|mother[- ]tongue|excellent|strong|solid|good|very good)\b[^.\n]{0,40}\bgerman\b/i,
  /\bgerman\b[^.\n]{0,40}\b(required|mandatory|is a must|must[- ]have|essential|necessary|needed|prerequisite|fluent|fluency|native|c1|c2|b2)\b/i,
  /\b(c1|c2|b2)\b[^.\n]{0,15}\bgerman\b/i,
  /\bdeutsch(kenntnisse|sprachig)?\b[^.\n]{0,40}\b(erforderlich|voraussetzung|verhandlungssicher|fließend|fliessend|muttersprach\w*|sehr gut|zwingend)\b/i,
  /\b(verhandlungssicher\w*|fließend\w*|fliessend\w*|muttersprachlich\w*)\b[^.\n]{0,20}\bdeutsch/i,
  /\bgerman[- ]speaking\b/i,
];
const GERMAN_OPTIONAL = /\bgerman\b[^.\n]{0,60}\b(plus|bonus|nice[- ]to[- ]have|advantage|beneficial|preferred|desirable|not required|optional|a big plus|would be)\b|\b(plus|bonus|nice[- ]to[- ]have|advantage|beneficial|preferred|desirable|optional)\b[^.\n]{0,60}\bgerman\b/i;
const GERMAN_WORDS = /\b(und|der|die|das|mit|für|nicht|wir|sie|eine|einen|unsere|deine|dein|bei|aus|auch|werden|sind|oder|wird|über|nach|kannst|bist|haben|zum|zur)\b/gi;

// German named as one acceptable language among several: "Fluent in Spanish,
// Dutch, German, or another European language". That is a requirement for a
// language, not for German, and it read as GERMAN REQUIRED until this rule.
const GERMAN_ONE_OF = /\b(one of|any of|or another|or other|or any|either)\b[^.\n]{0,80}\bgerman\b|\bgerman\b[^.\n]{0,60}\bor (another|other|any|a second)\b[^.\n]{0,30}\blanguage/i;

export function detectGerman(text) {
  const t = String(text || '');
  const optional = GERMAN_OPTIONAL.test(t) || GERMAN_ONE_OF.test(t);
  const requiredHits = GERMAN_REQUIRED.filter((re) => re.test(t)).length;
  const germanWordCount = (t.match(GERMAN_WORDS) || []).length;
  const writtenInGerman = germanWordCount > 40 && germanWordCount / Math.max(1, t.split(/\s+/).length) > 0.06;
  const mentions = /\bgerman\b|\bdeutsch/i.test(t);
  const required = writtenInGerman || (requiredHits > 0 && !(optional && requiredHits < 2));
  const evidence = writtenInGerman ? 'posting written in German' : (t.match(/[^.\n]{0,60}\b(german|deutsch\w*)\b[^.\n]{0,60}/i)?.[0] || '').trim();
  return { required, optional: optional && !required, mentions, writtenInGerman, requiredHits, evidence };
}

// ---------- Location / remote fit
export function locationFit(job, profile) {
  const loc = String(job.location || '').toLowerCase();
  const wt = String(job.workplaceType || '').toLowerCase();
  const title = String(job.title || '').toLowerCase();
  const desc = String(job.description || '').toLowerCase();
  const remote = /remote/.test(wt) || /\(remote\)/.test(loc) || /\bremote\b/.test(title);
  const hybrid = /hybrid/.test(wt) || /hybrid/.test(loc);
  const L = profile.locations;
  const inRegion = L.remoteRegions.some((r) => loc.includes(r)) || /\bemea\b|\beurope\b/.test(title);
  const okCountry = L.okCountriesRemote.some((c) => loc.includes(c));
  const usOnly = /\b(united states|usa|u\.s\.|canada)\b/.test(loc) || /\b(us[- ]based only|must be (located|based) in the (us|united states)|authorized to work in the (us|united states))\b/.test(desc);
  const home = L.hybridOkCities.some((c) => loc.includes(c));
  let score, label;
  if (remote && usOnly) { score = 0; label = 'remote, but US/Canada only'; }
  else if (remote && (loc.includes('germany') || loc.includes('deutschland'))) { score = 20; label = 'remote, Germany'; }
  else if (remote && inRegion && /\b(germany|deutschland|anywhere in (the )?(eu|europe|emea)|across (the )?(eu|europe|emea)|any (eu|european) country|eu[- ]wide|europe[- ]wide|emea[- ]wide|all (eu|european) countries|remote (across|within|in) (the )?(eu|europe|emea))\b/.test(desc)) { score = 19; label = `remote, ${job.location}, text confirms Germany/EU-wide` ; }
  else if (remote && inRegion) { score = 12; label = `remote, "${job.location}" is only LinkedIn's tag; text does not confirm hiring in Germany, verify with the poster`; }
  else if (remote && /\b(germany|deutschland)\b/.test(desc) && /\b(emea|europe|european|eu[- ]wide|across the eu|anywhere in the eu|any eu country|following (countries|places|locations))\b/.test(desc)) { score = 14; label = `remote, posted for ${job.location} but text names Germany among allowed countries; verify`; }
  else if (remote && okCountry) { score = 0; label = `remote, but posted for ${job.location}, not Germany`; }
  else if (remote) { score = 0; label = `remote, ${job.location}: not Germany/EU/EMEA`; }
  else if (hybrid && home) { score = 14; label = 'hybrid, Hamburg'; }
  else if (home) { score = 10; label = 'on-site Hamburg'; }
  else if (loc.includes('germany') || loc.includes('berlin') || loc.includes('munich') || loc.includes('münchen')) { score = 5; label = `on-site/hybrid ${job.location}`; }
  else { score = 2; label = `on-site ${job.location || '?'}`; }
  // Region-wide posting whose text restricts to specific countries, e.g. "must be in EMEA in one of the following places Ireland, United Kingdom, Spain or Poland"
  const restricted = desc.match(/\b(?:must|need to|required to|have to|should) (?:be|reside|live|be located|be based|work)(?: (?:located|based))? in ([a-z ,&/]+?(?:following (?:places|countries|locations)[: ]+[a-z ,&/]+)?)(?:\.|\n|;| and (?!\w+,)| to | with )/)
    || desc.match(/\b(?:only|exclusively) (?:open to|available to|hiring in|for) (?:candidates|applicants|people)? ?(?:(?:located|based|residing) in )?([a-z ,&/]+?)(?:\.|\n|;)/);
  let restrictedTo = restricted ? restricted[1].replace(/^(emea|europe|eu|the eu|european union)\b[^a-z]*(in )?(one of the following (places|countries|locations))?[: ]*/i, '').trim().slice(0, 80) : '';
  if (restrictedTo && remote) {
    const okHere = /\b(germany|deutschland|eu\b|european union|europe|emea|eea|dach|worldwide|anywhere|global)/.test(restrictedTo);
    if (!okHere && /[a-z]{4,}/.test(restrictedTo)) { score = 0; label = `remote, but only for: ${restrictedTo}`; }
  }
  return { score, label, remote, hybrid, restrictedTo };
}

// ---------- Role/title fit
export function roleFit(title, profile) {
  const t = String(title || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ');
  let best = 0, matched = '';
  profile.roles.forEach((r, i) => {
    if (t.includes(r)) { const s = 25 - Math.min(10, i); if (s > best) { best = s; matched = r; } }
  });
  if (!best) {
    if (/support engineer|technical support|customer support|support specialist|customer engineer|solutions engineer|success engineer/.test(t)) { best = 15; matched = 'support-family title'; }
    else if (/support|customer/.test(t)) { best = 8; matched = 'support-related title'; }
  }
  const penalty = profile.rolePenalties.find((p) => t.includes(p));
  if (penalty && !/senior/.test(penalty)) best = Math.max(0, best - 12);
  return { score: Math.min(25, best), matched, penalty: penalty || '' };
}

// ---------- Skills
export function skillsFit(text, profile) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9+/#.\- ]/g, ' ').replace(/\s+/g, ' ')} `;
  const weights = { core: 2, tools: 1, tech: 1, ai: 1.5, soft: 0.5, fromLinkedIn: 1 };
  let got = 0, max = 0; const hits = [];
  for (const [group, list] of Object.entries(profile.skills)) {
    const w = weights[group] ?? 1;
    const uniq = [...new Set(list.map((s) => s.toLowerCase()))];
    // cap each group's contribution so long lists do not dominate
    const groupHits = uniq.filter((s) => t.includes(` ${s} `) || t.includes(` ${s},`) || t.includes(` ${s}.`) || t.includes(`/${s}`) || t.includes(`${s}/`));
    hits.push(...groupHits.map((h) => `${h}`));
    got += Math.min(groupHits.length, 8) * w;
    max += 8 * w;
  }
  // scale: matching ~35% of the capped list is already excellent for a job ad
  const score = Math.min(30, Math.round((got / max) * 30 / 0.35));
  return { score, hits: [...new Set(hits)] };
}

// ---------- Seniority
export function seniorityFit(title, desc, profile) {
  const t = String(title || '').toLowerCase();
  const d = String(desc || '').toLowerCase();
  const yrs = (d.match(/(\d+)\+?\s*(?:\+\s*)?years?/g) || []).map((m) => Number(m.match(/\d+/)[0])).filter((n) => n < 20);
  const maxYrs = yrs.length ? Math.max(...yrs) : null;
  if (/junior|intern|working student|werkstudent|entry[- ]level|trainee/.test(t)) return { score: 0, label: 'junior level' };
  if (/senior|sr\.|staff|principal|lead\b|l3|tier 3|level 3/.test(t)) return { score: 10, label: 'senior level' };
  if (/\(senior\)|senior\)/.test(t)) return { score: 9, label: 'mid/senior' };
  if (maxYrs && maxYrs >= 5) return { score: 8, label: `${maxYrs}+ years asked` };
  if (maxYrs && maxYrs >= 3) return { score: 7, label: `${maxYrs}+ years asked` };
  if (/l2|tier 2|level 2/.test(t)) return { score: 6, label: 'L2' };
  if (/l1|tier 1|level 1/.test(t)) return { score: 2, label: 'L1' };
  return { score: 6, label: 'level not stated' };
}

// ---------- Company type
export function companyFit(job) {
  const { set, signals } = loadUnicorns();
  const norm = normCompany(job.company);
  const desc = String(job.description || '').toLowerCase() + ' ' + String(job.companyAbout || '').toLowerCase();
  const size = String(job.companySize || '');
  const sizeNum = Number((size.match(/([\d,]+)\s*(?:-|–|\+)?/)?.[1] || '').replace(/,/g, ''));
  const onList = set.has(norm) || (norm.length >= 5 && [...set].some((u) => u.length >= 5 && (norm.startsWith(`${u} `) || u.startsWith(`${norm} `))));
  if (onList) return { score: 10, label: 'on your unicorn/startup list' };
  const sig = signals.find((s) => desc.includes(s));
  if (/staffing|recruit(ing|ment)( agency)?|talents?\b|consulting|outsourc|personaldienstleist|jobgether|hays|randstad|adecco|manpower|robert half|michael page|experis|akkodis|kelly services|quik hire/i.test(job.company)
    || /we are (a|an) (staffing|recruitment|talent)|one of our clients|on behalf of (our|a) client|hiring for (our|a) client|is a talent matching platform/.test(desc)) return { score: 1, label: 'agency / staffing / aggregator' };
  if (sig && sizeNum && sizeNum <= 1000) return { score: 8, label: `startup signal "${sig}", ${size}` };
  if (sig) return { score: 6, label: `startup signal "${sig}"` };
  if (sizeNum && sizeNum <= 200) return { score: 6, label: `small company (${size} employees)` };
  if (sizeNum && sizeNum <= 1000) return { score: 5, label: `mid-size (${size} employees)` };
  if (sizeNum && sizeNum <= 5000) return { score: 4, label: `established (${size} employees)` };
  if (sizeNum > 5000) return { score: 2, label: `large corporate (${size} employees)` };
  return { score: 3, label: 'company type unknown' };
}

// ---------- Total
export function scoreJob(job, profile) {
  const text = `${job.title}\n${job.description || ''}`;
  const role = roleFit(job.title, profile);
  const skills = skillsFit(text, profile);
  const loc = locationFit(job, profile);
  const company = companyFit(job);
  const senior = seniorityFit(job.title, job.description, profile);
  // The title counts too: "Product Support Specialist (German-speaking)" said
  // it in the title and nowhere the detector looked, and sat in the Open view.
  const german = detectGerman(`${job.title || ''}\n${job.description || ''}`);
  const lang = german.required ? 0 : german.optional ? 4 : 5;
  const total = Math.round(role.score + skills.score + loc.score + company.score + senior.score + lang);
  return {
    total: Math.max(0, Math.min(100, total)),
    breakdown: { role: role.score, skills: skills.score, location: loc.score, company: company.score, seniority: senior.score, language: lang },
    notes: { role: role.matched + (role.penalty ? ` (penalty: ${role.penalty})` : ''), skills: skills.hits.slice(0, 14).join(', '), location: loc.label + (loc.restrictedTo ? `; restricted to ${loc.restrictedTo}` : ''), company: company.label, seniority: senior.label, language: (german.required ? 'GERMAN REQUIRED' : german.optional ? 'German nice-to-have' : 'no German requirement found') + (german.evidence ? ` ("${german.evidence.slice(0, 90)}")` : '') },
    germanRequired: german.required,
    remote: loc.remote,
  };
}

// ---------- Parse a job page's accessibility snapshot (verified 2026-09-12 structure)
export function parseJobSnapshot(snap) {
  const lines = snap.split('\n');
  const out = { title: '', company: '', location: '', posted: '', applicants: '', workplaceType: '', employmentType: '', description: '', companySize: '', companyAbout: '', poster: null, easyApply: false };
  const companyLink = snap.match(/- link "Company, ([^"]+?)\.?":/);
  if (companyLink) out.company = companyLink[1].trim();
  const clean = (s) => s.trim().replace(/^- (paragraph|text|listitem|strong|emphasis|heading "?|link "?)[:\s]*/, '').replace(/"?\s*\[level=\d\]:?$/, '').replace(/^"|"$/g, '').trim();
  let i = 0;
  // title: first "- paragraph:" followed by "- text: <title>" and a "Verified job" link, or the first paragraph after "More options"
  const moreIdx = lines.findIndex((l) => /button "More options"/.test(l));
  for (let k = Math.max(0, moreIdx); k < Math.min(lines.length, moreIdx + 12); k++) {
    const m = lines[k].match(/^\s*- text: (.+)$/) || lines[k].match(/^\s*- paragraph: (.+)$/);
    if (m && !/·|Promoted|applicants|Verified job/.test(m[1])) { out.title = m[1].trim(); break; }
  }
  const meta = lines.find((l) => /- paragraph: .+ · .+ (ago|applicants|Reposted)/.test(l) || /- paragraph: .+·.+(applicant|ago)/.test(l));
  if (meta) {
    const parts = clean(meta).split('·').map((s) => s.trim());
    out.location = parts[0] || '';
    out.posted = parts.find((p) => /ago|Reposted/.test(p)) || '';
    out.applicants = parts.find((p) => /applicant/.test(p)) || '';
  }
  for (const l of lines) {
    const m = l.match(/^\s*- link "(Remote|Hybrid|On-site|Full-time|Part-time|Contract|Internship|Temporary)"/);
    if (m) { if (/Remote|Hybrid|On-site/.test(m[1])) out.workplaceType = out.workplaceType || m[1]; else out.employmentType = out.employmentType || m[1]; }
    if (/link "Easy Apply/.test(l)) out.easyApply = true;
  }
  // description: everything between heading "About the job" and the next level-2 heading
  const start = lines.findIndex((l) => /heading "About the job"/.test(l));
  if (start >= 0) {
    const buf = [];
    for (i = start + 1; i < lines.length; i++) {
      if (/^\s*- heading "/.test(lines[i]) && /\[level=2\]/.test(lines[i])) break;
      const m = lines[i].match(/^\s*- (?:paragraph|text|listitem|strong|emphasis|heading "?)[:\s]*(.*)$/);
      if (m && m[1]) buf.push(m[1].replace(/"?\s*\[level=\d\]:?$/, '').replace(/^"|"$/g, '').trim());
    }
    out.description = buf.filter(Boolean).join('\n');
  }
  // company block
  const size = snap.match(/([\d,]+(?:\s*[-–]\s*[\d,]+)?\+?)\s+employees/);
  if (size) out.companySize = size[1];
  const aboutIdx = lines.findIndex((l) => /heading "About the company"/.test(l));
  if (aboutIdx >= 0) out.companyAbout = lines.slice(aboutIdx + 1, aboutIdx + 25).map((l) => (l.match(/- (?:paragraph|text): (.+)$/) || [])[1] || '').filter(Boolean).join(' ').slice(0, 1500);
  // hiring team / job poster
  const posterIdx = lines.findIndex((l) => /heading "People you can reach out to"|Meet the hiring team/.test(l));
  if (posterIdx >= 0) {
    // - link "<Name> Verified • 3rd <Headline> Job poster":  /url: https://www.linkedin.com/in/...
    //   - paragraph: - text: <Name>  - paragraph: • 3rd  - paragraph: <Headline>  - paragraph: Job poster
    for (let k = posterIdx; k < Math.min(lines.length, posterIdx + 20); k++) {
      if (!/^\s*- link "/.test(lines[k]) || /- link "(Message|Connect|Follow)"/.test(lines[k])) continue;
      const u = lines[k + 1]?.match(/\/url: (https:\/\/www\.linkedin\.com\/in\/[^\s"]+)/);
      if (!u) continue;
      const block = lines.slice(k + 2, k + 10);
      const junk = /^(Message|Connect|Follow|Job poster|Hiring team|Verified)$|^• /;
      const texts = block.map((l) => (l.match(/^\s*- (?:text|paragraph): (.+)$/) || [])[1]).filter(Boolean).map((s) => s.trim()).filter((s) => !junk.test(s));
      const linkName = (lines[k].match(/- link "([^•"]+?)(?: Verified)?(?: •|")/)?.[1] || '').trim();
      const name = (texts[0] || (junk.test(linkName) ? '' : linkName)).trim();
      const degree = Number((block.map((l) => (l.match(/^\s*- paragraph: (.+)$/) || [])[1]).find((p) => p && /^• ?(1st|2nd|3rd)/.test(p)) || '').match(/(1|2|3)/)?.[1] || 0);
      const headline = texts[1] || '';
      out.poster = { name, url: u[1].replace(/\/$/, ''), degree, headline, role: block.some((l) => /- (?:paragraph|text): Job poster$/.test(l)) ? 'Job poster' : 'Hiring team' };
      out.hiringSnippet = lines.slice(posterIdx, posterIdx + 16).map((l) => l.trim()).join('\n').slice(0, 900);
      break;
    }
  }
  return out;
}
