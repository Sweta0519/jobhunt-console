// A stand-in for the Claude Code CLI, for tests only. The scenario is the stdin
// text. It prints stream-json lines the way the real CLI does, with invented
// content, and never touches the network.
import { readFileSync } from 'node:fs';

const scenario = readFileSync(0, 'utf8').trim();
const line = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const init = (tools = ['StructuredOutput'], mcp = []) =>
  line({ type: 'system', subtype: 'init', tools, mcp_servers: mcp });
const rate = (info) => line({ type: 'rate_limit_event', rate_limit_info: info });
const allowed = { status: 'allowed', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.2 } } };
const hang = () => { setInterval(() => {}, 1000); };

if (scenario === 'success') {
  init();
  rate(allowed);
  line({ type: 'result', is_error: false, structured_output: { hello: 'world' }, modelUsage: { 'fake-model': {} } });
} else if (scenario === 'tools_bash') {
  init(['Bash', 'StructuredOutput']);
  hang();
} else if (scenario === 'mcp_server') {
  init(['StructuredOutput'], [{ name: 'x' }]);
  hang();
} else if (scenario === 'tool_use_bash') {
  init();
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
  hang();
} else if (scenario === 'limit') {
  init();
  line({ type: 'result', is_error: true, api_error_status: 429, result: 'You have hit your session limit' });
  process.exitCode = 1;
} else if (scenario === 'auth') {
  init();
  line({ type: 'result', is_error: true, api_error_status: 401, result: 'Failed to authenticate' });
  process.exitCode = 1;
} else if (scenario === 'overloaded') {
  init();
  line({ type: 'result', is_error: true, api_error_status: 529, result: 'Overloaded' });
  process.exitCode = 1;
} else if (scenario === 'model_says_limit') {
  // The model's own words mention a usage limit; the CLI reports no error.
  init();
  line({ type: 'result', is_error: false, structured_output: { note: 'you have hit your usage limit' }, result: 'usage limit reached' });
} else if (scenario === 'no_output') {
  init();
  line({ type: 'result', is_error: false, result: 'text but no structured output' });
} else if (scenario === 'hang') {
  init();
  hang();
} else {
  process.exitCode = 3;
}
