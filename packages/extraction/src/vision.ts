/**
 * The page-tier reader: one rasterised page in, values out.
 *
 * **The prompt and the response schema are authored fresh** (D-086 amendment). Nothing here is
 * ported. The surveyed app's schema is ~70 keys shaped as another product's `document_requests`
 * titles, and — decisively — it instructs the model to "use null for any field the document does
 * not show", which makes *not present*, *present and blank*, *present and illegible* and *the
 * model declined* into one value. D-077 turns on keeping those apart, and the distinction is
 * destroyed at the only point where it exists. What was adopted from that codebase is the
 * transport, and it lives in `anthropic.ts`.
 *
 * Two consequences of D-095 and D-100 are baked into the prompt rather than left to review:
 *
 * - the model is shown **one page**, so the page number is a property of the request and never
 *   something the model reports;
 * - the model is **never asked where on the page it looked**. A bounding box from a model is an
 *   attestation about its own provenance, not a capture of it, so page tier stops at the page.
 *
 * And nothing here asks for confidence (D-088). There is no threshold for one to clear.
 */

import type { ExtractedValue, Provenance } from './types.js';
import { FIELDS, fieldSpec } from './vocabulary.js';

function fieldCatalogue(): string {
  return FIELDS.map((f) => {
    const repeat = f.repeated ? ', repeated — one entry per occurrence, index from 0' : '';
    return `  ${f.id} (${f.kind}${repeat})`;
  }).join('\n');
}

export const VISION_SYSTEM_PROMPT = `You read a single page of a business document and report the values that are visibly present on it.

You will be shown exactly one page image. Report only what is on this page. Do not infer values from what a document of this kind usually contains, and do not carry anything over from other pages you cannot see.

Return a single JSON object and nothing else. No prose, no explanation, no markdown fencing. It must parse with JSON.parse().

{
  "fields": [
    { "field": "<one of the field ids below>", "index": <integer, 0 unless the field is repeated>, "presence": "present" | "empty", "value": "<verbatim text>" | null }
  ]
}

Field ids:
${fieldCatalogue()}

Rules, and the first two matter more than the rest:

1. ABSENCE IS EXPRESSED BY OMISSION. If this page does not show a field, leave it out of the array entirely. Never add an entry with a null value to say a field is missing.

2. "empty" IS A DIFFERENT OBSERVATION FROM ABSENT. Use presence "empty" with value null only when the page shows the field — a printed label, a blank line, a box — and nothing has been filled in. If the field is not on the page at all, omit it.

3. Transcribe verbatim. Copy the characters as printed, including punctuation and case. Do not normalise, expand abbreviations, reformat dates, or strip currency symbols.

4. Never guess. If you cannot read every character of a number, omit the field rather than reporting a partial or reconstructed value. An unreadable value is not a value.

5. Repeated fields: one entry per occurrence, index counting from 0 in the order they appear down the page. Do not pad with blank entries.

6. Report only the field ids listed above. Anything else on the page is not asked for and must not be returned.`;

export const VISION_USER_PROMPT =
  'Report the listed fields that are visibly present on this page. Omit any field this page does not show.';

/** Strips a ```json fence if the model wrapped its answer in one. */
export function stripJsonFence(text: string): string {
  const trimmed = String(text ?? '').trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export class VisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionParseError';
  }
}

/**
 * Turn a model response into page-tier values.
 *
 * Anything not in the vocabulary is discarded rather than passed through: the field list is closed
 * (D-086 refuses an inherited one), and a model that invents a key has not found a field we asked
 * about. Discarding is safe here because the page's route and outcome are recorded regardless —
 * this is not a silent skip, it is a refusal to widen the vocabulary at runtime.
 */
export function mapVisionResponse(raw: string, page: number, documentVersion: string): ExtractedValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (e) {
    throw new VisionParseError(`model response was not JSON: ${String((e as Error)?.message ?? e)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VisionParseError('model response was not a JSON object');
  }
  const fields = (parsed as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) {
    throw new VisionParseError('model response has no "fields" array');
  }

  const provenance = (p: number): Provenance => ({ document_version: documentVersion, page: p });
  const out: ExtractedValue[] = [];

  for (const entry of fields) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as { field?: unknown; index?: unknown; presence?: unknown; value?: unknown };

    const id = typeof e.field === 'string' ? e.field.trim() : '';
    const spec = fieldSpec(id);
    if (spec === undefined) continue;

    const rawIndex = Number(e.index);
    const index = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < 50 ? rawIndex : 0;

    const presence = e.presence === 'empty' ? 'empty' : 'present';
    if (presence === 'empty') {
      out.push({ field: spec.id, index, presence: 'empty', value: null, provenance: provenance(page), tier: 'page' });
      continue;
    }

    // `present` with nothing in it is the collapse this prompt exists to prevent. A model that
    // does it anyway has told us nothing, and an entry that says nothing is not recorded as an
    // observation — the field is simply absent, which is what "we did not see it" means here.
    const value = typeof e.value === 'string' ? e.value.trim() : '';
    if (value === '') continue;

    out.push({ field: spec.id, index, presence: 'present', value, provenance: provenance(page), tier: 'page' });
  }

  return out;
}
