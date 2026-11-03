// Staffing agencies and recruiters: their boards are other people's jobs.
// Generic and safe to commit.

import { core } from './classify.mjs';

const STAFFING_RE = /\b(recruit(ing|ment|ers?)?|staffing|personal(service|dienst|beratung|vermittlung)\w*|headhunt\w*|talent (acquisition|solutions|partners)|personnel|zeitarbeit|arbeitnehmer.?überlassung)\b/i;
const STAFFING_NAMES = new Set(['hays', 'randstad', 'adecco', 'manpower', 'manpowergroup', 'robert half', 'michael page', 'page group', 'pagegroup', 'experis', 'gulp', 'akkodis', 'modis', 'brunel', 'kelly services', 'allegis', 'aerotek', 'teksystems', 'computer futures', 'sthree', 'harvey nash', 'nigel frank', 'jefferson frank', 'mason frank', 'franklin fitch', 'wallace hind']);

export const isStaffing = (name) => STAFFING_RE.test(String(name || '')) || STAFFING_NAMES.has(core(name));
