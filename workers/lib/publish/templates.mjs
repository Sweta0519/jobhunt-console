// HTML templates for cards (1080x1350 portrait by default) and carousel slides. Light theme, one accent.
// All user strings pass through esc()/rich(). Sizes in px; min body text 34px for mobile legibility.
import { esc, rich } from './esc.mjs';

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">`;

export function shell(inner, { cfg, chip = '', chipRight = '', size = '4x5', footerRight = '' }) {
  const t = cfg.theme; const a = cfg.author;
  const h = size === '1x1' ? 1080 : 1350;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:${h}px; }
  body { background:${t.bg}; color:${t.text}; font-family: Inter, 'Segoe UI', system-ui, sans-serif; display:flex; flex-direction:column; padding:72px 72px 56px; }
  h1,h2,.display { font-family: 'Plus Jakarta Sans', Inter, 'Segoe UI', sans-serif; font-weight:800; letter-spacing:-0.5px; }
  .top { display:flex; justify-content:space-between; align-items:center; min-height:56px; }
  .chip { display:inline-block; font-size:28px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:${t.accent}; background:${t.accent}14; border:2px solid ${t.accent}33; border-radius:999px; padding:10px 24px; }
  .chipRight { font-size:28px; font-weight:600; color:${t.muted}; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center; gap:36px; padding:36px 0; }
  .bottom { display:flex; justify-content:space-between; align-items:flex-end; padding-top:28px; border-top:3px solid ${t.panel}; }
  .who { font-size:30px; font-weight:700; color:${t.text}; }
  .who small { display:block; font-size:26px; font-weight:500; color:${t.muted}; margin-top:6px; }
  .bar { width:120px; height:14px; background:${t.accent}; border-radius:7px; }
  .footerRight { font-size:28px; font-weight:600; color:${t.muted}; }
  .panel { background:${t.panel}; border-radius:28px; padding:36px 40px; }
  .muted { color:${t.muted}; }
  .accent { color:${t.accent}; }
  b { font-weight:800; }
  code { font-family: Consolas, 'Cascadia Mono', monospace; background:${t.panel}; padding:2px 12px; border-radius:10px; font-size:0.92em; }
  .title { font-size:76px; line-height:1.1; }
  .lead { font-size:40px; line-height:1.4; color:${t.muted}; font-weight:500; }
  .step { display:flex; gap:28px; align-items:flex-start; }
  .num { flex:none; width:64px; height:64px; border-radius:50%; background:${t.accent}; color:#fff; font-weight:800; font-size:34px; display:flex; align-items:center; justify-content:center; font-family:'Plus Jakarta Sans', Inter, sans-serif; }
  .step .head { font-size:40px; font-weight:700; line-height:1.25; }
  .step .detail { font-size:33px; color:${t.muted}; line-height:1.4; margin-top:6px; }
  .bullets { list-style:none; display:flex; flex-direction:column; gap:22px; }
  .bullets li { font-size:38px; line-height:1.35; padding-left:52px; position:relative; }
  .bullets li::before { content:''; position:absolute; left:0; top:16px; width:24px; height:24px; border-radius:6px; background:${t.accent}; }
  .check li::before { border-radius:8px; background:#fff; border:4px solid ${t.accent}; width:30px; height:30px; top:10px; }
  .check li::after { content:''; position:absolute; left:9px; top:12px; width:12px; height:22px; border:solid ${t.accent}; border-width:0 5px 5px 0; transform:rotate(45deg); }
  .kicker { font-size:30px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:${t.muted}; }
</style></head><body data-fill="no">
  <div class="top"><span class="chip">${esc(chip)}</span><span class="chipRight">${esc(chipRight)}</span></div>
  <div class="main">${inner}</div>
  <div class="bottom"><div class="who">${esc(a.name)}<small>${esc(a.title)}${a.handle ? ` · ${esc(a.handle)}` : ''}</small></div>${footerRight ? `<div class="footerRight">${esc(footerRight)}</div>` : '<div class="bar"></div>'}</div>
</body></html>`;
}

export const cards = {
  playbook: (c, ctx) => shell(`
    <h1 class="title">${rich(c.title)}</h1>
    ${c.intro ? `<div class="lead">${rich(c.intro)}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:30px">${(c.steps || []).map((s, i) => `<div class="step"><div class="num">${i + 1}</div><div><div class="head">${rich(s.head)}</div>${s.detail ? `<div class="detail">${rich(s.detail)}</div>` : ''}</div></div>`).join('')}</div>
    ${c.takeaway ? `<div class="panel" style="font-size:36px;line-height:1.4"><b class="accent">Takeaway.</b> ${rich(c.takeaway)}</div>` : ''}
  `, { ...ctx, chip: c.chip || 'Playbook' }),

  tool: (c, ctx) => shell(`
    <div class="kicker">${esc(c.kicker || 'Tool spotlight')}</div>
    <h1 class="title accent" style="font-size:96px">${esc(c.name)}</h1>
    <div class="lead" style="color:${ctx.cfg.theme.text};font-weight:600;font-size:44px">${rich(c.tagline)}</div>
    <ul class="bullets">${(c.bullets || []).map((b) => `<li>${rich(b)}</li>`).join('')}</ul>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:30px" class="muted">${c.badge ? `<span class="chip" style="font-size:26px">${esc(c.badge)}</span>` : ''}${c.meta ? `<span>${esc(c.meta)}</span>` : ''}</div>
    ${c.url ? `<div style="font-size:30px;font-weight:600" class="accent">${esc(c.url.replace(/^https?:\/\//, ''))}</div>` : ''}
  `, { ...ctx, chip: c.chip || 'Tools for support engineers' }),

  metric: (c, ctx) => shell(`
    <div class="kicker">${esc(c.kicker || 'Support metric')}</div>
    <div class="display accent" style="font-size:${(c.big || '').length > 6 ? 120 : 200}px;line-height:1">${esc(c.big)}</div>
    <h2 style="font-size:56px;line-height:1.2">${rich(c.term)}</h2>
    <div class="lead">${rich(c.definition)}</div>
    ${c.formula ? `<div class="panel" style="font-size:36px;font-family:Consolas,'Cascadia Mono',monospace">${esc(c.formula)}</div>` : ''}
    ${c.good ? `<div style="font-size:36px;line-height:1.4"><b class="accent">What good looks like:</b> ${rich(c.good)}</div>` : ''}
    ${c.opinion ? `<div style="font-size:36px;line-height:1.4" class="muted"><b>My take:</b> ${rich(c.opinion)}</div>` : ''}
  `, { ...ctx, chip: c.chip || 'Metrics' }),

  mythfact: (c, ctx) => shell(`
    <h1 class="title" style="font-size:64px">${rich(c.title || 'Myth vs fact')}</h1>
    <div class="panel"><div class="kicker" style="text-decoration:line-through">Myth</div><div style="font-size:44px;font-weight:600;line-height:1.3;margin-top:14px" class="muted">${rich(c.myth)}</div></div>
    <div class="panel" style="background:${ctx.cfg.theme.accent}14;border:3px solid ${ctx.cfg.theme.accent}44"><div class="kicker accent">Fact</div><div style="font-size:44px;font-weight:700;line-height:1.3;margin-top:14px">${rich(c.fact)}</div></div>
    ${c.because ? `<div style="font-size:36px;line-height:1.4"><b class="accent">Why:</b> ${rich(c.because)}</div>` : ''}
  `, { ...ctx, chip: c.chip || 'Myth vs fact' }),

  checklist: (c, ctx) => shell(`
    <h1 class="title" style="font-size:68px">${rich(c.title)}</h1>
    ${c.intro ? `<div class="lead">${rich(c.intro)}</div>` : ''}
    <ul class="bullets check">${(c.items || []).map((b) => `<li>${rich(b)}</li>`).join('')}</ul>
    ${c.footnote ? `<div style="font-size:32px" class="muted">${rich(c.footnote)}</div>` : ''}
  `, { ...ctx, chip: c.chip || 'Checklist' }),
};

// Carousel slides: kinds cover | step | text | quote | cta
export function slide(s, i, total, ctx) {
  const counter = `${i + 1} / ${total}`;
  const t = ctx.cfg.theme;
  const common = { ...ctx, chip: s.chip || ctx.deckChip || 'Support engineering', chipRight: counter, footerRight: i === 0 ? 'Swipe →' : '' };
  switch (s.kind) {
    case 'cover': return shell(`
      <div class="kicker">${esc(s.kicker || 'A short guide')}</div>
      <h1 class="title" style="font-size:96px">${rich(s.title)}</h1>
      ${s.body ? `<div class="lead" style="font-size:42px">${rich(s.body)}</div>` : ''}
    `, common);
    case 'quote': return shell(`
      <div class="display accent" style="font-size:160px;line-height:0.6">“</div>
      <div style="font-size:60px;font-weight:700;line-height:1.25">${rich(s.title)}</div>
      ${s.body ? `<div class="lead">${rich(s.body)}</div>` : ''}
    `, common);
    case 'cta': return shell(`
      <h1 class="title" style="font-size:80px">${rich(s.title || 'Found this useful?')}</h1>
      <div class="lead" style="font-size:42px">${rich(s.body || `Follow ${ctx.cfg.author.name} for daily notes on support engineering, troubleshooting and the tools that make support teams faster.`)}</div>
      <div class="panel" style="font-size:38px;font-weight:600">${rich(s.cta || 'Repost if your support team should read this.')}</div>
    `, common);
    default: return shell(`
      ${s.number != null ? `<div class="num" style="width:88px;height:88px;font-size:44px">${esc(String(s.number))}</div>` : ''}
      <h2 style="font-size:70px;line-height:1.12">${rich(s.title)}</h2>
      ${s.body ? `<div style="font-size:40px;line-height:1.45">${rich(s.body)}</div>` : ''}
      ${s.bullets?.length ? `<ul class="bullets">${s.bullets.map((b) => `<li>${rich(b)}</li>`).join('')}</ul>` : ''}
      ${s.note ? `<div class="panel" style="font-size:34px;line-height:1.4" >${rich(s.note)}</div>` : ''}
    `, common);
  }
}
