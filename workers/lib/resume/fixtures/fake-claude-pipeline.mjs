// A stand-in for the Claude Code CLI for the pipeline test only. The scenario and
// a call-counter file are read from the posting text on stdin. Invented content.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { goodOutput } from './load.mjs';

const input = readFileSync(0, 'utf8');
const scenario = /SCENARIO=(\w+)/.exec(input)?.[1] || 'success';
const countFile = /COUNTFILE=(\S+)/.exec(input)?.[1];
let calls = 0;
if (countFile) {
  if (existsSync(countFile)) calls = readFileSync(countFile, 'utf8').split('\n').filter(Boolean).length;
  appendFileSync(countFile, `${scenario}\n`);
}

const line = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
line({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [] });
line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.1 } } } });

const good = () => {
  const o = goodOutput();
  o.summary += ' CANARY_DRAFT_x7';
  return o;
};
const bad = () => {
  const o = goodOutput();
  o.experience[0].bullets[0].text = 'Resolved 999 escalated tickets per quarter across REST and webhook integrations.';
  return o;
};

if (scenario === 'usage_limit') {
  line({ type: 'result', is_error: true, api_error_status: 429, result: 'You have hit your session limit' });
  process.exitCode = 1;
} else {
  let output = good();
  if (scenario === 'facts_fail') output = bad();
  if (scenario === 'facts_retry' && calls === 0) output = bad();
  line({ type: 'result', is_error: false, structured_output: output, modelUsage: { 'fake-model': {} } });
}
