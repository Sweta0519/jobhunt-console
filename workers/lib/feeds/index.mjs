// One file per feed; adding a source is a new file plus one line here.
// The order is the precedence between feeds: an earlier feed's row wins.

import remoterocketship from './remoterocketship.mjs';
import himalayas from './himalayas.mjs';
import jobicy from './jobicy.mjs';

export const FEEDS = [remoterocketship, himalayas, jobicy];

const memo = new Map();

/**
 * A feed's listings, fetched once per process per config. Public data only, so
 * a second person with the same config costs nothing. Never cached on failure.
 */
export function memoFeed(feed, cfg) {
  const key = feed.id + JSON.stringify(cfg);
  if (!memo.has(key)) {
    const p = Promise.resolve().then(() => feed.fetch(cfg, {}));
    memo.set(key, p);
    p.catch(() => { if (memo.get(key) === p) memo.delete(key); });
  }
  return memo.get(key);
}
export const clearFeedMemo = () => memo.clear();
