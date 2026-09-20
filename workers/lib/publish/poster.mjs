// Poster templates: dense infographic style (soft gradient background, white cards with pastel borders,
// numbered badges, bold labels, a highlighted word in the title, author photo top-left).
// Types: grid | compare | table | map | dashboard   (item.card.type)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc, rich } from './esc.mjs';
import { DATA_DIR } from './paths.mjs';

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">`;

// Own identity (not the reference's lavender/blue): mint-to-sky gradient, teal pill, warm card palette.
export const THEME = {
  bg: 'linear-gradient(160deg, #F0FDFA 0%, #E6F6FF 50%, #FFF4EC 100%)',
  blobs: ['#99F6E4', '#BAE6FD', '#FED7AA'],
  text: '#0F2A3A', textMuted: '#4A5B6A', header: '#0F5F63',
  pill: '#0F766E', pillText: '#FFFFFF',
  label: '#FFEDD5', labelText: '#9A3412',
  cardBg: 'rgba(255,255,255,.94)', shadow: 'rgba(15,95,99,.10)',
};
export const PALETTE = ['#0F9F8F', '#F97066', '#F59E0B', '#7C6CF2', '#0EA5E9', '#E0559A', '#65A30D'];
const color = (i) => PALETTE[i % PALETTE.length];

let avatarCache;
function avatar() {
  if (avatarCache !== undefined) return avatarCache;
  const p = join(DATA_DIR, 'avatar.jpg');
  avatarCache = existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : '';
  return avatarCache;
}

// "The [[Roadmap]] to X" -> highlighted pill around Roadmap
export function title(t) {
  return esc(t).replace(/\[\[(.+?)\]\]/g, '<span class="hl">$1</span>');
}
// **Label:** value -> bold label with soft green highlight, like the reference "Perfect for:" tags
export function label(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b class="lbl">$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function posterShell(inner, { cfg, size = '4x5', brand = '' }) {
  const a = cfg.author;
  const h = size === '1x1' ? 1080 : size === 'tall' ? 1350 : 1246; // 1246 ≈ 800x923 like the reference
  const av = avatar();
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:${h}px; }
  body { position:relative; overflow:hidden; color:${THEME.text}; font-family: Inter, 'Segoe UI', system-ui, sans-serif;
         background: ${THEME.bg}; padding:44px 48px 40px; display:flex; flex-direction:column; }
  .blob { position:absolute; border-radius:50%; filter:blur(70px); opacity:.5; z-index:0; }
  .b1 { width:520px; height:520px; background:${THEME.blobs[0]}; top:-160px; left:-120px; }
  .b2 { width:460px; height:460px; background:${THEME.blobs[2]}; bottom:-140px; right:-120px; }
  .b3 { width:380px; height:380px; background:${THEME.blobs[1]}; top:40%; right:-160px; }
  .z { position:relative; z-index:1; }
  .hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:26px; }
  .who { display:flex; align-items:center; gap:14px; font-size:26px; font-weight:600; color:${THEME.header}; }
  .who img { width:52px; height:52px; border-radius:50%; object-fit:cover; border:3px solid #fff; box-shadow:0 2px 8px ${THEME.shadow}; }
  .who .ph { width:52px; height:52px; border-radius:50%; background:${THEME.pill}; }
  .brand { font-size:24px; font-weight:700; color:${THEME.header}; opacity:.85; }
  h1 { font-family:'Plus Jakarta Sans', Inter, sans-serif; font-weight:700; font-size:62px; line-height:1.15; text-align:center; letter-spacing:-0.5px; color:${THEME.text}; margin-bottom:10px; }
  .sub { text-align:center; font-size:30px; color:${THEME.textMuted}; margin:0 0 28px; line-height:1.35; }
  .hl { background:${THEME.pill}; color:${THEME.pillText}; border-radius:14px; padding:0 18px; box-decoration-break:clone; }
  .lbl { background:${THEME.label}; color:${THEME.labelText}; border-radius:8px; padding:1px 8px; font-weight:700; }
  code { font-family:Consolas,'Cascadia Mono',monospace; background:#E6F6FF; padding:1px 8px; border-radius:6px; }
  .card { background:${THEME.cardBg}; border-radius:22px; border:3px solid var(--c, #99F6E4); padding:22px 24px; box-shadow:0 6px 20px ${THEME.shadow}; position:relative; }
  .num { position:absolute; top:-18px; left:-18px; width:44px; height:44px; border-radius:50%; background:var(--c,${THEME.pill}); color:#fff; font-weight:800; font-size:24px; display:flex; align-items:center; justify-content:center; border:3px solid #fff; }
  .card h3 { font-family:'Plus Jakarta Sans', Inter, sans-serif; font-size:30px; font-weight:700; color:var(--c,${THEME.pill}); margin-bottom:10px; filter:saturate(1.1) brightness(.85); }
  .card p, .card li { font-size:24px; line-height:1.4; color:#1F2937; }
  .card ul { list-style:none; display:flex; flex-direction:column; gap:6px; }
  .card li::before { content:'•'; color:var(--c,${THEME.pill}); font-weight:800; margin-right:10px; }
  .sect { text-align:center; font-family:'Plus Jakarta Sans', Inter, sans-serif; font-weight:700; font-size:30px; color:var(--c,${THEME.pill}); margin:22px 0 14px; display:flex; align-items:center; gap:18px; }
  .sect::before, .sect::after { content:''; flex:1; height:3px; background:var(--c,${THEME.pill}); opacity:.45; border-radius:2px; }
  .grid { display:grid; gap:22px 22px; }
  .foot { margin-top:auto; padding-top:22px; text-align:center; font-size:22px; color:${THEME.textMuted}; }
  .pill { background:var(--c,${THEME.pill}); color:#fff; border-radius:16px; padding:14px 18px; font-weight:700; font-size:24px; text-align:center; }
  .box { background:${THEME.cardBg}; border:2.5px solid var(--c,#99F6E4); border-radius:14px; padding:12px 16px; font-size:22px; line-height:1.35; }
  .emoji { font-size:30px; line-height:1; }
</style></head><body>
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
  <div class="hdr z"><div class="who">${av ? `<img src="${av}">` : '<span class="ph"></span>'}<span>${esc(a.name)}</span></div><div class="brand">${esc(brand || a.title)}</div></div>
  <div class="z" style="display:flex;flex-direction:column;flex:1">${inner}</div>
</body></html>`;
}

// Carousel slide in the poster identity. kinds: cover | step | text | quote | cta
export function posterSlide(s, i, total, ctx) {
  const c = color(Math.max(0, i - 1));
  const counter = `<div style="position:absolute;right:0;top:0;font-size:24px;font-weight:700;color:${THEME.header};opacity:.8">${i + 1} / ${total}</div>`;
  const swipe = i === 0 ? `<div class="foot" style="font-weight:700;color:${THEME.pill}">Swipe →</div>` : i === total - 1 ? '' : `<div class="foot">${i + 1} of ${total} · swipe →</div>`;
  const body = (() => {
    switch (s.kind) {
      case 'cover': return `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px">
          ${s.kicker ? `<div class="sect" style="--c:${THEME.pill};margin:0">${esc(s.kicker)}</div>` : ''}
          <h1 style="font-size:88px;text-align:left;line-height:1.08">${title(s.title)}</h1>
          ${s.body ? `<div class="sub" style="text-align:left;font-size:36px;margin:0">${label(s.body)}</div>` : ''}
          ${s.tags?.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">${s.tags.map((t, k) => `<span class="pill" style="--c:${color(k)};font-size:22px;padding:10px 18px">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>`;
      case 'quote': return `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:24px">
          <div class="card" style="--c:${c};padding:44px 40px"><div style="font-size:120px;line-height:.6;color:${c};font-family:'Plus Jakarta Sans',sans-serif">“</div>
          <div style="font-size:50px;font-weight:700;line-height:1.25;margin-top:10px">${label(s.title)}</div>
          ${s.body ? `<p style="margin-top:18px;font-size:28px;color:${THEME.textMuted}">${label(s.body)}</p>` : ''}</div>
        </div>`;
      case 'cta': return `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px">
          <h1 style="font-size:72px;text-align:left">${title(s.title || 'Found this useful?')}</h1>
          <div class="sub" style="text-align:left;font-size:34px;margin:0">${label(s.body || `Follow ${ctx.cfg.author.name} for notes on support engineering, troubleshooting and the tools that make support teams faster.`)}</div>
          <div class="card" style="--c:${THEME.pill}"><p style="font-size:30px;font-weight:700">${label(s.cta || 'Repost if your support team should read this.')}</p></div>
        </div>`;
      default: return `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px">
          <div class="card" style="--c:${c};padding:36px 36px 32px">
            ${s.number != null ? `<div class="num" style="width:64px;height:64px;font-size:32px;top:-24px;left:-24px">${esc(String(s.number))}</div>` : ''}
            <h3 style="font-size:52px;line-height:1.12;margin-bottom:18px">${label(s.title)}</h3>
            ${s.body ? `<p style="font-size:32px;line-height:1.45">${label(s.body)}</p>` : ''}
            ${s.bullets?.length ? `<ul style="margin-top:18px;gap:12px">${s.bullets.map((b) => `<li style="font-size:30px">${label(b)}</li>`).join('')}</ul>` : ''}
          </div>
          ${s.note ? `<div class="box" style="--c:${c};font-size:28px;padding:18px 22px">${label(s.note)}</div>` : ''}
        </div>`;
    }
  })();
  return posterShell(`<div style="position:relative;display:flex;flex-direction:column;flex:1">${counter}${body}${swipe}</div>`, { ...ctx, size: 'tall' });
}

export const posters = {
  // sections: [{ title, cards: [{ title, lines: ["**Goal:** ...", "..."], bullets: [] }] }], columns 2..3
  grid: (c, ctx) => {
    const cols = c.columns || 3; let n = 0;
    return posterShell(`
      <h1>${title(c.title)}</h1>${c.subtitle ? `<div class="sub">${label(c.subtitle)}</div>` : ''}
      ${(c.sections || []).map((s, si) => `
        ${s.title ? `<div class="sect" style="--c:${color(si)}">${esc(s.title)}</div>` : ''}
        <div class="grid" style="grid-template-columns:repeat(${cols},1fr)">${(s.cards || []).map((k) => `<div class="card" style="--c:${color(si)}">${c.numbered === false ? '' : `<div class="num">${++n}</div>`}${k.emoji ? `<div class="emoji">${esc(k.emoji)}</div>` : ''}<h3>${esc(k.title)}</h3>${(k.lines || []).map((l) => `<p>${label(l)}</p>`).join('')}${k.bullets?.length ? `<ul>${k.bullets.map((b) => `<li>${label(b)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`).join('')}
      ${c.footer ? `<div class="foot">${label(c.footer)}</div>` : ''}
    `, ctx);
  },

  // left/right labels + rows [{ mid, left, right }]
  compare: (c, ctx) => posterShell(`
      <h1>${title(c.title)}</h1>${c.subtitle ? `<div class="sub">${label(c.subtitle)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 300px 1fr;gap:14px 18px;align-items:center;margin-top:8px">
        <div class="pill" style="--c:#0F9F8F">${esc(c.leftLabel)}</div><div></div><div class="pill" style="--c:#F97066">${esc(c.rightLabel)}</div>
        ${(c.rows || []).map((r) => `<div class="box" style="--c:#99E6DC">${label(r.left)}</div><div class="pill" style="--c:#7C6CF2;font-size:22px">${esc(r.mid)}</div><div class="box" style="--c:#FECDC8">${label(r.right)}</div>`).join('')}
      </div>
      ${c.footer ? `<div class="foot">${label(c.footer)}</div>` : ''}
    `, ctx),

  // columns: ["Category", ...], rows: [{ label, emoji?, cells: [...] }]
  table: (c, ctx) => {
    const cols = c.columns || []; const w = `220px repeat(${cols.length - 1}, 1fr)`;
    return posterShell(`
      <h1>${title(c.title)}</h1>${c.subtitle ? `<div class="sub">${label(c.subtitle)}</div>` : ''}
      <div style="display:grid;grid-template-columns:${w};gap:12px 14px;margin-top:6px">
        ${cols.map((h, i) => `<div class="pill" style="--c:${i === 0 ? '#0F5F63' : color(i)};font-size:26px">${esc(h)}</div>`).join('')}
        ${(c.rows || []).map((r) => `<div class="box" style="--c:#CCE7EA;font-weight:600">${r.emoji ? `<span class="emoji" style="font-size:24px;margin-right:8px">${esc(r.emoji)}</span>` : ''}${esc(r.label)}</div>${(r.cells || []).map((cell, i) => `<div class="box" style="--c:${color(i + 1)}33;background:${color(i + 1)}14">${label(cell)}</div>`).join('')}`).join('')}
      </div>
      ${c.footer ? `<div class="foot">${label(c.footer)}</div>` : ''}
    `, ctx);
  },

  // vertical progression: levels [{ title, lines[], side: { title, items[] }, emoji }] rendered top = highest when reverse
  map: (c, ctx) => posterShell(`
      <h1>${title(c.title)}</h1>${c.subtitle ? `<div class="sub">${label(c.subtitle)}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:18px">
        ${(c.levels || []).map((l, i) => { const idx = c.reverse ? c.levels.length - i : i + 1; const col = color(c.reverse ? c.levels.length - 1 - i : i); return `
        <div style="display:grid;grid-template-columns:1.55fr 1fr;gap:18px;align-items:stretch">
          <div class="card" style="--c:${col}"><div class="num">${idx}</div>${l.emoji ? `<div class="emoji" style="position:absolute;right:18px;top:14px">${esc(l.emoji)}</div>` : ''}<h3>${esc(l.title)}</h3>${(l.lines || []).map((x) => `<p>${label(x)}</p>`).join('')}${l.tag ? `<p style="margin-top:8px"><span class="lbl" style="background:${col}22;color:#1E1B4B">${esc(l.tag)}</span></p>` : ''}</div>
          ${l.side ? `<div class="card" style="--c:${col}"><p style="font-weight:700;margin-bottom:4px">${esc(l.side.title || '')}</p><ul>${(l.side.items || []).map((x) => `<li>${label(x)}</li>`).join('')}</ul></div>` : '<div></div>'}
        </div>`; }).join('')}
      </div>
      ${c.footer ? `<div class="foot">${label(c.footer)}</div>` : ''}
    `, ctx),

  // panels: [{ title, span?: 1|2, items: ["**Label:** text"], color? }]
  dashboard: (c, ctx) => posterShell(`
      <h1>${title(c.title)}</h1>${c.subtitle ? `<div class="sub">${label(c.subtitle)}</div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(${c.columns || 3},1fr)">
        ${(c.panels || []).map((p, i) => `<div class="card" style="--c:${p.color || color(i)};grid-column:span ${p.span || 1}"><h3>${esc(p.title)}</h3><ul>${(p.items || []).map((x) => `<li>${label(x)}</li>`).join('')}</ul></div>`).join('')}
      </div>
      ${c.footer ? `<div class="foot">${label(c.footer)}</div>` : ''}
    `, ctx),
};
