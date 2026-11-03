// Master CV + model output = the document. Pure: no imports, no env.
//
// Everything pinned (name, contact, employers, titles, locations, dates,
// education, awards, links) is copied from the master. The model contributes
// only text and ids, so it cannot alter a fact it never wrote.

/** Trim; a dash between digits becomes a hyphen, any other long dash a comma. */
export function normText(s) {
  return String(s ?? '')
    .trim()
    .replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, '-')
    .replace(/\s*[–—]\s*/g, ', ');
}

const bulletOut = (b) => ({ text: normText(b.text), from: (b.from || []).map(String) });

export function normalizeOutput(output) {
  const o = output || {};
  return {
    ...o,
    tagline: normText(o.tagline),
    summary: normText(o.summary),
    skills: (o.skills || []).map((g) => ({ ...g, items: (g.items || []).map(normText) })),
    experience: (o.experience || []).map((r) => ({ ...r, bullets: (r.bullets || []).map(bulletOut) })),
    open_source: (o.open_source || []).map(bulletOut),
    projects: (o.projects || []).map((p) => ({ ...p, bullets: (p.bullets || []).map(bulletOut) })),
    requirements: (o.requirements || []).map((r) => ({ ...r, text: normText(r.text), note: normText(r.note) })),
  };
}

export function composeDoc(master, rawOutput) {
  const output = normalizeOutput(rawOutput);
  const groups = new Map((master.skills || []).map((g) => [g.id, g]));
  const seenGroup = new Set();
  const skills = [];
  for (const g of output.skills) {
    const m = groups.get(g.group);
    if (!m || seenGroup.has(g.group)) continue;
    seenGroup.add(g.group);
    skills.push({ id: m.id, label: m.label, items: g.items });
  }

  // Roles always in master order: a CV stays reverse-chronological.
  const roleOut = new Map();
  for (const r of output.experience) if (!roleOut.has(r.role)) roleOut.set(r.role, r);
  const experience = [];
  for (const m of master.experience || []) {
    const r = roleOut.get(m.id);
    if (!r) continue;
    experience.push({
      id: m.id, title: m.title, company: m.company, location: m.location, dates: m.dates,
      bullets: r.bullets,
    });
  }

  const projOut = new Map();
  for (const p of output.projects) if (!projOut.has(p.project)) projOut.set(p.project, p);
  const mp = new Map((master.projects || []).map((p) => [p.id, p]));
  const projects = [];
  for (const p of output.projects) {
    const m = mp.get(p.project);
    if (!m || projOut.get(p.project) !== p) continue;
    projects.push({ id: m.id, title: m.title, meta: m.meta, bullets: p.bullets });
  }
  // Every master project stays in every draft, whatever the model returned.
  // One it left out is appended after the model's order, with the master's text.
  const present = new Set(projects.map((p) => p.id));
  for (const m of master.projects || []) {
    if (present.has(m.id)) continue;
    projects.push({
      id: m.id, title: m.title, meta: m.meta,
      bullets: (m.bullets || []).map((b) => ({ text: b.text, from: [String(b.id)] })),
    });
  }

  return {
    schema: 1,
    name: master.name,
    contact: master.contact,
    tagline: output.tagline,
    summary: output.summary,
    skills,
    languages: master.languages,
    experience,
    open_source: output.open_source,
    projects,
    education: master.education,
    awards: master.awards,
    links: master.links,
  };
}
