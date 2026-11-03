import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDoc, normText } from './compose.mjs';
import { syntheticMaster, goodOutput } from './fixtures/load.mjs';

const master = syntheticMaster();

test('pinned fields come from the master even when the output carries extra data', () => {
  const out = goodOutput();
  out.name = 'Mallory';
  out.contact = [{ label: 'evil@example.invalid', href: 'https://example.invalid/x' }];
  out.links = [{ label: 'x', href: 'https://example.invalid/y' }];
  out.experience[0].company = 'Other Corp';
  out.experience[0].dates = '1999';
  out.experience[0].title = 'CEO';
  const doc = composeDoc(master, out);
  assert.equal(doc.name, master.name);
  assert.deepEqual(doc.contact, master.contact);
  assert.deepEqual(doc.links, master.links);
  assert.equal(doc.experience[0].company, 'Acme Gadgets');
  assert.equal(doc.experience[0].dates, 'Aug 2021 - May 2026');
  assert.equal(doc.experience[0].title, 'Senior Support Engineer');
  assert.deepEqual(doc.education, master.education);
  assert.deepEqual(doc.awards, master.awards);
});

test('roles stay in the master order whatever the model order', () => {
  const out = goodOutput();
  out.experience.reverse();
  const doc = composeDoc(master, out);
  assert.deepEqual(doc.experience.map((r) => r.id), ['r1', 'r2']);
});

test('languages are always present, and skill labels come from the master', () => {
  const out = goodOutput();
  out.skills = [{ group: 's2', items: ['SQL'] }];
  const doc = composeDoc(master, out);
  assert.deepEqual(doc.languages, master.languages);
  assert.deepEqual(doc.skills, [{ id: 's2', label: 'Tooling', items: ['SQL'] }]);
});

test('unknown group, role and project ids are dropped, not invented', () => {
  const out = goodOutput();
  out.skills.push({ group: 's9', items: ['X'] });
  out.experience.push({ role: 'r9', bullets: [{ text: 'Made up.', from: ['r9.b1'] }] });
  out.projects.push({ project: 'p9', bullets: [{ text: 'Made up.', from: ['p9.b1'] }] });
  const doc = composeDoc(master, out);
  assert.equal(doc.skills.length, 2);
  assert.equal(doc.experience.length, 2);
  assert.equal(doc.projects.length, 1);
});

test('long dashes in model text are normalised', () => {
  assert.equal(normText(' 2019–2021 '), '2019-2021');
  assert.equal(normText('fast — and clear'), 'fast, and clear');
});

// Invented second project, so the master has two.
const twoProjects = () => {
  const m = structuredClone(master);
  m.projects.push({
    id: 'p2', title: 'Sample Log Viewer', meta: 'Invented side project',
    bullets: [
      { id: 'p2.b1', text: 'Wrote a viewer that colours log lines by level.' },
      { id: 'p2.b2', text: 'Added a filter box for 3 log formats.' },
    ],
  });
  return m;
};

test('a project the model left out is appended with the master text', () => {
  const m = twoProjects();
  const doc = composeDoc(m, goodOutput()); // output only has p1
  assert.deepEqual(doc.projects.map((p) => p.id), ['p1', 'p2']);
  const p2 = doc.projects[1];
  assert.equal(p2.title, 'Sample Log Viewer');
  assert.equal(p2.meta, 'Invented side project');
  assert.deepEqual(p2.bullets, [
    { text: 'Wrote a viewer that colours log lines by level.', from: ['p2.b1'] },
    { text: 'Added a filter box for 3 log formats.', from: ['p2.b2'] },
  ]);
});

test('the model project order is kept when it returns all projects', () => {
  const m = twoProjects();
  const out = goodOutput();
  out.projects = [
    { project: 'p2', bullets: [{ text: 'Wrote a log viewer.', from: ['p2.b1'] }] },
    out.projects[0],
  ];
  const doc = composeDoc(m, out);
  assert.deepEqual(doc.projects.map((p) => p.id), ['p2', 'p1']);
  assert.equal(doc.projects[0].bullets[0].text, 'Wrote a log viewer.');
});

test('appended projects add no hard failure', async () => {
  const { checkFacts } = await import('./facts.mjs');
  const m = twoProjects();
  const doc = composeDoc(m, goodOutput());
  const r = checkFacts({ doc, master: m, output: goodOutput() });
  assert.deepEqual(r.hard, []);
});
