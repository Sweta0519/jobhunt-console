// Pure rules shared by the poll and the draft planner.

export const BACKLOG_DAYS = 14;
export const FEED_FIRST_RUN_MAX_FRESH = 3;

/** A posting on a board's first poll counts as new only if it is genuinely recent. No date means old. */
export const isRecent = (postedAt, now = Date.now()) => {
  const t = Date.parse(postedAt);
  return Number.isFinite(t) && now - t <= BACKLOG_DAYS * 86_400_000;
};

const OTHER = /\b(americas?|north america|latam|apac|asia|us only|usa|canada|costa rica|mexico|colombia|brazil|argentina|india|australia|japan|singapore)\b/i;
const OURS = /\b(emea|europe|eu|germany|dach|deutschland)\b/i;
/** A bare "Remote" location whose title names somewhere else. */
export const otherRegionTitle = (t) => OTHER.test(String(t || '')) && !OURS.test(String(t || ''));

/** Lowercase, drop (m/w/d)-style markers, non-alphanumerics to nothing, first 40 characters. */
export const normTitle = (t) =>
  String(t || '').toLowerCase().replace(/\((?:[mfwd]\s*\/\s*){1,3}[mfwd]\)/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 40);

export const urlKeyOf = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();

export const isoOrNull = (v) => {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
