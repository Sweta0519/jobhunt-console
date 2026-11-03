// Ashby: the public application form query the hosted job page itself uses.
//   POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting
// GraphQL variables only: token and posting id travel as variables, never inside
// the query text. Read only: no mutation is ever sent.
//
// The field shape below is not documented by Ashby and was not checked against a
// live endpoint when this was written. Every departure from it degrades to
// needs_paste (shape_changed) rather than to a guess.

import { getLimited, parseJson, SourceError } from './http.mjs';
import { cleanText } from '../../resume/text.mjs';

const HOST = 'jobs.ashbyhq.com';

export const QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    applicationForm {
      sections {
        title
        fieldEntries {
          id
          field
          descriptionHtml
          isRequired
          isHidden
        }
      }
    }
  }
}`;

const DEMOGRAPHIC_SECTION = /demographic|\beeo\b|equal (employment|opportunity)|diversity|voluntary|self[- ]identif/i;

const KIND = {
  String: 'short_text', LongText: 'long_text', Email: 'email', Phone: 'phone', File: 'file',
  ValueSelect: 'single_select', MultiValueSelect: 'multi_select', Boolean: 'yes_no',
  Date: 'date', Number: 'number', Location: 'short_text',
};

/** Pure: a parsed GraphQL answer to a raw form. Throws SourceError('shape_changed' | 'not_found'). */
export function mapAshby(j) {
  if (!j || typeof j !== 'object' || (Array.isArray(j.errors) && j.errors.length)) throw new SourceError('shape_changed');
  const data = j.data;
  if (!data || typeof data !== 'object' || !('jobPosting' in data)) throw new SourceError('shape_changed');
  if (data.jobPosting === null) throw new SourceError('not_found');
  const sections = data.jobPosting?.applicationForm?.sections;
  if (!Array.isArray(sections)) throw new SourceError('shape_changed');

  const questions = [];
  let unknown = 0;
  for (const s of sections) {
    const demo = DEMOGRAPHIC_SECTION.test(String(s?.title || ''));
    if (!Array.isArray(s?.fieldEntries)) throw new SourceError('shape_changed');
    for (const e of s.fieldEntries) {
      const f = e?.field;
      if (!f || typeof f !== 'object') throw new SourceError('shape_changed');
      if (e.isHidden === true) continue;
      const label = String(f.title || f.humanReadablePath || '').trim();
      if (!label) throw new SourceError('shape_changed');
      const path = String(f.path || '').toLowerCase();
      let kind = KIND[f.type];
      if (!kind) { kind = 'unknown'; unknown++; }
      const values = Array.isArray(f.selectableValues) ? f.selectableValues.map((v) => ({ label: v?.label })) : [];
      const select = kind === 'single_select' || kind === 'multi_select';
      const lower = label.toLowerCase();
      questions.push({
        field: String(f.path || e.id || ''),
        label, kind,
        help: e.descriptionHtml ? cleanText(e.descriptionHtml) : '',
        required: e.isRequired === true ? true : e.isRequired === false ? false : null,
        options: select ? values : [],
        options_known: !select || values.length > 0,
        group: demo ? 'demographic' : f.type === 'Location' ? 'location' : 'main',
        role: kind === 'file' ? (/resume|cv/.test(path) || /resume|\bcv\b|lebenslauf/.test(lower) ? 'resume_file' : /cover/.test(path) || /cover letter|anschreiben/.test(lower) ? 'cover_letter' : 'none') : 'none',
      });
    }
  }
  if (!questions.length) throw new SourceError('shape_changed');
  return {
    source: 'ashby',
    completeness: unknown ? 'may_be_incomplete' : 'complete',
    partial_reasons: unknown ? ['unknown_field_type'] : [],
    questions,
  };
}

/** @returns {Promise<{ raw: any, applyUrl: string }>} Throws SourceError with a machine code. */
export async function readAshby(token, id, { fetchImpl } = {}) {
  const r = await getLimited(`https://${HOST}/api/non-user-graphql?op=ApiJobPosting`, {
    host: HOST, method: 'POST', fetchImpl,
    body: { operationName: 'ApiJobPosting', variables: { organizationHostedJobsPageName: token, jobPostingId: id }, query: QUERY },
  });
  if (r.status !== 200) throw new SourceError('shape_changed');
  const raw = mapAshby(parseJson(r.text));
  return { raw, applyUrl: `https://${HOST}/${token}/${id}/application` };
}
