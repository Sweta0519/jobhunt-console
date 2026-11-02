// Posting text helpers. Pure and browser-safe: no node imports, no env.

export const MIN_DESCRIPTION_CHARS = 800;
export const MAX_PROMPT_CHARS = 30000;

const NAMED = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', rsquo:"'", lsquo:"'", rdquo:'"', ldquo:'"', hellip:'...', ndash:'-', mdash:'-', bull:'-', middot:'-' };
const safeChar = (c) => (c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ' ');
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? ' ');

/**
 * Posting HTML to plain text with line structure. Decodes first because
 * Greenhouse entity-encodes its markup, and twice because some boards
 * double-encode. Removes comments and invisible characters, the usual hiding
 * places for text aimed at an LLM.
 */
export function cleanText(html) {
  let s = decode(decode(String(html || '')));
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|ol|li|h[1-6]|tr|section)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decode(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F­​-\u200F\u202A-\u202E⁠-⁤﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n(?=- )/g, '\n') // list items stay together
    .trim();
  return s;
}

/**
 * Lever's descriptionPlain omits the requirement lists and the closing
 * section, so the full text is stitched together from all three parts.
 */
export function leverFullText(x) {
  const lists = (x.lists || []).map((l) => `${cleanText(l.text)}\n${cleanText(l.content)}`).join('\n\n');
  return [cleanText(x.description || x.descriptionPlain), lists, cleanText(x.additional || x.additionalPlain)]
    .filter(Boolean).join('\n\n');
}

export const isDraftable = (d) => !!d && d.kind !== 'summary' && d.chars >= MIN_DESCRIPTION_CHARS;
