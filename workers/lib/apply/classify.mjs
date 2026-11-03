// Rules first, model second. Pure: no env, no I/O, English and German patterns.
//
// A question that a rule decides is never sent to Claude, so its label cannot
// argue with the rule. The model may later widen "needs you" or "blank" but never
// narrow them (see compose.mjs).
//
// Per question the result is { q, cls, bank_key?, why?, source? }:
//   cls  blank | needs_you | fixed | upload | drafted (source 'cover' only here)
//   why  a code set by this file, never text from the form

const t = (s) => String(s ?? '').toLowerCase();

// Demographic terms are blank for every kind of question. Whole words only, so "age"
// does not hit "manage" or "usage" and "race" does not hit "trace" or "race condition".
const DEMOGRAPHIC = /\b(gender|geschlecht|pronouns?|race(?! conditions?)|ethnic\w*|herkunft|veterans?|disab\w*|behinderung|sexual orientation|sexuelle orientierung|religio\w*|age|alter)\b/;
// Consent and legal terms are blank only when the question is an acknowledgement. A
// long_text asking ABOUT privacy or GDPR is a real question and goes to the model.
const CONSENT = /\b(consent|agree|acknowledge|certify|attest|privacy|gdpr|datenschutz|einwilligung|ich stimme|terms|background check|hintergrundpr\w*)\b/;
const SOCIAL = /\b(twitter|instagram|facebook|tiktok|mastodon|bluesky|telegram|discord|skype|whatsapp|xing|youtube|stack ?overflow|kaggle|dribbble|behance)\b|\bx\.com\b|^x\b[\s:*?(]*(handle|profile|url|username|account|link|twitter|$)/;
const SENSITIVE = /(date of birth|birth ?date|geburtsdatum|geburtstag|passport|reisepass|national id|personalausweis|tax id|steuer\w*|\biban\b|bank account|kontonummer|password|passwort|social security|sozialversicherung\w*)/;
// Real instructions only. Postings and forms mention LLMs and AI tools honestly
// ("LLM observability", "learn a new AI tool"), so those words alone do not count.
export const APPLY_INJECTION = /ignore (all|any|the|previous|prior|above)\b.{0,30}(instruction|prompt|rule|direction)|ignore (the )?(above|previous|prior)\b|disregard (all|any|the|your|previous|prior)\b.{0,30}(instruction|prompt|rule|direction)|system prompt|\bas an ai\b|\bassistant:|you are an? (ai|assistant)\b|if you are an? (ai|llm|language model|bot|chatbot)|\bai (screener|reviewer|grader|evaluator)\b|(note|message|instructions?) (to|for) (the )?(ai|llm|model|assistant|screener)/;
const AI_USE = /(\buse[ds]?\b|\busing\b|utili[sz]\w*|with the help of|assist\w* (by|from)|generated).{0,40}\b(ai|artificial intelligence|chatgpt|gpt|llm|copilot|claude|gemini)\b|written (by you|yourself)|your own words|\bki\b.{0,20}(tool|unterst|genutzt|verwendet)|k[uü]nstliche intelligenz/;
const COVER_LABEL = /cover letter|covering letter|anschreiben|motivationsschreiben|motivation letter/;
const YEARS = /how many years|years of (professional |work |relevant )?experience|wie viele jahre|jahre (an )?berufserfahrung/;
const REFERRAL = /how (did|do) you (first )?(hear|find out|learn about|come across|find (us|this|the (role|job|position)|about))|where did you (first )?(hear|find out|learn about|see (this|the|our))|(hear|heard|find out|found out) about (us|this|the|our)|aufmerksam geworden|\breferr(al|als|ed|er)\b|do you know anyone|know anyone at|wie haben sie von uns|wie sind sie auf uns|woher kennen/;

const WORK_AUTH = /authori[sz]ed to work|work authori[sz]ation|right to work|(legally )?(allowed|entitled|eligible) to work|arbeitserlaubnis|arbeitsgenehmigung/;

// Anything about needing or avoiding a visa, permit or sponsorship.
const SPONSOR_ISH = /sponsor\w*|(requir|need|ben[oö]tig)\w*.{0,20}(visa|permit|visum)|(without|ohne).{0,20}(visa|permit|visum)|visa.{0,20}requir|work visa/;

// First match wins. Authorization and sponsorship carry a country scope, below.
const FIXED = [
  ['email', /\be-?mail\b/],
  ['phone', /\b(phone|telephone|telefon\w*|handy(nummer)?|mobile (phone|number)|mobilnummer|cell ?phone)\b/],
  ['full_name', /^(your |legal )?(full )?name[\s:*?]*$|\bfull name\b|\bvollst\w+ name\b|\bfirst (and|&) last name\b|\bfirst and surname\b|\bvor- ?(und|&) nachname\b|\bvorname (und|&) nachname\b/],
  ['first_name', /\b(first name|given name|vorname)\b/],
  ['last_name', /\b(last name|family name|surname|nachname|familienname)\b/],
  ['linkedin_url', /linkedin/],
  ['github_url', /github/],
  ['portfolio_url', /portfolio/],
  ['website_url', /\b(website|web site|personal site|homepage|webseite)\b/],
  ['salary_expectation', /salary|compensation expectation|expected (pay|compensation)|pay expectation|gehalt\w*|verg[uü]tung|desired remuneration/],
  ['notice_period', /notice period|k[uü]ndigungsfrist/],
  ['earliest_start', /earliest.{0,25}start|start date|available (to start|from)|when can you start|verf[uü]gbar ab|eintrittsdatum|startdatum/],
  // The three auth entries all go through authKind(), which decides the real kind.
  ['sponsorship', SPONSOR_ISH],
  ['work_auth', WORK_AUTH],
  ['visa_status', /visa|aufenthaltstitel|residence permit|work permit|aufenthaltsstatus/],
  ['willing_to_relocate', /relocat\w*|umzug|umziehen/],
  ['remote_preference', /remote.{0,30}prefer\w*|prefer\w*.{0,30}(remote|on-?site|hybrid)|work (arrangement|model)/],
  ['current_location', /current(ly)? (location|based|located)|where are you (currently )?(based|located)|aktueller standort|^location( \(city\))?$/],
  ['city', /\bcity\b|\bstadt\b|\bwohnort\b/],
  ['country', /\bcountry\b/],
];

// Countries named in a label. Anything but Germany and the EU is out of scope for
// the authorization and sponsorship keys, which only describe Germany and the EU.
const OTHER_COUNTRY = /(?<![a-z])(u\.s\.a?|usa|us|united states|america|uk|u\.k\.|united kingdom|britain|england|canada|australia|new zealand|india|china|japan|singapore|brazil|mexico|switzerland|schweiz|norway|norwegen|turkey|t[uü]rkiye|israel|uae|emirates|south africa|nigeria|kenya)(?![a-z])/;
const GERMANY = /\b(germany|deutschland|german)\b/;
const EU = /\b(eu|e\.u\.|european union|europe|european|eea|schengen)\b/;
const EU_COUNTRIES = /\b(germany|deutschland|france|frankreich|spain|spanien|italy|italien|netherlands|niederlande|belgium|belgien|austria|[oö]sterreich|portugal|ireland|irland|poland|polen|sweden|schweden|denmark|d[aä]nemark|finland|finnland|czech\w*|tschechien|hungary|ungarn|romania|rum[aä]nien|bulgaria|bulgarien|greece|griechenland|croatia|kroatien|slovakia|slowakei|slovenia|slowenien|estonia|estland|latvia|lettland|lithuania|litauen|luxembourg|luxemburg|malta|cyprus|zypern)\b/;

// "Authorised to work ... without visa sponsorship": the answer is yes, never the
// sponsorship key (whose saved value is no). Checked first.
const WORK_WITHOUT = [
  /\b(authori[sz]ed|allowed|eligible|entitled|permitted|able|legally|right|can you|berechtigt)\b[^?]{0,80}\bwork\w*\b[^?]{0,80}\b(without|ohne)\b[^?]{0,30}\b(need\w*\s+|requir\w*\s+)?(a |an |any )?(visa|visum|sponsor\w*|work permit)/,
  /\bno (visa )?sponsor\w*( is| are)?( required| needed)?|sponsor\w* (is |are )?(not|no longer) (required|needed)/,
  /\bohne (visum|visa|sponsoring|sponsorship|aufenthaltstitel)/,
];
const SPONSOR_PLAIN = /\b(do|does|will|would|did)\b.{0,40}\b(require|need)\b.{0,25}sponsor/;
// Any negation or inversion makes the polarity unclear: needs her, no bank value.
const NEGATED = /\b(not|never|nicht|kein\w*|free of|frei von|non)\b|n't|\bno (need|visa|sponsor\w*|work permit|requirement)/;

/** 'work_auth' | 'sponsorship' | null (polarity unclear, needs her). */
function authKind(l) {
  for (const re of WORK_WITHOUT) {
    const m = re.exec(l);
    if (m) return NEGATED.test(l.replace(m[0], ' ')) ? null : 'work_auth';
  }
  const sponsor = SPONSOR_ISH.test(l);
  const auth = WORK_AUTH.test(l);
  if (sponsor && auth) return null;
  if (sponsor) return SPONSOR_PLAIN.test(l) && !NEGATED.test(l) ? 'sponsorship' : null;
  if (auth) return NEGATED.test(l) ? null : 'work_auth';
  return null;
}

/** 'de' | 'eu' | 'other' | null for where the JOB is, from its location text. */
function jobRegion(location) {
  const l = t(location);
  if (!l) return null;
  if (GERMANY.test(l) || /\b(berlin|munich|m[uü]nchen|hamburg|frankfurt|cologne|k[oö]ln|stuttgart|d[uü]sseldorf|leipzig|dresden)\b/.test(l)) return 'de';
  if (EU.test(l) || EU_COUNTRIES.test(l)) return 'eu';
  return 'other';
}

/** Which key may answer an authorization or sponsorship question, or null (needs you). */
function scopedKey(kind, label, location) {
  const l = t(label);
  const names = { other: OTHER_COUNTRY.test(l), de: GERMANY.test(l), eu: EU.test(l) };
  if (names.other) return null;
  if (kind === 'sponsorship') {
    if (names.de) return 'needs_sponsorship_de';
    if (names.eu) return null; // only a Germany key exists
    return jobRegion(location) === 'de' ? 'needs_sponsorship_de' : null;
  }
  // work authorization
  if (names.de) return 'work_auth_de';
  if (names.eu) return 'work_auth_eu';
  const region = jobRegion(location);
  if (region === 'de') return 'work_auth_de';
  if (region === 'eu') return 'work_auth_eu';
  return null;
}

/**
 * @param {{ questions: any[] }} form
 * @param {{ location?: string }} job
 * @returns {{ items: any[], toModel: any[], wantsCover: boolean, suspicious: boolean, coverAsk: string }}
 */
export function classifyForm(form, job = {}) {
  const items = [];
  const toModel = [];
  let wantsCover = false;
  let suspicious = false;
  const coverAsk = []; // label and help of the cover letter fields, so the model sees "just a couple of sentences"

  for (const q of form.questions) {
    const label = t(`${q.label}`);
    const done = (item) => items.push({ q: q.id, ...item });

    if (q.group === 'compliance' || q.group === 'demographic') { done({ cls: 'blank' }); continue; }
    if (DEMOGRAPHIC.test(label)) { done({ cls: 'blank' }); continue; }
    if (CONSENT.test(label) && q.kind !== 'long_text') { done({ cls: 'blank' }); continue; }
    // One option only: a checkbox style acknowledgement, never a real choice.
    if ((q.kind === 'single_select' || q.kind === 'multi_select') && q.options?.length === 1) { done({ cls: 'blank' }); continue; }
    if (SENSITIVE.test(label)) { done({ cls: 'blank', why: 'sensitive' }); continue; }
    if (APPLY_INJECTION.test(label) || APPLY_INJECTION.test(t(q.help))) { suspicious = true; done({ cls: 'needs_you', why: 'suspicious' }); continue; }
    if (AI_USE.test(label)) { done({ cls: 'needs_you', why: 'ai_use' }); continue; }
    if (q.kind === 'file') {
      if (q.role === 'cover_letter' || COVER_LABEL.test(label)) { wantsCover = true; coverAsk.push(`${q.label ?? ''} ${q.help ?? ''}`); }
      done({ cls: 'upload' });
      continue;
    }
    if (q.role === 'cover_letter' || COVER_LABEL.test(label)) { wantsCover = true; coverAsk.push(`${q.label ?? ''} ${q.help ?? ''}`); done({ cls: 'drafted', source: 'cover' }); continue; }

    // Before the bank patterns: "how did you hear about us (LinkedIn, ...)" names LinkedIn.
    if (REFERRAL.test(label)) { done({ cls: 'needs_you', why: 'referral' }); continue; }

    if (SOCIAL.test(label)) { done({ cls: 'needs_you', why: 'social' }); continue; }

    let hit = null;
    for (const [key, re] of FIXED) {
      if (re.test(label)) { hit = key; break; }
    }
    if (hit) {
      if (hit === 'sponsorship' || hit === 'work_auth') {
        const kind = authKind(label);
        if (!kind) { done({ cls: 'needs_you', why: 'polarity' }); continue; }
        const key = scopedKey(kind, label, job.location);
        if (key) done({ cls: 'fixed', bank_key: key });
        else done({ cls: 'needs_you', why: 'country_scope' });
        continue;
      }
      done({ cls: 'fixed', bank_key: hit });
      continue;
    }
    if (YEARS.test(label)) { done({ cls: 'needs_you', why: 'duration' }); continue; }
    if ((q.kind === 'single_select' || q.kind === 'multi_select') && (q.options_known === false || !q.options?.length)) {
      done({ cls: 'needs_you', why: 'options_unknown' });
      continue;
    }
    toModel.push(q);
  }
  return { items, toModel, wantsCover, suspicious, coverAsk: coverAsk.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400) };
}
