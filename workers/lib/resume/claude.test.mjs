import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { claudeArgs, claudeEnv, runClaude, classify, shouldStop, ClaudeError } from './claude.mjs';
import { DRAFT_SCHEMA } from './schema.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const call = (scenario, extra = {}) =>
  runClaude({
    bin: process.execPath, binArgs: [FAKE], token: 'test-token', schema: DRAFT_SCHEMA,
    system: 'system text', model: 'sonnet', input: scenario, ...extra,
  });
const failsWith = async (scenario, code, extra) => {
  await assert.rejects(call(scenario, extra), (e) => e instanceof ClaudeError && e.code === code, `${scenario} should be ${code}`);
};

test('claudeArgs: exact flags, no --bare, no --debug, empty --tools', () => {
  const a = claudeArgs({ schema: { type: 'object' }, system: 'S', model: 'sonnet' });
  assert.deepEqual(a, [
    '-p', '--tools', '', '--model', 'sonnet', '--effort', 'medium',
    '--output-format', 'stream-json', '--verbose',
    '--json-schema', '{"type":"object"}', '--system-prompt', 'S',
    '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--permission-prompts', 'none',
  ]);
  assert.ok(!a.includes('--bare'));
  assert.ok(!a.includes('--debug'));
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(a.includes('--verbose') && a.includes('stream-json'));
});

test('claudeEnv: the exact allow-list, no Supabase or other secrets', () => {
  const e = claudeEnv('/tmp/h', 'tok');
  assert.deepEqual(Object.keys(e).sort(), [
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER',
    'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'DISABLE_UPDATES', 'HOME', 'LANG', 'PATH', 'TMPDIR',
  ]);
  assert.ok(!Object.keys(e).some((k) => /SUPABASE|GITHUB|ANTHROPIC_API|RETRY_WATCHDOG/.test(k)));
  assert.equal(e.CLAUDE_CODE_OAUTH_TOKEN, 'tok');
});

test('a normal run returns the structured output and the rate info', async () => {
  const r = await call('success');
  assert.deepEqual(r.output, { hello: 'world' });
  assert.equal(r.rate.status, 'allowed');
  assert.equal(r.model, 'fake-model');
});

test('init listing Bash is tool_drift', async () => failsWith('tools_bash', 'tool_drift'));
test('init listing an MCP server is tool_drift', async () => failsWith('mcp_server', 'tool_drift'));
test('a Bash tool_use is tool_drift', async () => failsWith('tool_use_bash', 'tool_drift'));
test('a session limit error is usage_limit', async () => failsWith('limit', 'usage_limit'));
test('a 401 is auth', async () => failsWith('auth', 'auth'));
test('a 529 is transient', async () => failsWith('overloaded', 'transient'));
test('a result without structured output is no_output', async () => failsWith('no_output', 'no_output'));
test('a hang is timeout', async () => failsWith('hang', 'timeout', { timeoutMs: 400 }));
test('a binary that cannot start is spawn_failed', async () => {
  await assert.rejects(
    runClaude({ bin: '/definitely/not/a/binary', token: 't', schema: {}, system: 's', model: 'm', input: 'x' }),
    (e) => e.code === 'spawn_failed'
  );
});

test('model text saying "usage limit" with is_error:false is NOT a usage limit', async () => {
  const r = await call('model_says_limit');
  assert.deepEqual(r.output, { note: 'you have hit your usage limit' });
});

test('classify reads the CLI error, not free text elsewhere', () => {
  assert.equal(classify({ api_error_status: 429 }, null), 'usage_limit');
  assert.equal(classify({ result: 'x' }, { status: 'rejected' }), 'usage_limit');
  assert.equal(classify({ api_error_status: 403 }, null), 'auth');
  assert.equal(classify({ api_error_status: 503 }, null), 'transient');
  assert.equal(classify({ result: 'something else' }, null), 'cli_error');
});

test('shouldStop: overage, status, utilization, missing fields', () => {
  assert.equal(shouldStop({ isUsingOverage: true }), 'overage');
  assert.equal(shouldStop({ status: 'rejected' }), 'usage_limit');
  assert.equal(shouldStop({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.9 } } }), 'near_limit');
  assert.equal(shouldStop({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.5 } } }), null);
  assert.equal(shouldStop({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.5 } } }, 0.4), 'near_limit');
  assert.equal(shouldStop({ status: 'allowed' }), null);
  assert.equal(shouldStop(null), null);
  assert.equal(shouldStop(undefined), null);
});
