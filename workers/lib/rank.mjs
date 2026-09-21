// Ranking of community questions, 0 to 100. Pure functions.
export const KEYWORD_GROUPS = [
  ['error', /\b(error|exception|crash(es|ed)?|panic|stack ?trace)\b/i],
  ['fails', /\b(fail(s|ed|ing)?|broken|not working|doesn'?t work|does not work|unable|cannot|can'?t)\b/i],
  ['how-to', /\b(how (to|do i|can i|should i)|best way|is it possible)\b/i],
  ['timeout', /\b(timeout|timed out|hang(s|ing)?|slow|latency|stuck)\b/i],
  ['auth', /\b(auth|401|403|jwt|token|login|sign[- ]?in|oauth|rls|permission denied|unauthori[sz]ed|sso|saml|smtp)\b/i],
  ['connection', /\b(connection|connect|econnrefused|refused|dns|network|proxy|tls|ssl|cert(ificate)?|firewall)\b/i],
  ['migration', /\b(migrat(e|ion|ing)|upgrade|version|breaking|deprecat)\b/i],
  ['5xx', /\b(500|502|503|504|internal server error|bad gateway)\b/i],
  ['docker', /\b(docker|compose|volume|port|wsl|container|image build|dockerfile)\b/i],
  ['integration', /\b(webhook|cron|trigger|rate limit|429|api key|integration)\b/i],
];
export const PENALTY = /\b(hiring|freelanc|job offer|looking for (a |an )?(dev|developer|freelancer|mentor|partner|collaborator|co-?founder)|mentor(ship)?|accountability partner|study (group|partner)|feature request|announcement|show and tell|about the .* category|payment|billing|invoice|refund|card declined|delete (my )?account|locked out|pricing plan|grace (window|period)|account (paused|suspended|deletion)|ticket [A-Z]{2}-\d+|restore (my )?project)\b/i;
// Titles that read like engineering bug reports rather than user questions (core engine internals, wrong results, crashes in named functions).
export const BUG_REPORT = /(`[^`]+`|::|\b(segfault|assertion|regression|wrong result|logical error|dictionary|distributed|parser|optimizer|merge ?tree|replica)\b)/i;
// Labels by which a maintainer has explicitly invited outside work. Supabase
// stages exactly these on its public Open Source Maintainers board, which the
// workers cannot read directly because GitHub gates projects behind a
// read:project scope. The labels are on the issues themselves and are far more
// selective than `external-issue`, which sits on 270 of 297 open issues and so
// says nothing. An invited issue is also exempt from the bug-tracker penalty:
// the whole point of `needs-analysis` is that someone should go and analyse it.
export const INVITED = /^(needs-analysis|help wanted|good first issue|documentation)$/i;

export function ageHoursOf(iso, now = Date.now()) { return Math.max(0, (now - new Date(iso).getTime()) / 3600000); }

export function rankItem(item, cfg, now = Date.now()) {
  const age = ageHoursOf(item.createdAt, now);
  const text = `${item.title || ''}\n${item.excerpt || ''}`;
  const recency = 40 * Math.exp(-age / 36);
  const unanswered = !item.hasAnswer && item.comments === 0 ? 25 : !item.hasAnswer && item.comments <= 2 ? 12 : 0;
  const matched = KEYWORD_GROUPS.filter(([name, re]) => (name === 'docker' && item.company === 'docker' ? false : re.test(text))).map(([n]) => n);
  const keywords = Math.min(24, matched.length * 6);
  const target = cfg.companies?.[item.company]?.weight ?? 0;
  const engagement = Math.max(-5, Math.min(5, Number(item.score) || 0));
  const detail = (item.excerpt || '').length > 150 ? 3 : 0;
  const invitedBy = (item.tags || []).find((t) => INVITED.test(String(t).trim()));
  const invite = invitedBy ? 15 : 0;
  let penalties = PENALTY.test(item.title || '') ? 25 : 0;
  if (item.source === 'stackoverflow' && item.requireKeyword && matched.length === 0) penalties += 15;
  // Issue trackers of big engines are mostly bug reports; only how-to / setup style issues are answerable by a support engineer.
  if (item.source === 'gh-issue' && item.bugTracker && !invitedBy && !matched.includes('how-to')) penalties += BUG_REPORT.test(item.title || '') ? 30 : 15;
  const rank = Math.max(0, Math.min(100, Math.round(recency + unanswered + keywords + target + engagement + detail + invite - penalties)));
  const why = [`${item.comments === 0 ? '0 replies' : `${item.comments} replies`}`, age < 48 ? `${Math.round(age)}h` : `${Math.round(age / 24)}d`, ...(matched.length ? [matched.join(', ')] : []), ...(invitedBy ? [`invited: ${String(invitedBy).toLowerCase()}`] : []), ...(penalties ? [`penalty -${penalties}${item.bugTracker && item.source === 'gh-issue' ? ' (bug tracker)' : ''}`] : [])].join(' · ');
  return { rank, why, ageHours: Math.round(age), matched };
}
