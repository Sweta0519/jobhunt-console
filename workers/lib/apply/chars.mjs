// Character classes built from code points, so this source holds no invisible,
// direction-changing or dash characters itself. Pure: no env, no I/O.

const cls = (ranges) =>
  `[${ranges.map(([a, b]) => `\\u{${a.toString(16)}}${b ? `-\\u{${b.toString(16)}}` : ''}`).join('')}]`;
const build = (ranges, flags = 'u') => new RegExp(cls(ranges), flags);

// Controls, soft hyphen, bidi marks and overrides, zero width and isolate characters, BOM.
const INVISIBLE = [[0, 8], [0xb, 0xc], [0xe, 0x1f], [0x7f, 0x9f], [0xad], [0x61c], [0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff], [0xfff9, 0xfffb]];
// Hyphen and minus lookalikes, and the en dash, em dash and horizontal bar.
const LONG_DASHES = [[0x2010, 0x2015], [0x2212], [0xfe58], [0xfe63], [0xff0d]];
const ASIDE_DASHES = [[0x2013, 0x2015]];
const HYPHEN_LIKE = [[0x2010, 0x2012], [0x2212], [0xfe58], [0xfe63], [0xff0d]];

/** Removes (or replaces) control, bidi and invisible characters. */
export const stripInvisible = (s, repl = '') => String(s ?? '').replace(build(INVISIBLE, 'gu'), repl);
export const hasInvisible = (s) => build(INVISIBLE).test(String(s ?? ''));

/** Line and paragraph separators become newlines; everything else invisible is removed. */
export const toPlainLines = (s) =>
  stripInvisible(String(s ?? '').replace(build([[0x2028, 0x2029]], 'gu'), '\n').replace(/\r\n?/g, '\n'));

/** True when the text holds an en dash, em dash, horizontal bar, minus sign or hyphen lookalike. */
export const hasLongDash = (s) => build(LONG_DASHES).test(String(s ?? ''));

/** A digit range keeps a hyphen, an aside becomes a comma, lookalikes become a hyphen. */
export function noLongDashes(s) {
  return String(s ?? '')
    .replace(new RegExp(`(\\d)\\s*${cls(ASIDE_DASHES)}\\s*(\\d)`, 'gu'), '$1-$2')
    .replace(new RegExp(`\\s*${cls(ASIDE_DASHES)}\\s*`, 'gu'), ', ')
    .replace(build(HYPHEN_LIKE, 'gu'), '-');
}

/** The character class source for use inside a bigger pattern. */
export const LONG_DASH_CLASS = cls(LONG_DASHES);
