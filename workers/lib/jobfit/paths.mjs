// Shim for the jobnet skill's paths module.
//
// The scoring code reads her profile and the unicorn list from a data directory
// on her PC. Both are small and stable, so they are committed next to the code
// and this points there instead.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = DATA_DIR;
