// Lever: the public apply page, read as plain HTML with string parsing only. No DOM
// library runs here because this module runs beside the service key.
//   GET https://jobs.lever.co/{token}/{id}/apply
// robots.txt is checked first and a 1100 ms gap is kept between requests (the
// crawl delay Lever asks for). No form is ever filled in or submitted.
//
// The markup parsed below (.application-question, div.application-label) was
// checked against a live public page and a synthetic fixture. If the page stops matching it degrades
// to needs_paste (shape_changed) or may_be_incomplete, never to a guess.

import { getLimited, SourceError } from './http.mjs';
import { parseRobots, robotsAllows } from '../../boards/careers.mjs';
import { gapMs } from '../../boards/hosts.mjs';
import { cleanText } from '../../resume/text.mjs';

const HOST = 'jobs.lever.co';
const EEO_MARK = /(?:id|class)="[^"]*(?:eeo|demographic|diversity)[^"]*"/i;

const decodeAttr = (s) => cleanText(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const stripMarker = (s) => s.replace(/[✱*∗]\s*$/u, '').trim();

/** Pure: the apply page HTML to a raw form. Throws SourceError('shape_changed') when nothing parses. */
export function parseLeverApply(html) {
  const src = String(html || '');
  const markers = (src.match(/class="[^"]*application-label[^"]*"/g) || []).length;
  const eeoAt = src.search(EEO_MARK);
  const questions = [];
  const heading = (at) => headings.filter((h) => h.at < at).pop()?.text || '';
  const demographic = (at, field, lower) =>
    (eeoAt >= 0 && at > eeoAt) || /^surveysResponses\[|^eeo\[/i.test(field) ||
    /demographic|diversity|equal opportunity|\beeo\b|\bsurvey\b/i.test(heading(at)) ||
    /\b(gender|race|ethnic\w*|veteran|disabilit\w*|sexual orientation)\b/.test(lower);

  // A question is an <li> or a <div> with class application-question (the survey
  // location gate is a div). Options sit in nested <li>, so a question runs from its
  // own start to the next question or the next form section, whichever is first.
  const startRe = /<(?:li|div)\b[^>]*class="(?:[^"]*\s)?application-question(?:\s[^"]*)?"[^>]*>/gi;
  const starts = [...src.matchAll(startRe)].map((x) => x.index);
  const sections = [...src.matchAll(/<div\b[^>]*class="[^"]*\bsection\b[^"]*"[^>]*>/gi)].map((x) => x.index);
  const headings = [...src.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)].map((x) => ({ at: x.index, text: decodeAttr(x[1]) }));
  let uncertain = false;
  for (let n = 0; n < starts.length; n++) {
    const m = { index: starts[n] };
    const nextStart = starts[n + 1] ?? src.length;
    const nextSection = sections.find((x) => x > starts[n]) ?? src.length;
    const chunk = src.slice(starts[n], Math.min(nextStart, nextSection));
    const labels = chunk.match(/class="[^"]*application-label[^"]*"/g) || [];
    const lab = /<div\b[^>]*class="[^"]*application-label[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk);
    if (!lab) continue;
    if (labels.length > 1) { uncertain = true; continue; } // two labels in one block: do not guess which owns the options
    // Hidden inputs carry JSON with "required" in it, so only visible controls count.
    const controlTags = [...chunk.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)].map((x) => x[0]).filter((x) => !/type="hidden"/i.test(x));
    const required = /class="[^"]*required[^"]*"/i.test(lab[1]) || controlTags.some((x) => /\srequired(?:[\s=>\/]|$)/i.test(x));
    const label = stripMarker(decodeAttr(lab[1]));
    if (!label) continue;
    const field = (/\bname="([^"]+)"/.exec(chunk) || [])[1] || '';
    if (/\[baseTemplate\]|\[(?:template|id)\]$/i.test(field)) continue;

    const inputs = [...chunk.matchAll(/<input\b[^>]*>/gi)].map((x) => x[0]).filter((x) => !/type="hidden"/i.test(x));
    const typeOf = (tag) => (/type="([^"]+)"/i.exec(tag) || [])[1]?.toLowerCase() || 'text';
    let kind = 'short_text';
    let options = [];
    let optionsKnown = true;
    if (/<textarea\b/i.test(chunk)) kind = 'long_text';
    else if (/<select\b/i.test(chunk)) {
      kind = 'single_select';
      options = [...chunk.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map((o) => decodeAttr(o[1])).filter((o) => o && !/^(select|choose|--)/i.test(o));
      optionsKnown = options.length > 0;
    } else if (inputs.some((i) => typeOf(i) === 'file')) kind = 'file';
    else if (inputs.some((i) => ['radio', 'checkbox'].includes(typeOf(i)))) {
      const box = inputs.some((i) => typeOf(i) === 'checkbox');
      kind = box && inputs.length > 1 ? 'multi_select' : 'single_select';
      options = [...chunk.matchAll(/class="[^"]*application-answer-alternative[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map((o) => decodeAttr(o[1])).filter(Boolean);
      optionsKnown = options.length > 0;
    } else if (inputs.some((i) => typeOf(i) === 'email')) kind = 'email';
    else if (inputs.some((i) => typeOf(i) === 'tel')) kind = 'phone';
    else if (inputs.some((i) => typeOf(i) === 'url')) kind = 'url';
    else if (!inputs.length) continue; // a heading, not a field

    const lower = label.toLowerCase();
    questions.push({
      field, label, kind, required, options, options_known: optionsKnown,
      group: demographic(m.index, field, lower) ? 'demographic' : 'main',
      role: kind === 'file' && /resume|\bcv\b|lebenslauf/.test(lower) ? 'resume_file' : /cover letter|anschreiben/.test(lower) ? 'cover_letter' : 'none',
    });
  }
  if (!questions.length) throw new SourceError('shape_changed');
  const missed = uncertain || markers > questions.length;
  return {
    source: 'lever',
    completeness: missed ? 'may_be_incomplete' : 'complete',
    partial_reasons: missed ? ['unlabelled'] : [],
    questions,
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, wait?: (ms: number) => Promise<void> }} deps
 * @returns {Promise<{ raw: any, applyUrl: string }>} Throws SourceError with a machine code.
 */
export async function readLever(token, id, { fetchImpl, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const path = `/${token}/${id}/apply`;
  // robots.txt first. A 403, 429 or 5xx stops us; a plain 404 means no rules.
  const rob = await getLimited(`https://${HOST}/robots.txt`, { host: HOST, accept: 'text/plain', fetchImpl });
  let rules;
  if (rob.status === 200) rules = parseRobots(rob.text.slice(0, 500_000));
  else if (rob.status >= 400 && rob.status < 500 && ![401, 403, 429].includes(rob.status)) rules = [];
  else throw new SourceError('robots_unreachable');
  if (!robotsAllows(rules, path)) throw new SourceError('robots_disallowed');

  await wait(gapMs('lever'));
  const r = await getLimited(`https://${HOST}${path}`, { host: HOST, accept: 'text/html', fetchImpl });
  if (r.status === 404 || r.status === 410) throw new SourceError('not_found');
  if (r.status !== 200) throw new SourceError('http_error');
  return { raw: parseLeverApply(r.text), applyUrl: `https://${HOST}${path}` };
}
