import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, '../../..');
export const RULESET_PATH = resolve(REPO_ROOT, 'rules/ruleset.json');
