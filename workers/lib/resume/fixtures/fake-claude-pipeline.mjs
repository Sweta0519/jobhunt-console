// A stand-in for the Claude Code CLI for the pipeline test only. The scenario and
// a call-counter file are read from the posting text on stdin. Invented content.
//
// A recheck call (the --json-schema argument holds "results") carries no posting.
// Its SCENARIO=... COUNTFILE=... marker is seeded into the CV summary by the test.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { goodOutput } from './load.mjs';

const input = readFileSync(0, 'utf8');
const isRecheck = (process.argv[process.argv.indexOf('--json-schema') + 1] || '').includes('"results"');
let cv = null;
if (isRecheck) {
  try { cv = JSON.parse(/<cv id="[0-9a-f]+">\n([\s\S]*?)\n<\/cv id=/.exec(input)[1]); } catch { cv = null; }
}
const marker = isRecheck ? String(cv?.summary?.text ?? '') : input;
const scenario = /SCENARIO=(\w+)/.exec(marker)?.[1] || 'success';
const countFile = /COUNTFILE=(\S+)/.exec(marker)?.[1];
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
// Every requirement met on the first ref of the CV; the bad one leaves a requirement out.
const recheckOutput = (broken) => {
  const n = (input.match(/^\d+\. \[/gm) || []).length;
  const ref = /"ref":"([^"]+)"/.exec(JSON.stringify(cv))?.[1];
  const count = broken ? n - 1 : n;
  return { results: Array.from({ length: count }, (_, i) => ({ i, status: 'met', evidence: [ref], note: 'Shown in the CV.' })) };
};

if (scenario === 'usage_limit') {
  line({ type: 'result', is_error: true, api_error_status: 429, result: 'You have hit your session limit' });
  process.exitCode = 1;
} else {
  let output = good();
  if (isRecheck) {
    output = recheckOutput(scenario === 'recheck_bad' || (scenario === 'recheck_bad_once' && calls === 0));
  } else {
    if (scenario === 'facts_fail') output = bad();
    if (scenario === 'facts_retry' && calls === 0) output = bad();
  }
  line({ type: 'result', is_error: false, structured_output: output, modelUsage: { 'fake-model': {} } });
}
