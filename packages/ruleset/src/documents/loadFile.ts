/**
 * Reading the two Documents Check rule files from disk.
 *
 * Split from `load.ts` for the same reason the Site Check loader is: the browser must never pull
 * `node:fs` into its bundle, and a single `node:fs` import anywhere in the module graph breaks the
 * build even when the function is never called.
 */

import { readFileSync } from 'node:fs';
import { DocumentsValidationError, parseDocumentsRules, type DocumentsFile, type DocumentsRules } from './load.js';

export const CHECKS_PATH = 'rules/documents.checks.json';
export const TEMPLATES_PATH = 'rules/documents.templates.json';

function readJson(path: string, file: DocumentsFile): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new DocumentsValidationError([
      { file, path: '(file)', message: `could not be read: ${(error as Error).message}` },
    ]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DocumentsValidationError([
      { file, path: '(file)', message: `is not valid JSON: ${(error as Error).message}` },
    ]);
  }
}

/**
 * Reads, parses and validates both files together.
 *
 * Both, always — the invariants that matter are cross-file, so validating one alone would pass a
 * template naming a slot that does not exist.
 *
 * @throws {DocumentsValidationError} carrying every defect, each naming its file.
 */
export function loadDocumentsRules(
  checksPath: string = CHECKS_PATH,
  templatesPath: string = TEMPLATES_PATH,
): DocumentsRules {
  return parseDocumentsRules(
    readJson(checksPath, 'documents.checks.json'),
    readJson(templatesPath, 'documents.templates.json'),
  );
}
