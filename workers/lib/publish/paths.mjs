// Stand-in for the content skill's paths module.
//
// The poster and render code was written against a data directory on her PC.
// Rather than rewrite it, the worker creates a scratch directory, fetches the
// two brand assets into it, and points this shim there. The rendering code then
// runs unchanged, which is the whole reason posters look identical to the ones
// she has been publishing.

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.PUBLISH_WORK_DIR || join(tmpdir(), 'jobhunt-publish');
mkdirSync(DATA_DIR, { recursive: true });

export const FILES = {
  outDir: join(DATA_DIR, 'out'),
};
mkdirSync(FILES.outDir, { recursive: true });
