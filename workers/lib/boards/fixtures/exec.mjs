// Runs a worker as a child process against the in-memory database, with fetch
// replaced by preload-fetch.mjs so nothing reaches the internet. Tests only.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PRELOAD = pathToFileURL(fileURLToPath(new URL('./preload-fetch.mjs', import.meta.url))).href;

/** Returns { code, out, asked } where `out` is stdout and stderr together. */
export function runWorker(script, args, { url, fixtures = {}, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'bw-')); // cwd without a .env.local
  const fx = join(dir, 'fixtures.json');
  const log = join(dir, 'asked.log');
  writeFileSync(fx, JSON.stringify(fixtures));
  writeFileSync(log, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, script, ...args], {
      cwd: dir,
      env: { ...process.env, GITHUB_ACTIONS: '', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'stub-key', FETCH_FIXTURES: fx, FETCH_LOG: log, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const asked = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, out, asked });
    });
  });
}
