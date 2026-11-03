// Greenhouse: the public job board API with questions. Fixed host, read only.
//   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true
// Token and id are checked by the caller (validToken) before they reach a URL.

import { getLimited, parseJson, SourceError } from './http.mjs';
import { cleanLabel } from '../schema.mjs';
import { cleanText } from '../../resume/text.mjs';

const HOST = 'boards-api.greenhouse.io';

const KINDS = {
  input_text: 'short_text', textarea: 'long_text', input_file: 'file',
  multi_value_single_select: 'single_select', multi_value_multi_select: 'multi_select',
};

function kindOfField(f) {
  const kind = KINDS[f.type] || 'unknown';
  const name = String(f.name || '').toLowerCase();
  if (kind === 'short_text') {
    if (/email/.test(name)) return 'email';
    if (/phone/.test(name)) return 'phone';
    if (/linkedin|website|github|portfolio|url/.test(name)) return 'url';
  }
  return kind;
}

/** One Greenhouse question (a label with one or more fields) to a Question, or null. */
function mapQuestion(raw, group) {
  const fields = (Array.isArray(raw?.fields) ? raw.fields : []).filter((f) => f && f.type !== 'input_hidden');
  if (!fields.length) return null;
  const file = fields.find((f) => f.type === 'input_file');
  const f = file || fields[0];
  const name = String(f.name || '').toLowerCase();
  const values = (Array.isArray(f.values) ? f.values : []).map((v) => ({ label: v?.label }));
  const isSelect = f.type === 'multi_value_single_select' || f.type === 'multi_value_multi_select';
  return {
    field: f.name || '',
    label: raw.label,
    help: raw.description ? cleanText(raw.description) : '',
    kind: file ? 'file' : kindOfField(f),
    required: raw.required === true ? true : raw.required === false ? false : null,
    options: isSelect ? values : [],
    options_known: !isSelect || values.length > 0,
    group,
    role: file ? (name.startsWith('cover_letter') ? 'cover_letter' : name.startsWith('resume') ? 'resume_file' : 'none') : name.startsWith('cover_letter') ? 'cover_letter' : 'none',
  };
}

function mapDemographic(raw) {
  const opts = (Array.isArray(raw?.answer_options) ? raw.answer_options : []).map((o) => ({ label: o?.label }));
  const multi = raw?.type === 'multi_value_multi_select';
  return {
    field: String(raw?.id ?? ''), label: raw?.label, kind: multi ? 'multi_select' : opts.length ? 'single_select' : 'short_text',
    required: raw?.required === true, options: opts, options_known: true, group: 'demographic', role: 'none',
  };
}

/** Pure: a parsed API answer to a raw form (before validateForm). Throws SourceError. */
export function mapGreenhouse(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.questions)) throw new SourceError('shape_changed');
  const questions = [];
  const add = (q) => { if (q && cleanLabel(q.label)) questions.push(q); };
  for (const q of j.questions) add(mapQuestion(q, 'main'));
  for (const q of Array.isArray(j.location_questions) ? j.location_questions : []) add(mapQuestion(q, 'location'));
  for (const c of Array.isArray(j.compliance) ? j.compliance : []) {
    for (const q of Array.isArray(c?.questions) ? c.questions : []) add(mapQuestion(q, 'compliance'));
  }
  const dq = j.demographic_questions?.questions;
  for (const q of Array.isArray(dq) ? dq : []) add(mapDemographic(q));
  if (!questions.length) throw new SourceError('shape_changed');
  return { source: 'greenhouse', completeness: 'complete', partial_reasons: [], questions };
}

/** @returns {Promise<{ raw: any, applyUrl: string }>} Throws SourceError with a machine code. */
export async function readGreenhouse(token, id, { fetchImpl } = {}) {
  const r = await getLimited(`https://${HOST}/v1/boards/${token}/jobs/${id}?questions=true`, { host: HOST, fetchImpl });
  if (r.status === 404) throw new SourceError('not_found');
  if (r.status !== 200) throw new SourceError('http_error');
  const j = parseJson(r.text);
  const raw = mapGreenhouse(j);
  let applyUrl = `https://boards.greenhouse.io/${token}/jobs/${id}`;
  try {
    const u = new URL(String(j.absolute_url || ''));
    if (u.protocol === 'https:' && !u.port && !u.username && !u.password && /^[a-z0-9.-]+$/i.test(u.hostname)) applyUrl = u.href;
  } catch { /* keep the board URL */ }
  return { raw, applyUrl };
}
