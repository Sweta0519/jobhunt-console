// Re-check LinkedIn-export job rows against their real description.
//
//   node scripts/rescore-linkedin.mjs [--all] [--dry-run]
//
// The one-time import took `german_required` from the skill's JSON, and for
// most rows the skill had never read the posting, so twenty German-requiring
// roles sat in the Open view flagged as fine. This opens each job page in her
// signed-in Chrome (port 9224, the LinkedIn profile), reads the description,
// and runs the same detector the board poller uses. Runs on her PC only; it
// needs her LinkedIn session, and it paces itself so it looks like a person.
//
// Default: rows never scored. --all: every open linkedin-export row.

import { select, updateEach, parseArgs } from '../workers/lib/db.mjs';
import { detectGerman } from '../workers/lib/jobfit/jobfit.mjs';
import { eligibleFrom } from '../workers/jobs.mjs';

const PORT = 9224;
const args = parseArgs();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = await select(
  'jobs',
  `?select=id,title,company,url,location,remote,german_required,eligible,score_notes&source=eq.linkedin-export&status=eq.found&closed=is.false&eligible=is.true&order=first_seen_at.desc`
);
const todo = rows.filter((r) => /linkedin\.com\/jobs\/view\//.test(r.url || '') && (args.all || !r.score_notes?.language));
console.log(`${rows.length} open linkedin-export rows, ${todo.length} to check`);

async function openTab(url) {
  const r = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  return r;
}
async function readAndClose(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const ev = (expression) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  let text = '';
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    const m = await ev(`(() => {
      // LinkedIn's job page no longer carries stable description classes; the
      // whole page is one <main>. Cut the "About the job" section out of it so
      // the similar-jobs sidebar cannot put the word German into this posting.
      // textContent ignores the collapsed "show more" state, so nothing to click.
      const all = (document.querySelector('main')?.textContent || '').replace(/\\s+/g, ' ').trim();
      const start = all.search(/About the job/i);
      if (start < 0) return all.length > 2000 ? all : '';
      const rest = all.slice(start);
      const stop = rest.search(/Set alert for similar jobs|Similar jobs|People also viewed|Looking for talent\\?|More jobs/i);
      return stop > 300 ? rest.slice(0, stop) : rest;
    })()`);
    text = m.result?.result?.value || '';
    if (text.length > 300) break;
  }
  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).catch(() => {});
  return text;
}

const updates = [];
for (const r of todo) {
  const tab = await openTab(r.url);
  const text = await readAndClose(tab);
  if (text.length < 300) { console.log(`  ?  ${r.company.padEnd(24).slice(0, 24)} ${r.title.slice(0, 44).padEnd(44)} (page did not load, ${text.length} chars)`); await sleep(2500); continue; }
  const german = detectGerman(`${r.title}\n${text}`);
  const eligible = eligibleFrom(r.location, r.remote, german.required);
  const note = (german.required ? 'GERMAN REQUIRED' : german.optional ? 'German nice-to-have' : 'no German requirement found') + (german.evidence ? ` ("${german.evidence.slice(0, 90)}")` : '');
  const flag = german.required ? 'DE ' : german.optional ? 'de?' : '   ';
  console.log(`  ${flag} ${r.company.padEnd(24).slice(0, 24)} ${r.title.slice(0, 44).padEnd(44)} ${german.evidence ? '"' + german.evidence.slice(0, 60) + '"' : ''}`);
  updates.push({
    id: r.id,
    german_required: german.required,
    eligible,
    score_notes: { ...(r.score_notes || {}), language: note },
    updated_at: new Date().toISOString(),
  });
  // A person reading job pages does not open one every second.
  await sleep(3500 + Math.random() * 2500);
}

const flagged = updates.filter((u) => u.german_required).length;
console.log(`\n${updates.length} checked, ${flagged} require German and move to the Needs German tab`);
if (args['dry-run']) { console.log('(dry run, nothing written)'); process.exit(0); }
if (updates.length) await updateEach('jobs', 'id', updates);
console.log('written');
setTimeout(() => process.exit(0), 200);
