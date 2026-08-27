import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file rather than from the working directory. */
export const REPO_ROOT = resolve(here, '../../..');

/** The real rule set. The one that matters. */
export const RULESET_PATH = resolve(REPO_ROOT, 'rules/ruleset.json');

/** The standards corpus the clauses are checked against (D-139). */
export const CORPUS_PATH = resolve(REPO_ROOT, 'rules/sources/ruo-standards-v1.1.md');

export const FIXTURES = resolve(REPO_ROOT, 'fixtures/ruleset');
export const VALID_FIXTURE = resolve(FIXTURES, 'valid-minimal.json');
export const MALFORMED_DIR = resolve(FIXTURES, 'malformed');

export const malformed = (name: string): string => resolve(MALFORMED_DIR, `${name}.json`);
