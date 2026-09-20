// LinkedIn "little" text format for the Posts API commentary field.
// Reserved characters must be backslash-escaped in prose:  \ | { } @ [ ] ( ) < > # * _ ~
// Hashtags we want as real hashtags are appended unescaped as "#Word".
const RESERVED = /[\\|{}@\[\]()<>#*_~]/g;

export function escapeLittle(plain) {
  return String(plain ?? '').replace(RESERVED, (c) => `\\${c}`);
}

// plain: hook/body/cta already joined with real newlines; hashtags: ["CustomerSupport", ...]
export function toLittle(plain, hashtags = []) {
  const tags = hashtags.filter(Boolean).map((h) => `#${String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).join(' ');
  return escapeLittle(plain) + (tags ? `\n\n${tags}` : '');
}
