// Shared test data. Everything here is invented: no real person, employer or posting.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMaster } from '../parse-master.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));

export const fixtureHtml = () => readFileSync(`${dir}master.synthetic.html`, 'utf8');
export const syntheticMaster = () => parseMaster(fixtureHtml());

export const syntheticJob = { company: 'Initech Widgets', title: 'Support Engineer', location: 'Remote, Germany' };

export const syntheticPosting = [
  'We are Initech Widgets and we need a Support Engineer to debug REST integrations for customers.',
  'You will triage incidents, read logs and write clear escalations. Experience with Kubernetes is a plus.',
  'We value people who explain things well. '.repeat(30),
].join('\n');

/** A model answer that passes every check against the synthetic master. */
export function goodOutput() {
  return {
    tagline: 'Support Engineer and Widget Automation',
    summary: 'Support engineer with 4 years in B2B software. Debugs REST and webhook issues for Acme Gadgets customers.',
    skills: [
      { group: 's1', items: ['API Debugging (REST, Webhooks)', 'Log Analysis'] },
      { group: 's2', items: ['Zendesk', 'SQL'] },
    ],
    experience: [
      { role: 'r1', bullets: [
        { text: 'Resolved 120 escalated tickets per quarter across REST and webhook integrations.', from: ['r1.b1'] },
        { text: 'Wrote 15 runbooks for the on-call rota.', from: ['r1.b2'] },
      ] },
      { role: 'r2', bullets: [{ text: 'Answered customer email and chat about billing.', from: ['r2.b1'] }] },
    ],
    open_source: [{ text: 'Diagnosed webhook problems for other users on the public forum.', from: ['o1'] }],
    projects: [{ project: 'p1', bullets: [{ text: 'Built a small tool that groups incoming tickets by error signature.', from: ['p1.b1'] }] }],
    requirements: [
      { text: 'REST API debugging', kind: 'must', status: 'met', evidence: ['r1.b1'], note: 'Shown in the first role.' },
      { text: 'Kubernetes', kind: 'nice', status: 'gap', evidence: [], note: '' },
    ],
    suspicious_instructions: false,
  };
}
