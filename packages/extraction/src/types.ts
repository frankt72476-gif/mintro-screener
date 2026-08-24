/**
 * The shape of an extraction.
 *
 * Two rules from `docs/DECISIONS.md` are enforced by these types rather than by care:
 *
 * - **D-087** — a value carries its provenance or it is not a value. `Provenance` is a union of
 *   exactly two members, and the weaker one cannot be widened into the stronger by omitting a
 *   field: `tier` and the provenance shape are checked together in `assertWellFormed`.
 * - **D-077 / rule 7** — *not present on the document*, *present and empty*, and *document
 *   unreadable* are three different answers. They are three different places in this structure,
 *   and none of them is `null`.
 *
 * There is deliberately **no confidence anywhere** (D-088). Do not add one "for later": the
 * surveyed app's 0.90 threshold is what admitted `business_legal_name = "Merchant Address"` from
 * its own fixture, and a score with no consumer is a score waiting for one.
 */

/** What happened to the file as a whole. Every input gets exactly one of these (D-092). */
export type Outcome =
  /** At least one page was read. Individual pages may still have failed; see `pages`. */
  | 'extracted'
  /** Recognised type, but nothing could be read from it. `reason` says what was attempted. */
  | 'unreadable'
  /** Not a type this extractor handles. `reason` names the type that was actually detected. */
  | 'unsupported'
  /** A PDF that requires a password. Not a throw, and not `unreadable` — a distinct fact. */
  | 'encrypted';

/** How a page was read. One per page, always recorded. */
export type Route =
  /** AcroForm widgets were present and read (D-089). Character tier. */
  | 'form'
  /** Positioned text layer above the density floor (D-090). Character tier. */
  | 'text'
  /** Rasterised and sent to the vision model a page at a time (D-095). Page tier. */
  | 'vision'
  /** Nothing ran. `reason` says why — this is never silence (D-092). */
  | 'none';

export type Tier = 'character' | 'page';

/** Where on the page a character-tier value was found. A rectangle in PDF user space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Location =
  /** Read from a named AcroForm field. The field name is provenance for free (D-089). */
  | { readonly kind: 'field'; readonly name: string; readonly rect: Rect }
  /** Read from the positioned text layer. */
  | { readonly kind: 'text'; readonly rect: Rect };

/**
 * D-087's four elements, and the two tiers D-100 allows.
 *
 * `document_version` is the content hash. Per D-091 the hash *is* document identity, so "which
 * version of this document" and "which bytes" are the same question.
 */
export type Provenance =
  | {
      readonly document_version: string;
      readonly page: number;
      readonly location: Location;
      readonly snippet: string;
    }
  | {
      readonly document_version: string;
      readonly page: number;
    };

/**
 * Whether the document said something here, or said nothing here.
 *
 * `empty` is a positive observation: a form field exists on the page and holds no text. That is
 * different from the field not being on the document at all, which is expressed by the absence of
 * any entry for it. D-077 turns on keeping those two apart.
 */
export type Presence = 'present' | 'empty';

export interface ExtractedValue {
  /** A member of the closed vocabulary in `vocabulary.ts`. */
  readonly field: string;
  /** Zero-based occurrence, for repeated fields such as owners. `0` when the field is singular. */
  readonly index: number;
  readonly presence: Presence;
  /** The value as read. `null` exactly when `presence` is `empty` — never for "not found". */
  readonly value: string | null;
  readonly provenance: Provenance;
  readonly tier: Tier;
}

export interface PageResult {
  /** One-based, matching how a reader counts pages and how D-087 reports them. */
  readonly page: number;
  readonly route: Route;
  /** Non-null exactly when `route` is `none`. Why nothing ran on this page. */
  readonly reason: string | null;
  /** Non-whitespace glyphs found in the text layer, after separator stripping (D-090). */
  readonly glyphs: number;
}

export interface ExtractionResult {
  readonly outcome: Outcome;
  /** Non-null for every outcome except `extracted`. */
  readonly reason: string | null;
  readonly pages: readonly PageResult[];
  readonly values: readonly ExtractedValue[];
  /** SHA-256 of the input bytes, lowercase hex (D-091). */
  readonly hash: string;
  /** The extractor that produced this. Half of the cache key (D-096). */
  readonly extractor_version: string;
  /** True when this result was served from cache rather than recomputed (D-096). */
  readonly cached: boolean;
  /** The type detected from magic bytes, never from the filename (D-089). */
  readonly detected_type: string;
}
