// A stand-in for the Claude Code CLI for the applications pipeline test only.
// The scenario and a call-counter file are read from the posting text on stdin.
// Everything here is invented.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const input = readFileSync(0, 'utf8');
const scenario = /SCENARIO=(\w+)/.exec(input)?.[1] || 'success';
const countFile = /COUNTFILE=(\S+)/.exec(input)?.[1];
let calls = 0;
if (countFile) {
  if (existsSync(countFile)) calls = readFileSync(countFile, 'utf8').split('\n').filter(Boolean).length;
  appendFileSync(countFile, `${scenario}\n`);
}

const line = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
line({ type: 'system', subtype: 'init', tools: scenario === 'drift' ? ['Bash', 'StructuredOutput'] : ['StructuredOutput'], mcp_servers: [] });
line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: scenario === 'overage', unifiedWindows: { five_hour: { utilization: scenario === 'near_limit' ? 0.9 : 0.1 } } } });

const questions = JSON.parse(/<form_questions id="[0-9a-f]+">\n([\s\S]*?)\n<\/form_questions/.exec(input)?.[1] || '[]');
const wantsCover = input.includes('A cover letter is asked for');
const text = 'I debugged REST and webhook issues for customers. CANARY_ANS_x7';

function answerFor(q) {
  const base = { q: q.id, cls: 'drafted', bank_key: '', text, from: ['r1.b1'], option_ids: [], asked_terms: [] };
  const prod = (t) => ({ ...base, cls: 'product', from: [], text: t });
  if (/PRODUCTOK/.test(q.label)) return prod('Group the metric by day of week, and verify the setting name in the documentation. CANARY_ANS_x7');
  if (/PRODUCTURL/.test(q.label)) return prod('See https://example.test/docs for the limit.');
  if (/PRODUCTCLAIM/.test(q.label)) return prod('In my experience this works. I have used it daily.');
  if (/PRODUCTYOUR/.test(q.label)) return prod('Group the metric by day of week.');
  if (/BADNUM/.test(q.label)) return { ...base, text: 'I handled 999 tickets.' };
  if (/n8n|Terraform/.test(q.label)) return { ...base, from: ['s2'] };
  if (q.options?.length) return { ...base, text: '', from: ['s1'], option_ids: [q.options[0].id] };
  if (/FIXEDBYMODEL/.test(q.label)) return { ...base, cls: 'fixed', bank_key: 'city', text: '', from: [] };
  return base;
}

if (scenario === 'usage_limit') {
  line({ type: 'result', is_error: true, api_error_status: 429, result: 'You have hit your session limit' });
  process.exitCode = 1;
} else if (scenario === 'auth') {
  line({ type: 'result', is_error: true, api_error_status: 401, result: 'Failed to authenticate' });
  process.exitCode = 1;
} else if (scenario === 'bad_schema') {
  line({ type: 'result', is_error: false, structured_output: { answers: 'nope' }, modelUsage: { 'fake-model': {} } });
} else {
  const output = {
    answers: questions.map(answerFor),
    cover_letter: { paragraphs: wantsCover ? [
      { text: 'I debugged REST and webhook issues for customers.', from: ['r1'] },
      { text: scenario === 'cover_fail' ? 'I wrote 999 runbooks.' : 'Your team builds widgets and I like that. CANARY_ANS_x7', from: ['r1.b1'] },
    ] : [] },
    suspicious_instructions: false,
  };
  line({ type: 'result', is_error: false, structured_output: output, modelUsage: { 'fake-model': {} } });
}
