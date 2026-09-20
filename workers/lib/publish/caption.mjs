// Caption assembly and validation. Plain text (real newlines) for humans/export; toLittle() for the API.
import { toLittle } from './little.mjs';

export function assembleCaption(caption) {
  const parts = [caption.hook, caption.body, caption.cta].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.join('\n\n');
}
export function captionForApi(caption) { return toLittle(assembleCaption(caption), caption.hashtags || []); }
export function captionForHumans(caption) {
  const tags = (caption.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ');
  return assembleCaption(caption) + (tags ? `\n\n${tags}` : '');
}

export function validateCaption(caption, { format } = {}) {
  const problems = [];
  if (!caption || typeof caption !== 'object') return ['caption missing'];
  const hook = String(caption.hook || '').trim();
  if (!hook) problems.push('hook missing');
  if (hook.length > 210) problems.push(`hook is ${hook.length} chars (max 210, LinkedIn truncates the first lines)`);
  if (/\n/.test(hook)) problems.push('hook must be a single line');
  const body = String(caption.body || '').trim();
  if (body.length < 200 && format !== 'text-short') problems.push(`body is ${body.length} chars (aim for 500 to 1200)`);
  const tags = caption.hashtags || [];
  if (tags.length < 3 || tags.length > 5) problems.push(`${tags.length} hashtags (use 3 to 5)`);
  const total = captionForHumans(caption).length;
  if (total > 2900) problems.push(`caption is ${total} chars (max 2900 to stay under LinkedIn's 3000)`);
  if ((format === 'card' || format === 'deck') && /https?:\/\//i.test(body + ' ' + hook + ' ' + (caption.cta || ''))) problems.push('no URLs in card/deck captions (LinkedIn downranks link posts); keep links in sources and mention "link in comments"');
  return problems;
}
