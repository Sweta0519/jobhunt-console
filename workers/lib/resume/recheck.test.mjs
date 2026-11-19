import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDoc } from './compose.mjs';
import { goodOutput, syntheticMaster } from './fixtures/load.mjs';
import {
  RECHECK_SCHEMA, docForRecheck, buildRecheckMessage, validateRecheck, applyRecheck, gapsOf,
} from './recheck.mjs';

const master = syntheticMaster();
const doc = () => composeDoc(master, goodOutput());
const NONCE = 'abcd1234abcd1234abcd1234abcd1234';
const reqs = () => [
  { text: 'REST API debugging', kind: 'must', status: 'gap', evidence: [], note: 'old' },
  { text: 'Kubernetes', kind: 'nice', status: 'gap', evidence: [], note: '' },
  { text: 'Zendesk', kind: 'must', status: 'gap', evidence: [], note: '' },
];
const { refs } = docForRecheck(doc());
const first = [...refs.keys()][0];
const good = () => ({ results: [
  { i: 0, status: 'met', evidence: [first], note: 'Shown.' },
  { i: 1, status: 'gap', evidence: [], note: '' },
  { i: 2, status: 'partial', evidence: ['experience.r1.0'], note: '' },
] });
const check = (o) => validateRecheck(o, reqs(), refs);

test('a good answer is valid, also in shuffled order', () => {
  assert.deepEqual(check(good()), { ok: true });
  const o = good(); o.results.reverse();
  assert.deepEqual(check(o), { ok: true });
});

test('validateRecheck rejects every malformed answer', () => {
  const mut = (fn) => { const o = good(); fn(o); return check(o); };
  assert.equal(mut((o) => o.results.pop()).ok, false, 'wrong count');
  assert.equal(mut((o) => o.results.push({ i: 0, status: 'gap', evidence: [], note: '' })).ok, false, 'too many');
  assert.equal(mut((o) => { o.results[1].i = 0; }).ok, false, 'duplicate i (so i=1 is missing)');
  assert.equal(mut((o) => { o.results[2].i = 3; }).ok, false, 'i >= n');
  assert.equal(mut((o) => { o.results[2].i = 1.5; }).ok, false, 'non-integer i');
  assert.equal(mut((o) => { o.results[2].i = -1; }).ok, false, 'negative i');
  assert.equal(mut((o) => { o.results[0].extra = 1; }).ok, false, 'extra key');
  assert.equal(mut((o) => { o.extra = 1; }).ok, false, 'extra top key');
  assert.equal(mut((o) => { o.results[0].status = 'excellent'; }).ok, false, 'bad enum');
  assert.equal(mut((o) => { o.results[0].note = 'x'.repeat(201); }).ok, false, 'long note');
  assert.equal(mut((o) => { o.results[0].evidence = ['nope']; }).ok, false, 'unknown ref');
  assert.equal(mut((o) => { o.results[0].evidence = [first, first]; }).ok, false, 'duplicate evidence');
  assert.equal(mut((o) => { o.results[1].evidence = [first]; }).ok, false, 'gap with evidence');
  assert.equal(mut((o) => { o.results[0].evidence = []; }).ok, false, 'met without evidence');
  assert.equal(validateRecheck(null, reqs(), refs).ok, false);
  const bad = mut((o) => { o.results[1].i = 0; });
  assert.equal(bad.code, 'schema_invalid');
  assert.equal(bad.ref, '$.results.1.i');
});

test('the schema allows at most 40 results', () => {
  assert.equal(RECHECK_SCHEMA.properties.results.maxItems, 40);
});

test('docForRecheck: a bullet ref maps to its from ids, a skill group to its id', () => {
  const { refs: r } = docForRecheck(doc());
  assert.deepEqual(r.get('experience.r1.0'), ['r1.b1']);
  assert.deepEqual(r.get('skills.s1'), ['s1']);
  assert.deepEqual(r.get('open_source.0'), ['o1']);
  assert.deepEqual(r.get('projects.p1.0'), ['p1.b1']);
  assert.deepEqual(r.get('tagline'), ['tagline']);
});

test('docForRecheck: indexes follow the current doc after a bullet deletion', () => {
  const d = doc();
  d.experience[0].bullets.splice(0, 1);
  const { refs: r } = docForRecheck(d);
  assert.deepEqual(r.get('experience.r1.0'), ['r1.b2']);
  assert.equal(r.has('experience.r1.1'), false);
});

test('docForRecheck: the view has no name, contact, links, company or dates', () => {
  const d = doc();
  const text = JSON.stringify(docForRecheck(d).view);
  assert.ok(!text.includes(d.name));
  for (const c of d.contact.filter((x) => x.href || /\d/.test(x.label))) assert.ok(!text.includes(c.label), c.label);
  for (const l of d.links) assert.ok(!text.includes(l.href), l.href);
  // the company name can occur inside bullet text; the company and dates fields are not sent
  assert.ok(!/"(company|dates|location|href|contact|links|name)"/.test(text));
  for (const e of d.experience) assert.ok(!text.includes(e.dates), e.dates);
  assert.ok(text.includes('Senior Support Engineer'));
});

test('applyRecheck keeps text, kind and order; maps, dedupes and caps evidence; normalizes the note', () => {
  const out = { results: [
    { i: 2, status: 'met', evidence: ['experience.r1.0', 'experience.r1.1', 'skills.s1'], note: 'a — b' },
    { i: 0, status: 'gap', evidence: [], note: '' },
    { i: 1, status: 'partial', evidence: ['tagline'], note: 'ok' },
  ] };
  const next = applyRecheck(reqs(), out, refs);
  assert.deepEqual(next.map((r) => [r.text, r.kind]), reqs().map((r) => [r.text, r.kind]));
  assert.deepEqual(next.map((r) => r.status), ['gap', 'partial', 'met']);
  assert.deepEqual(next[2].evidence, ['r1.b1', 'r1.b2', 's1']);
  assert.equal(next[2].note, 'a, b');
  assert.deepEqual(next[0].evidence, []);
  const many = new Map([...Array(8)].map((_, k) => [`x${k}`, [`id${k}`, 'same']]));
  const capped = applyRecheck([reqs()[0]], { results: [{ i: 0, status: 'met', evidence: [...many.keys()], note: '' }] }, many);
  assert.equal(capped[0].evidence.length, 6);
  assert.equal(capped[0].evidence.filter((e) => e === 'same').length, 1);
});

test('gapsOf keeps only gaps, with text, kind and note', () => {
  assert.deepEqual(
    gapsOf([{ text: 'a', kind: 'must', status: 'gap', evidence: [], note: 'n' }, { text: 'b', kind: 'nice', status: 'met', evidence: ['x'], note: '' }]),
    [{ text: 'a', kind: 'must', note: 'n' }],
  );
});

test('buildRecheckMessage strips the nonce and sends no posting or company; feedback holds codes only', () => {
  const d = doc();
  d.summary = `Hello ${NONCE} world`;
  const r = reqs();
  r[0].text = `Needs ${NONCE} things`;
  const msg = buildRecheckMessage({ doc: d, requirements: r, nonce: NONCE, feedback: '' });
  assert.equal(msg.split(`<cv id="${NONCE}">`).length - 1, 1);
  assert.equal(msg.split(`</requirements id="${NONCE}">`).length - 1, 1);
  assert.ok(!msg.includes(`Hello ${NONCE}`));
  assert.match(msg, /^0\. \[must\] Needs {2}things$/m);
  assert.ok(!msg.includes('Initech'));
  assert.ok(!msg.includes('rejected by the validator'));
  const fb = buildRecheckMessage({ doc: d, requirements: r, nonce: NONCE, feedback: '- schema_invalid at $.results' });
  assert.match(fb, /rejected by the validator/);
  assert.match(fb, /- schema_invalid/);
});
