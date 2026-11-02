// Word diff for the review screen. Pure. Removed words are not shown inline.

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

/** Segments of `to`, marked 'same' when the word also sits in `from` in order, else 'add'. */
export function wordDiff(from, to) {
  const a = words(from);
  const b = words(to);
  const n = a.length;
  const m = b.length;
  // LCS table; both inputs are capped by the schema, so this stays small.
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const kinds = new Array(m).fill('add');
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { kinds[j] = 'same'; i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  const out = [];
  for (let k = 0; k < m; k++) {
    const last = out[out.length - 1];
    if (last && last.t === kinds[k]) last.s += ` ${b[k]}`;
    else out.push({ t: kinds[k], s: b[k] });
  }
  return out;
}
