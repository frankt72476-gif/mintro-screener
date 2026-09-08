/**
 * Reading the angle set and the eye-test rubric from disk.
 *
 * Split from `angles.ts` for the reason `loadFile.ts` is split from `load.ts`: the browser must
 * never pull `node:fs` into its bundle, and there is one parser rather than one per environment.
 *
 * The rubric is read here only for its **item ids**. The angle set names eye-test items, so the
 * validator has to know which exist — but nothing in this package parses a rubric or cares what a
 * question says. `packages/engine` owns that.
 */

import { readFileSync } from 'node:fs';
import { parseAngleSet, AngleSetValidationError, type AngleSet } from './angles.js';
import type { Ruleset } from './schema.js';

export const ANGLES_PATH = 'rules/angles.json';
export const EYETEST_PATH = 'rules/eyetest.json';

/**
 * The eye-test rubric's item ids, and nothing else from it.
 *
 * Returns `null` when the file cannot be read or is not the shape it should be, so the caller can
 * report *that* rather than reporting every angle's items as unknown — a missing rubric would
 * otherwise surface as fourteen defects about ids that are perfectly correct.
 */
export function eyeTestItemIds(path = EYETEST_PATH): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const ids = items
    .map((item) => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string');
  return ids.length === items.length ? ids : null;
}

/**
 * Reads, parses and validates the angle set against a rule set.
 *
 * @throws {AngleSetValidationError} if the file is unreadable, is not JSON, or is invalid.
 */
export function loadAngleSetFile(
  ruleset: Ruleset,
  path = ANGLES_PATH,
  rubricPath = EYETEST_PATH,
): AngleSet {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new AngleSetValidationError(path, [
      { path: '(file)', message: `could not be read: ${(error as Error).message}` },
    ]);
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new AngleSetValidationError(path, [
      { path: '(file)', message: `is not valid JSON: ${(error as Error).message}` },
    ]);
  }

  const items = eyeTestItemIds(rubricPath);
  if (items === null) {
    throw new AngleSetValidationError(path, [
      {
        path: '(rubric)',
        message: `${rubricPath} could not be read for its item ids, so eyeTestItemIds cannot be checked. Reported here rather than as a defect on every angle.`,
      },
    ]);
  }

  return parseAngleSet(document, ruleset, items, path);
}

/** As {@link loadAngleSetFile}, returning the failure instead of throwing it. */
export function tryLoadAngleSetFile(
  ruleset: Ruleset,
  path = ANGLES_PATH,
  rubricPath = EYETEST_PATH,
):
  | { readonly ok: true; readonly angles: AngleSet }
  | { readonly ok: false; readonly error: AngleSetValidationError } {
  try {
    return { ok: true, angles: loadAngleSetFile(ruleset, path, rubricPath) };
  } catch (error) {
    if (error instanceof AngleSetValidationError) return { ok: false, error };
    throw error;
  }
}
