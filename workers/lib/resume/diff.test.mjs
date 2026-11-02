import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff } from './diff.mjs';

test('added words are marked, kept words are same', () => {
  const d = wordDiff('fixed webhook issues', 'quickly fixed webhook issues daily');
  assert.deepEqual(d, [
    { t: 'add', s: 'quickly' },
    { t: 'same', s: 'fixed webhook issues' },
    { t: 'add', s: 'daily' },
  ]);
});

test('identical text has no additions', () => {
  const d = wordDiff('one two three', 'one two three');
  assert.deepEqual(d, [{ t: 'same', s: 'one two three' }]);
});

test('removed words are not shown', () => {
  const d = wordDiff('alpha beta gamma', 'alpha gamma');
  assert.deepEqual(d, [{ t: 'same', s: 'alpha gamma' }]);
});

test('empty source marks everything as added', () => {
  assert.deepEqual(wordDiff('', 'a b'), [{ t: 'add', s: 'a b' }]);
});
