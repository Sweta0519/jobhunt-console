import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaster, splitOutsideParens } from './parse-master.mjs';
import { fixtureHtml } from './fixtures/load.mjs';

test('the synthetic fixture parses into the master shape', () => {
  const m = parseMaster(fixtureHtml());
  assert.equal(m.name, 'Jordan Examplesmith');
  assert.equal(m.schema, 1);
  assert.equal(m.contact.length, 4);
  assert.equal(m.contact[1].href, 'mailto:jordan@example.invalid');
  assert.equal(m.contact[0].href, null);
  assert.equal(m.experience.length, 2);
  assert.equal(m.experience[0].bullets[1].id, 'r1.b2');
  assert.equal(m.experience[0].company, 'Acme Gadgets');
  assert.equal(m.projects[0].bullets[0].id, 'p1.b1');
  assert.deepEqual(m.awards, ['Support Star 2023', 'Runbook Author of the Year']);
});

test('one paragraph with two groups: Languages goes to its own field', () => {
  const m = parseMaster(fixtureHtml());
  assert.deepEqual(m.skills.map((g) => g.label), ['Technical Support', 'Tooling']);
  assert.equal(m.languages.label, 'Languages');
  assert.deepEqual(m.languages.items, ['English (C1)', 'German (B1)']);
});

test('a comma inside parentheses does not split an item; the trailing period goes', () => {
  assert.deepEqual(splitOutsideParens('A (b, c), D, E.'), ['A (b, c)', 'D', 'E']);
  const m = parseMaster(fixtureHtml());
  assert.ok(m.skills[0].items.includes('API Debugging (REST, Webhooks)'));
});

test('links are collected from the body, including a project title', () => {
  const m = parseMaster(fixtureHtml());
  assert.ok(m.links.some((l) => l.label === 'Triage Helper' && l.href === 'https://example.invalid/triage'));
});

test('long dashes become hyphens', () => {
  const m = parseMaster(fixtureHtml());
  assert.equal(m.experience[0].dates, 'Aug 2021 - May 2026');
  assert.equal(m.experience[1].dates, 'Jan 2018 - Sep 2019');
  assert.ok(!/[–—]/.test(JSON.stringify(m)));
});

test('a missing section throws', () => {
  const html = fixtureHtml().replace(/<h2>Awards<\/h2>[\s\S]*<\/body>/, '</body>');
  assert.throws(() => parseMaster(html), /missing section: awards/);
});

test('a role with no bullets throws', () => {
  const html = fixtureHtml().replace(/<ul>\s*<li>Answered customer email and chat about billing\.<\/li>\s*<\/ul>/, '');
  assert.throws(() => parseMaster(html), /no bullets/);
});

test('a javascript: href throws', () => {
  const html = fixtureHtml().replace('https://example.invalid/triage', 'javascript:alert(1)');
  assert.throws(() => parseMaster(html), /neither https nor mailto/);
});

test('an empty decoy span.contact inside the tagline does not hide p.contact', () => {
  const html = fixtureHtml().replace(
    '<div class="tagline">Support Engineer &amp; Widget Automation</div>',
    '<p class="tagline">Support Engineer &amp; Widget Automation<span class="contact"></span></p>'
  ).replace('<div class="contact">', '<p class="contact">').replace(/(<a href="https:\/\/example\.invalid\/jordan">[^<]*<\/a>\s*)<\/div>/, '$1</p>');
  assert.ok(html.includes('<span class="contact"></span>'));
  const m = parseMaster(html);
  assert.equal(m.contact.length, 4);
  assert.equal(m.tagline, 'Support Engineer & Widget Automation');
});

test('education without a .role wrapper parses', () => {
  const html = fixtureHtml().replace(
    /<div class="role">\s*<div class="role-title">BSc Applied Widgets<\/div>\s*<div class="meta">([^<]*)<\/div>\s*<\/div>/,
    '<div class="role-title">BSc Applied Widgets</div>\n<div class="meta">$1</div>'
  );
  assert.ok(!/<div class="role">\s*<div class="role-title">BSc/.test(html));
  const m = parseMaster(html);
  assert.equal(m.education.length, 1);
  assert.equal(m.education[0].title, 'BSc Applied Widgets');
  assert.equal(m.education[0].meta, 'University of Exampletown | 2014 - 2017');
});

test('truly empty sections still throw', () => {
  const edu = fixtureHtml().replace(/<h2>Education<\/h2>[\s\S]*?<h2>Awards<\/h2>/, '<h2>Education</h2>\n<h2>Awards</h2>');
  assert.throws(() => parseMaster(edu), /empty education section/);
  const contact = fixtureHtml().replace(/<div class="contact">[\s\S]*?<\/div>/, '<div class="contact"></div>');
  assert.throws(() => parseMaster(contact), /contact/);
});
