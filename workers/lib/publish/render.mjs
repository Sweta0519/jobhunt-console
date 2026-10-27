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

// Remote <img> are inlined as data URIs in Node: the runner's datacenter IP is blocked by cdn.simpleicons.org, jsdelivr is not.
const SI_HOST = 'cdn.simpleicons.org';
const SI_FETCH_HOST = process.env.SIMPLEICONS_HOST || SI_HOST; // override to test the fallback
const SI_VER = 14; // v14 still ships _data/simple-icons.json (v15+ moved it to data/)
const iconCache = new Map(); // url -> data URI | null
let siData = null; // slug -> hex

async function fetchRetry(url, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { err = e; }
  }
  throw err;
}

const titleToSlug = (t) => t.toLowerCase().replace(/\+/g, 'plus').replace(/\./g, 'dot').replace(/&/g, 'and')
  .replace(/đ/g, 'd').replace(/ħ/g, 'h').replace(/ı/g, 'i').replace(/ĸ/g, 'k').replace(/ŀ/g, 'l').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/ŧ/g, 't')
  .normalize('NFD').replace(/[^a-z0-9]/g, '');

async function brandHex(slug) {
  if (!siData) {
    const list = await (await fetchRetry(`https://cdn.jsdelivr.net/npm/simple-icons@${SI_VER}/_data/simple-icons.json`)).json();
    siData = new Map(list.map((e) => [e.slug || titleToSlug(e.title), e.hex]));
  }
  return siData.get(slug);
}

async function loadIcon(url) {
  if (iconCache.has(url)) return iconCache.get(url);
  let out = null;
  try {
    const r = await fetchRetry(url.replace(`https://${SI_HOST}/`, `https://${SI_FETCH_HOST}/`));
    out = `data:${(r.headers.get('content-type') || 'image/svg+xml').split(';')[0]};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch (e) {
    const m = url.startsWith(`https://${SI_HOST}/`) && url.slice(SI_HOST.length + 9).match(/^([^/?#]+)/);
    if (m) { // simpleicons unreachable: monochrome svg from jsdelivr + brand colour
      try {
        const slug = decodeURIComponent(m[1]);
        let svg = await (await fetchRetry(`https://cdn.jsdelivr.net/npm/simple-icons@${SI_VER}/icons/${slug}.svg`)).text();
        const hex = await brandHex(slug).catch(() => null);
        if (hex) svg = svg.replace('<svg ', `<svg fill="#${hex}" `);
        out = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      } catch (e2) { console.warn(`  warning: icon ${url} unavailable (${e.message}; fallback: ${e2.message})`); }
    } else console.warn(`  warning: image ${url} unavailable (${e.message})`);
  }
  iconCache.set(url, out);
  return out;
}

// Replaces remote <img src="https://..."> with data URIs; images that cannot be fetched are dropped (chip keeps its text).
export async function inlineImages(html) {
  const re = /<img\b[^>]*?\bsrc="(https?:\/\/[^"]+)"[^>]*>/g;
  const urls = [...new Set([...html.matchAll(re)].map((m) => m[1].replace(/&amp;/g, '&')))];
  await Promise.all(urls.map(loadIcon));
  return html.replace(re, (tag, src) => {
    const d = iconCache.get(src.replace(/&amp;/g, '&'));
    return d ? tag.replace(src, d) : '';
  });
}

async function shoot(page, html, path, size) {
  const height = size === '1x1' ? 1080 : size === 'poster' ? 1246 : 1350;
  await page.setViewportSize({ width: 1080, height });
  await page.setContent(await inlineImages(html), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // a broken image must fail the post, not get published
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src.slice(0, 80)));
  if (broken.length) throw new Error(`${broken.length} image(s) failed to load: ${broken.join(', ')}`);
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
