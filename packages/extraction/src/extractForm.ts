/**
 * Values from AcroForm fields — the character tier at its strongest (D-089).
 *
 * A form field arrives with everything D-087 asks for already attached: a name that says what it
 * is, a page, a widget rectangle, and a value that is the value rather than a guess about which
 * run of text on the page is the value. No adjacency, no inference, no model. On a filled
 * application this is the only path in the package that satisfies all four provenance elements
 * without asking anything of anyone.
 *
 * It is also the path the surveyed app never took. `pdf-lib` was a dependency there, used solely
 * to *write* these fields when generating a merchant application, and never once pointed at an
 * upload — which is why its own filled fixture extracted as the blank template.
 */

import type { FormField } from './pdf.js';
import type { ExtractedValue, Provenance } from './types.js';
import { FIELDS, normalizeFormName, type FieldSpec } from './vocabulary.js';

/**
 * Which vocabulary field, if any, an AcroForm field name denotes.
 *
 * **Longest hint wins.** Hints overlap by design — `dba` is a substring of plenty — and picking
 * the first match would make the answer depend on declaration order in `vocabulary.ts`, which is
 * not a fact about the document.
 *
 * Short hints are additionally required to sit at a boundary. Normalising a field name strips the
 * separators that would otherwise mark word edges, so `routingtransitnumber` contains `tin` and
 * would read as a tax id. Requiring a hint under five characters to be the whole name or to sit at
 * one end restores the boundary that normalisation removed.
 */
export function matchFormField(fieldName: string): FieldSpec | null {
  const name = normalizeFormName(fieldName);
  if (name === '') return null;

  const search = (haystack: string): { spec: FieldSpec | null; len: number } => {
    let best: FieldSpec | null = null;
    let bestLen = 0;
    for (const spec of FIELDS) {
      for (const hint of spec.formHints) {
        if (hint.length <= bestLen) continue;
        if (!haystack.includes(hint)) continue;
        const boundaryOk =
          hint.length >= 5 || haystack === hint || haystack.startsWith(hint) || haystack.endsWith(hint);
        if (!boundaryOk) continue;
        best = spec;
        bestLen = hint.length;
      }
    }
    return { spec: best, len: bestLen };
  };

  const direct = search(name);
  if (direct.spec !== null) return direct.spec;

  // A repeated field carries its occurrence *inside* its name — `owner_1_name` normalises to
  // `owner1name`, which contains neither `ownername` nor anything else in the vocabulary. Trying
  // again without the digits recovers it. Second, not first: `w9` and `501c3` are names in their
  // own right, and stripping digits from those first would blur distinctions that matter.
  const undigited = name.replace(/\d+/g, '');
  if (undigited !== name && undigited !== '') return search(undigited).spec;
  return null;
}

/**
 * The occurrence number a repeated field's name declares, if it declares one.
 *
 * `owner_2_name` is the second owner because the form says so. Where a name carries no number the
 * caller falls back to order of appearance, which is weaker but still deterministic.
 */
export function declaredIndex(fieldName: string): number | null {
  const m = /(\d{1,2})/.exec(normalizeFormName(fieldName));
  if (!m) return null;
  const n = Number(m[1]);
  // One-based in the document, zero-based in the output. `0` in a name is not an occurrence.
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n - 1 : null;
}

export function extractFromForm(fields: readonly FormField[], documentVersion: string): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  const seen = new Map<string, number>();

  for (const field of fields) {
    const spec = matchFormField(field.name);
    if (!spec) continue;
    // A widget with no page cannot carry provenance, and a value without provenance is not a
    // value (D-087). Dropping it here is not a silent skip: the page-level record still shows
    // what the page did, and the field simply does not appear — which under D-077 means "not
    // found", the honest answer for a value we could not place.
    if (field.page === null) continue;

    let index = 0;
    if (spec.repeated) {
      const declared = declaredIndex(field.name);
      if (declared !== null) {
        index = declared;
      } else {
        index = seen.get(spec.id) ?? 0;
        seen.set(spec.id, index + 1);
      }
    }

    const provenance: Provenance = {
      document_version: documentVersion,
      page: field.page,
      location: { kind: 'field', name: field.name, rect: field.rect },
      // The verbatim snippet for a form value is the field name and its contents as stored. Both
      // halves are read off the file; nothing here is composed prose.
      snippet: `${field.name}=${field.value ?? ''}`,
    };

    out.push({
      field: spec.id,
      index,
      // An AcroForm field that exists and holds no text is the one place in this package where
      // "present and empty" is directly observable rather than inferred. D-077 turns on keeping
      // it distinct from "not on the document", and here we simply know.
      presence: field.value === null ? 'empty' : 'present',
      value: field.value,
      provenance,
      tier: 'character',
    });
  }

  return out;
}
