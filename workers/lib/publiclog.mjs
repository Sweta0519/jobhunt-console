// This repository and its Actions logs are public. In Actions the workers print
// counts and short codes only: never a company, slug, board token, title, URL or
// owner label. Locally (no GITHUB_ACTIONS) the same calls print everything, so
// debugging at her desk is unchanged.

import { safeCode, hashId } from './resume/safelog.mjs';

export { safeCode, hashId };

export const isLocal = () => !process.env.GITHUB_ACTIONS;

/** Print only when running locally. */
export const detail = (...a) => { if (isLocal()) console.log(...a); };
export const detailWarn = (...a) => { if (isLocal()) console.warn(...a); };

/** A person, as it may be printed: the label locally, 'primary' or 'other' in Actions. */
export const who = (o) => (isLocal() ? (o.label || (o.primary ? 'primary' : o.id)) : (o.primary ? 'primary' : 'other'));
