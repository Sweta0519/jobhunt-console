// Headless rendering browser: the installed Chrome via playwright-core, temp profile. Never the LinkedIn session.
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function openRenderer(cfg, { cdp = false } = {}) {
  if (cdp) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.cdpPort}`, { timeout: 15000 });
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    return { page, close: async () => { await page.close().catch(() => {}); await browser.close().catch(() => {}); } };
  }
  const profile = mkdtempSync(join(tmpdir(), 'li-content-'));
  const browser = await chromium.launch({ executablePath: cfg.chromePath, headless: true, args: ['--no-first-run', '--disable-extensions'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  return { page, close: async () => { await browser.close().catch(() => {}); rmSync(profile, { recursive: true, force: true }); } };
}
