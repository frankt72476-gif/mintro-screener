/**
 * Values from a positioned text layer — character tier, and the riskiest code in the package.
 *
 * ## What this is not
 *
 * D-086 refuses reuse of the surveyed app's harvester, on three grounds each sufficient on its
 * own. Label-adjacency as a *technique* is not what was refused; what was refused was that
 * implementation, which had no provenance below document level, derived its own configuration by
 * calling `toString()` on itself, and was keyed to another product's form vocabulary.
 *
 * The technique still has the failure mode the survey measured, and three things here are aimed
 * squarely at it:
 *
 * 1. **Geometry, not string adjacency.** The surveyed app joined a page into lines of text and
 *    looked at the characters after a label. Items here carry coordinates, so "to the right of the
 *    label, on the same line" is a spatial fact. That is also what produces the rectangle D-087
 *    requires — the provenance is a by-product of doing the locating properly.
 *
 * 2. **No next-line fallback.** The surveyed app, finding nothing after a label, took the *next
 *    line*. On a form where labels stack vertically that reads the following label as the value:
 *    measured output `business_legal_name = "Merchant Address"`, matched from the label
 *    `Merchant Name`, at confidence 0.90. Same-line only. A label-above-value layout therefore
 *    yields nothing here — and the honest recovery for that layout is the form route (D-089), not
 *    a guess. A missed value becomes `not_evaluable` downstream, which is the survivable
 *    direction; a wrong value becomes a comparison that agrees with itself, which D-088 names as
 *    the worst output this feature can produce.
 *
 * 3. **A candidate that is a label is not a value.** Checked before anything is emitted, and it is
 *    what catches `dba_name = "(Doing Business As) Name"` — the second measured junk value — where
 *    a same-line match ran straight into the next label on the row.
 */

import { glyphCount } from './density.js';
import type { TextItem } from './pdf.js';
import { DATE_RE, EIN_RE, MONEY_RE, NINE_DIGITS_RE, NUMBER_RE, PAGE_MARKER_RE, PERCENT_RE, isValidAba } from './patterns.js';
import type { ExtractedValue, Rect } from './types.js';
import { ALL_LABELS, FIELDS, normalizeLabel, type FieldKind, type FieldSpec } from './vocabulary.js';

/** Items sharing a baseline, left to right. */
interface Line {
  readonly text: string;
  /** Character offset in `text` → the item that supplied it. Parallel to `text`. */
  readonly spans: readonly { readonly start: number; readonly end: number; readonly item: TextItem }[];
}

/**
 * Group items into lines by baseline.
 *
 * The tolerance scales with glyph height rather than being a fixed number of units, because a
 * 6pt footnote and a 24pt heading do not have the same idea of "the same line".
 */
export function toLines(items: readonly TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => (b.rect.y - a.rect.y) || (a.rect.x - b.rect.x));
  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const tolerance = Math.max(2, (item.rect.height || 10) * 0.6);
    const last = groups[groups.length - 1];
    const lastY = last?.[0]?.rect.y;
    if (last !== undefined && lastY !== undefined && Math.abs(lastY - item.rect.y) <= tolerance) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.rect.x - b.rect.x);
    let text = '';
    const spans: { start: number; end: number; item: TextItem }[] = [];
    for (const item of ordered) {
      if (text !== '' && !text.endsWith(' ') && !item.text.startsWith(' ')) text += ' ';
      const start = text.length;
      text += item.text;
      spans.push({ start, end: text.length, item });
    }
    return { text, spans };
  });
}

/** The bounding box of every item overlapping `[start, end)` in the line's text. */
function rectFor(line: Line, start: number, end: number): Rect | null {
  const hits = line.spans.filter((s) => s.start < end && s.end > start);
  if (hits.length === 0) return null;
  const x0 = Math.min(...hits.map((h) => h.item.rect.x));
  const y0 = Math.min(...hits.map((h) => h.item.rect.y));
  const x1 = Math.max(...hits.map((h) => h.item.rect.x + h.item.rect.width));
  const y1 = Math.max(...hits.map((h) => h.item.rect.y + h.item.rect.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * A label, matched as page furniture.
 *
 * Word separators are whatever the producer used, so the pattern joins the label's words with
 * "one or more non-alphanumerics" rather than a literal space. The leading boundary stops `dba`
 * from matching inside `pdba`; the trailing group eats a colon or dash if one is there.
 */
function labelPattern(label: string): RegExp {
  const words = label.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[^a-z0-9])(${words.join('[^a-z0-9]+')})[^a-z0-9]{0,3}`, 'i');
}

const PATTERN_CACHE = new Map<string, RegExp>();
function patternFor(label: string): RegExp {
  let re = PATTERN_CACHE.get(label);
  if (re === undefined) {
    re = labelPattern(label);
    PATTERN_CACHE.set(label, re);
  }
  return re;
}

/**
 * Is this candidate actually the next label on the row?
 *
 * Two forms, both measured in the surveyed app's output:
 *
 * - the candidate *is* a known label — `"Name on Bank Account"` harvested as the bank name;
 * - the candidate *starts with* one — `"(Doing Business As) Name: Business/Corporate Name:"`
 *   harvested as the DBA.
 *
 * A trailing colon is the third form and needs no vocabulary at all: text that ends in a colon is
 * introducing something, not stating it.
 */
export function looksLikeLabel(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed === '') return true;
  if (trimmed.endsWith(':')) return true;
  const norm = normalizeLabel(trimmed);
  if (norm === '') return true;
  if (ALL_LABELS.has(norm)) return true;
  for (const label of ALL_LABELS) {
    if (norm === label) return true;
    if (norm.startsWith(`${label} `)) return true;
  }
  return false;
}

/** Where the next known label begins inside a candidate, so the value can be cut before it. */
function nextLabelOffset(candidate: string): number {
  let best = -1;
  for (const spec of FIELDS) {
    for (const label of spec.labels) {
      const m = patternFor(label).exec(candidate);
      if (m === null) continue;
      // `m.index` points at the boundary character; the label itself starts one later unless the
      // match began at position zero.
      const at = m.index === 0 ? 0 : m.index + 1;
      if (at > 0 && (best === -1 || at < best)) best = at;
    }
  }
  return best;
}

/** Pull the part of a candidate that matches the field's kind. `text` takes the whole remainder. */
function valueOfKind(kind: FieldKind, candidate: string): { value: string; start: number; end: number } | null {
  const take = (re: RegExp): { value: string; start: number; end: number } | null => {
    const m = re.exec(candidate);
    if (m === null || m.index === undefined) return null;
    return { value: m[0].trim(), start: m.index, end: m.index + m[0].length };
  };
  switch (kind) {
    case 'date':
      return take(DATE_RE);
    case 'money':
      return take(MONEY_RE);
    case 'percent':
      return take(PERCENT_RE);
    case 'number':
      return take(NUMBER_RE);
    case 'digits': {
      const m = /[0-9][0-9\s\-–—]{6,}/.exec(candidate);
      if (m === null) return null;
      return { value: m[0].trim(), start: m.index, end: m.index + m[0].length };
    }
    case 'text': {
      const trimmed = candidate.trim();
      // A free-text value has to contain a word. Without this, cutting `Owner 1 Ownership %:` at
      // the label `ownership` leaves `1`, and `owner_name = "1"` is emitted with full provenance —
      // found on the first fixture this package ever read. Provenance makes a value *checkable*;
      // it does not make it *true*, and the guards are what keep the two apart.
      if (!/[A-Za-z]{2}/.test(trimmed)) return null;
      const lead = candidate.indexOf(trimmed);
      return { value: trimmed, start: lead, end: lead + trimmed.length };
    }
  }
}

export interface TextExtractionInput {
  readonly page: number;
  readonly items: readonly TextItem[];
  readonly documentVersion: string;
  /**
   * Whether to run label-anchored extraction, as opposed to shape-decisive patterns only.
   *
   * **False on a page that carries AcroForm widgets**, and the reason is measured. On such a page
   * the printed text layer is almost entirely *labels* — the answers live in the widgets, which
   * the form route already reads properly with better provenance. Running label-adjacency across
   * a wall of labels is the surveyed app's exact situation, and it produced exactly its result:
   * the first run of this package over its own filled fixture emitted `owner_name = "1"`, scraped
   * off the caption `Owner 1 Ownership %:`.
   *
   * Shape-decisive patterns still run there. An ABA checksum or an `NN-NNNNNNN` cannot come back
   * holding a label.
   */
  readonly labelAnchored?: boolean;
}

export function extractFromText(input: TextExtractionInput): ExtractedValue[] {
  const { page, items, documentVersion } = input;
  const labelAnchored = input.labelAnchored ?? true;
  const lines = toLines(items);
  const out: ExtractedValue[] = [];
  const counts = new Map<string, number>();

  const emit = (spec: FieldSpec, value: string, line: Line, start: number, end: number): void => {
    const rect = rectFor(line, start, end);
    if (rect === null) return; // no rectangle, no provenance, no value (D-087)
    const index = spec.repeated ? (counts.get(spec.id) ?? 0) : 0;
    if (spec.repeated) counts.set(spec.id, index + 1);
    out.push({
      field: spec.id,
      index,
      presence: 'present',
      value,
      provenance: {
        document_version: documentVersion,
        page,
        location: { kind: 'text', rect },
        // Verbatim: the line as it appears, not a reconstruction. A reader can find this on the
        // page and see for themselves what was read and what was beside it.
        snippet: line.text.trim(),
      },
      tier: 'character',
    });
  };

  for (const line of lines) {
    // --- label-anchored, same line only -------------------------------------------------
    for (const spec of labelAnchored ? FIELDS : []) {
      if (spec.labels.length === 0) continue;
      if (!spec.repeated && out.some((v) => v.field === spec.id)) continue;

      // Longest label first: `business legal address` must win over `business address` where both
      // could match, or the shorter one consumes the row and the value shifts.
      const ordered = [...spec.labels].sort((a, b) => b.length - a.length);
      for (const label of ordered) {
        const m = patternFor(label).exec(line.text);
        if (m === null) continue;
        const after = m.index + m[0].length;
        let candidate = line.text.slice(after);

        // Cut at the next label on the row before judging what is left.
        const cut = nextLabelOffset(candidate);
        if (cut > 0) candidate = candidate.slice(0, cut);

        if (looksLikeLabel(candidate)) break;
        const picked = valueOfKind(spec.kind, candidate);
        if (picked === null) break;
        if (looksLikeLabel(picked.value)) break;

        emit(spec, picked.value, line, after + picked.start, after + picked.end);
        break;
      }
    }

    // --- shape-decisive, no label required ----------------------------------------------
    const ein = EIN_RE.exec(line.text);
    if (ein !== null && ein.index !== undefined && !out.some((v) => v.field === 'ein')) {
      const spec = FIELDS.find((f) => f.id === 'ein');
      if (spec) emit(spec, ein[0], line, ein.index, ein.index + ein[0].length);
    }

    if (!out.some((v) => v.field === 'routing_number')) {
      const nine = NINE_DIGITS_RE.exec(line.text);
      if (nine !== null && nine.index !== undefined && isValidAba(nine[0])) {
        const spec = FIELDS.find((f) => f.id === 'routing_number');
        if (spec) emit(spec, nine[0], line, nine.index, nine.index + nine[0].length);
      }
    }

    const marker = PAGE_MARKER_RE.exec(line.text);
    if (marker !== null && marker.index !== undefined) {
      const spec = FIELDS.find((f) => f.id === 'page_marker');
      if (spec) emit(spec, marker[0].trim(), line, marker.index, marker.index + marker[0].length);
    }
  }

  return out;
}

export { glyphCount };
