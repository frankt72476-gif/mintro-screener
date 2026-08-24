/**
 * Properties the output must have, checked rather than trusted.
 *
 * These are cheap enough to run on every extraction and they encode the three rules most likely to
 * be eroded by a well-meaning later edit: provenance completeness (D-087), the tier marking that
 * makes unequal evidence visible (D-100), and the absence of any score (D-088).
 *
 * A violation throws. That is deliberate — a malformed extraction reaching a check is worse than a
 * failed extraction, because the check will happily compare it.
 */

import type { ExtractionResult, ExtractedValue } from './types.js';
import { fieldSpec } from './vocabulary.js';

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

function checkValue(v: ExtractedValue, hash: string): void {
  const where = `${v.field}[${v.index}]`;

  if (fieldSpec(v.field) === undefined) {
    throw new InvariantError(`${where}: not a member of the closed vocabulary`);
  }

  // D-077: `null` means "present and empty", and nothing else. "Not found" is expressed by the
  // value not being here at all, which is why this pair is checked in both directions.
  if (v.presence === 'empty' && v.value !== null) {
    throw new InvariantError(`${where}: presence 'empty' must carry a null value`);
  }
  if (v.presence === 'present' && (v.value === null || v.value === '')) {
    throw new InvariantError(`${where}: presence 'present' must carry a non-empty value`);
  }

  if (v.provenance.document_version !== hash) {
    throw new InvariantError(`${where}: document_version does not match the document hash`);
  }
  if (!Number.isInteger(v.provenance.page) || v.provenance.page < 1) {
    throw new InvariantError(`${where}: page must be a one-based integer`);
  }

  // D-087 and D-100 together: the tier and the provenance shape are one fact stated twice, and
  // they must agree. A character-tier value missing its location is the unmarked value D-100
  // forbids — it would render as full-strength evidence while carrying page-tier backing.
  const hasLocation = 'location' in v.provenance;
  if (v.tier === 'character' && !hasLocation) {
    throw new InvariantError(`${where}: character tier requires location and snippet`);
  }
  if (v.tier === 'page' && hasLocation) {
    throw new InvariantError(`${where}: page tier cannot carry a location — see D-095`);
  }
  if (v.tier === 'character' && 'snippet' in v.provenance) {
    if (v.provenance.snippet.trim() === '') {
      throw new InvariantError(`${where}: character tier requires a non-empty verbatim snippet`);
    }
  }
}

/** D-088. Checked structurally so a future field named `score` or `certainty` is caught too. */
const FORBIDDEN_KEYS = /^(confidence|score|certainty|probability|likelihood)$/i;

function assertNoScores(node: unknown, path: string): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertNoScores(child, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.test(key)) {
      throw new InvariantError(`${path}.${key}: extraction output carries no confidence (D-088)`);
    }
    assertNoScores(child, `${path}.${key}`);
  }
}

export function assertWellFormed(result: ExtractionResult): ExtractionResult {
  if (result.outcome === 'extracted' && result.reason !== null) {
    throw new InvariantError('an extracted document carries no reason');
  }
  if (result.outcome !== 'extracted' && (result.reason === null || result.reason === '')) {
    throw new InvariantError(`outcome '${result.outcome}' must state a reason (D-092)`);
  }
  if (result.outcome !== 'extracted' && result.values.length > 0) {
    throw new InvariantError(`outcome '${result.outcome}' cannot carry values`);
  }

  const pages = new Set<number>();
  for (const p of result.pages) {
    if (pages.has(p.page)) throw new InvariantError(`page ${p.page} recorded twice`);
    pages.add(p.page);
    // D-092: a page that did nothing says why. Silence is the thing being prohibited.
    if (p.route === 'none' && (p.reason === null || p.reason === '')) {
      throw new InvariantError(`page ${p.page}: route 'none' must state a reason (D-092)`);
    }
    if (p.route !== 'none' && p.reason !== null) {
      throw new InvariantError(`page ${p.page}: only route 'none' carries a reason`);
    }
  }

  for (const v of result.values) {
    checkValue(v, result.hash);
    if (!pages.has(v.provenance.page)) {
      throw new InvariantError(`${v.field}: provenance names page ${v.provenance.page}, which has no record`);
    }
  }

  assertNoScores(result, 'result');
  return result;
}
