import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cards, slide } from './templates.mjs';
import { posters, posterSlide } from './poster.mjs';
import { pngsToPdf } from './pdf.mjs';
import { FILES } from './paths.mjs';

export function renderHash(item) {
  return createHash('sha1').update(JSON.stringify({ card: item.card, slides: item.slides, format: item.format, size: item.size, title: item.title })).digest('hex').slice(0, 12);
}

export function htmlFor(item, cfg) {
  const ctx = { cfg, size: item.size || '4x5', deckChip: item.deckChip };
  if (item.format === 'deck') {
    const slides = item.slides || [];
    const fn = item.deckStyle === 'minimal' ? slide : posterSlide; // poster identity is the default
    return slides.map((s, i) => fn(s, i, slides.length, ctx));
  }
  if (item.format === 'card') {
    const fn = cards[item.card?.type] || posters[item.card?.type];
    if (!fn) throw new Error(`unknown card type "${item.card?.type}" (have: ${[...Object.keys(cards), ...Object.keys(posters)].join(', ')})`);
    return [fn(item.card, { ...ctx, brand: item.brand })];
  }
  return [];
}

async function shoot(page, html, path, size) {
  const height = size === '1x1' ? 1080 : size === 'poster' ? 1246 : 1350;
  await page.setViewportSize({ width: 1080, height });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check('700 40px "Plus Jakarta Sans"') && document.fonts.check('400 34px Inter'));
  // Auto-fit: measure the content's natural height once. Overflow -> scale down so the footer lands at the bottom.
  // Lots of spare room (posters) -> scale up to fill the canvas, capped at 1.3x (Chrome zoom keeps proportions).
  let zoom = 1;
  const fill = await page.evaluate(() => document.body.dataset.fill !== 'no');
  // measure the used height in screen pixels: bottom of the last non-absolute, non-footer block plus the footer's own height
  const measure = () => page.evaluate((z) => {
    // Minimal cards (data-fill="no"): the main area stretches, so only real overflow counts.
    if (document.body.dataset.fill === 'no') return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    // Real content = elements that do not stretch (flex-grow 0) and are not the footer; stretching wrappers are skipped.
    const blocks = [...document.querySelectorAll('.hdr, .z *')].filter((e) => {
      const cs = getComputedStyle(e);
      return cs.position !== 'absolute' && cs.flexGrow === '0' && !e.closest('.foot, .bottom') && e.getBoundingClientRect().height > 0;
    });
    const contentBottom = Math.max(...blocks.map((e) => e.getBoundingClientRect().bottom), 0);
    const foot = document.querySelector('.foot, .bottom');
    const footH = foot ? foot.getBoundingClientRect().height + 24 * z : 0;
    const pad = (parseFloat(getComputedStyle(document.body).paddingBottom) || 0) * z;
    return Math.ceil(contentBottom + footH + pad);
  }, zoom);
  const apply = async () => { await page.evaluate(({ z, h }) => { document.body.style.zoom = String(z); document.body.style.height = `${Math.floor(h / z)}px`; document.body.style.width = `${Math.floor(1080 / z)}px`; }, { z: zoom, h: height }); await page.waitForTimeout(80); };
  // Binary search for the largest zoom whose content fits (text re-wraps as the width changes, so a one-shot ratio oscillates).
  let used = await measure();
  if (used > height + 2 || (fill && used < height * 0.94)) {
    let lo = 0.6, hi = fill ? 1.3 : 1.0, best = 0.6;
    for (let i = 0; i < 8; i++) {
      zoom = Math.floor(((lo + hi) / 2) * 1000) / 1000;
      await apply();
      used = await measure();
      if (used <= height + 2) { best = zoom; lo = zoom; } else hi = zoom;
    }
    zoom = best; await apply();
  }
  await page.screenshot({ path, type: 'png' });
  return { fontsOk: ok, zoom };
}

// Renders item into FILES.outDir/<id>/; returns { files, fontsOk, pdf }
export async function renderItem(item, cfg, page) {
  const dir = join(FILES.outDir, item.id);
  mkdirSync(dir, { recursive: true });
  const htmls = htmlFor(item, cfg);
  const files = []; let fontsOk = true; const shrunk = [];
  for (let i = 0; i < htmls.length; i++) {
    const name = item.format === 'deck' ? `slide-${String(i + 1).padStart(2, '0')}.png` : 'card.png';
    const path = join(dir, name);
    const r = await shoot(page, htmls[i], path, item.size);
    fontsOk = r.fontsOk && fontsOk;
    if (r.zoom !== 1) shrunk.push(`${item.format === 'deck' ? `slide ${i + 1}` : 'card'} ${Math.round(r.zoom * 100)}%`);
    files.push(path);
  }
  if (shrunk.some((s) => Number(s.match(/(\d+)%/)[1]) < 82)) console.warn(`  warning: ${item.id} has too much text, shrunk to ${shrunk.join(', ')}; trim the copy`);
  else if (shrunk.length) console.log(`  fit: ${shrunk.join(', ')}`);
  writeFileSync(join(dir, 'preview.html'), htmls.map((h, i) => `<!-- slide ${i + 1} -->\n${h}`).join('\n<hr>\n'), 'utf8');
  let pdf = null;
  if (item.format === 'deck' && files.length) {
    const out = join(dir, 'carousel.pdf');
    pdf = await pngsToPdf(files, out, { title: item.documentTitle || item.title, author: cfg.author.name });
    pdf.path = out;
  }
  return { files, fontsOk, pdf, hash: renderHash(item) };
}
