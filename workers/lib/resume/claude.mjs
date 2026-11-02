// One headless Claude Code call with no tools.
//
// Authenticates with CLAUDE_CODE_OAUTH_TOKEN. Never add --bare: it does not read
// the OAuth token. Never add --debug. stderr is ignored and stdout stays in
// memory, so nothing the model says can reach a log.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class ClaudeError extends Error {
  constructor(code, info) { super(code); this.code = code; this.rate = info?.rate ?? null; }
}
const EXPECTED_TOOLS = ['StructuredOutput'];
const TIMEOUT_MS = 300_000;
const MAX_STDOUT = 8 * 1024 * 1024;

export function claudeArgs({ schema, system, model }) {
  return ['-p', '--tools', '', '--model', model, '--effort', 'medium',
    '--output-format', 'stream-json', '--verbose',
    '--json-schema', JSON.stringify(schema), '--system-prompt', system,
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--permission-prompts', 'none'];
}

/** The whole environment of the child. Allow-list, never a copy of process.env. */
export function claudeEnv(home, token) {
  return { PATH: '/usr/bin:/bin', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), TMPDIR: home, LANG: 'C.UTF-8',
    CLAUDE_CODE_OAUTH_TOKEN: token,
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' };
}

/**
 * `binArgs` and `timeoutMs` exist so a test can run a fake binary through
 * node; the worker never sets them.
 */
export function runClaude({ bin, binArgs = [], token, schema, system, model, input, timeoutMs = TIMEOUT_MS }) {
  const home = mkdtempSync(join(tmpdir(), 'cc-'));   // also the cwd: no CLAUDE.md, .mcp.json or .claude/ can be found
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...binArgs, ...claudeArgs({ schema, system, model })],
      { cwd: home, env: claudeEnv(home, token), stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '', size = 0, result = null, rate = null, fail = null, settled = false;
    const kill = (code) => { fail = fail || code; child.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);

    const onEvent = (e) => {
      if (e.type === 'system' && e.subtype === 'init') {
        const same = JSON.stringify(e.tools) === JSON.stringify(EXPECTED_TOOLS) && (e.mcp_servers || []).length === 0;
        if (!same) kill('tool_drift');
      } else if (e.type === 'assistant') {
        for (const c of e.message?.content || []) {
          if (c.type === 'tool_use' && c.name !== 'StructuredOutput') kill('tool_drift');
        }
      } else if (e.type === 'rate_limit_event') rate = e.rate_limit_info || rate;
      else if (e.type === 'result') result = e;
    };
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > MAX_STDOUT) return kill('output_too_large');
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { if (line.trim()) onEvent(JSON.parse(line)); } catch { /* unparsable lines are ignored, never printed */ }
      }
    });
    child.on('error', () => { fail = fail || 'spawn_failed'; finish(null); });
    child.stdin.on('error', () => {});
    child.on('close', (code) => finish(code));

    function finish(code) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      rmSync(home, { recursive: true, force: true });
      if (fail) return reject(new ClaudeError(fail, { rate }));
      if (result?.is_error || code !== 0 || !result) return reject(new ClaudeError(classify(result, rate), { rate }));
      if (!result.structured_output) return reject(new ClaudeError('no_output', { rate }));
      resolve({ output: result.structured_output, rate, model: result.modelUsage ? Object.keys(result.modelUsage)[0] : model });
    }

    child.stdin.end(input);
  });
}

/**
 * Called only when the CLI itself reports an error, so text in a posting cannot
 * trigger it through the model's answer. Message wording is from the CLI error docs.
 */
export function classify(result, rate) {
  const t = String(result?.result || '');
  const status = result?.api_error_status;
  if (rate && rate.status && rate.status !== 'allowed') return 'usage_limit';
  if (status === 429 || /hit your .*limit|usage limit|rate limit/i.test(t)) return 'usage_limit';
  if (status === 401 || status === 403 || /invalid api key|oauth token|failed to authenticate|please run \/login/i.test(t)) return 'auth';
  if (status === 529 || (status >= 500 && status < 600) || /overloaded/i.test(t)) return 'transient';
  return 'cli_error';
}

/** After a successful call: is it still right to start another one? */
export function shouldStop(rate, stopAt = 0.85) {
  if (!rate) return null;
  if (rate.isUsingOverage === true) return 'overage';
  if (rate.status && rate.status !== 'allowed') return 'usage_limit';
  for (const w of Object.values(rate.unifiedWindows || {})) {
    if (typeof w?.utilization === 'number' && w.utilization >= stopAt) return 'near_limit';
  }
  return null;
}
