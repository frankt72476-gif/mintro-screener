/**
 * The rule sets the browser bundles, one per vertical, selected by `run.vertical` (D-284).
 *
 * Both files are imported through the bundler and validated through `@mintro/ruleset` — the same
 * parser the worker uses, so there is no second definition of a well-formed rule (hard constraint 1).
 * The peptide one is exactly the file `App.tsx` has always bundled.
 *
 * Parsed once each, on first use. A rule set that fails validation is returned as a failure for
 * runs of its own vertical only; a peptide run never depends on the adult file parsing.
 */

import { DEFAULT_VERTICAL, isVertical, parseRuleset, type Ruleset, type Vertical } from '@mintro/ruleset';
import peptidesJson from '../../../../rules/ruleset.json';
import adultAiJson from '../../../../rules/ruleset-adult-ai.json';

export type BundledRuleset = { readonly ok: true; readonly value: Ruleset } | { readonly ok: false; readonly message: string };

const BUNDLED: Readonly<Record<Vertical, { readonly json: unknown; readonly path: string }>> = {
  peptides: { json: peptidesJson, path: 'rules/ruleset.json' },
  adult_ai: { json: adultAiJson, path: 'rules/ruleset-adult-ai.json' },
};

const parsed = new Map<Vertical, BundledRuleset>();

/** The bundled rule set for a vertical, validated. */
export function rulesetFor(vertical: Vertical): BundledRuleset {
  const cached = parsed.get(vertical);
  if (cached !== undefined) return cached;

  const { json, path } = BUNDLED[vertical];
  let result: BundledRuleset;
  try {
    result = { ok: true, value: parseRuleset(json, `bundled ${path}`) };
  } catch (cause) {
    result = { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
  parsed.set(vertical, result);
  return result;
}

/**
 * A stored run's vertical, read from its row.
 *
 * Absent means `peptides`: a run read from the local report directory has no row, and every run
 * before 0088 is a peptide run. A value outside the vocabulary is refused rather than mapped, because
 * reading an unknown vertical as peptides would resolve a run against the wrong rules.
 */
export function runVertical(value: unknown): Vertical {
  if (value === undefined || value === null) return DEFAULT_VERTICAL;
  if (!isVertical(value)) throw new Error(`the run records vertical '${String(value)}', which this build does not know`);
  return value;
}
