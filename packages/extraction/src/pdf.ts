/**
 * Opening a PDF, and the three things worth taking out of it.
 *
 * Two parsers, because they see different halves of the file and the survey measured what
 * happens when you only use one:
 *
 * - **pdf-lib** reads the AcroForm — field names, values, page, and widget rectangles.
 * - **pdfjs** reads the page content stream — positioned text items.
 *
 * A filled, unflattened form keeps its values in the form dictionary, **not in the page content**.
 * Confirmed here, in this repo's own stack: a fixture whose `Merchant Name` field holds
 * `"Northwind Peptides LLC"` yields a content stream containing only the blank template. The
 * surveyed app read content only and reported the template back, which is D-089's whole reason for
 * existing.
 */

import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import type { Rect } from './types.js';

/** A positioned run of text from the page content stream. */
export interface TextItem {
  readonly text: string;
  readonly rect: Rect;
}

/** An AcroForm text field, with everything D-087 asks for already attached. */
export interface FormField {
  readonly name: string;
  /** `null` when the widget exists and holds no text — a positive observation (D-077). */
  readonly value: string | null;
  /** One-based. `null` when the widget is not attached to any page we can identify. */
  readonly page: number | null;
  readonly rect: Rect;
}

export interface PdfPage {
  readonly page: number;
  readonly items: readonly TextItem[];
}

export interface OpenedPdf {
  readonly pageCount: number;
  readonly pages: readonly PdfPage[];
  readonly fields: readonly FormField[];
  /** True when the document declares an AcroForm at all, filled or not. */
  readonly hasAcroForm: boolean;
}

export class EncryptedPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptedPdfError';
  }
}

export class UnreadablePdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadablePdfError';
  }
}

/**
 * pdfjs signals a password requirement with a named exception rather than a status, and the name
 * survives across its builds where the message does not. Checked liberally: the rejection may be
 * the exception or may wrap it.
 */
function isPasswordError(e: unknown): boolean {
  const seen = [e, (e as { cause?: unknown } | null)?.cause];
  for (const x of seen) {
    const name = String((x as { name?: unknown } | null)?.name ?? '');
    if (name === 'PasswordException') return true;
    const msg = String((x as { message?: unknown } | null)?.message ?? '').toLowerCase();
    if (msg.includes('password')) return true;
  }
  return false;
}

/** pdfjs is ESM-only and its Node build lives behind a subpath. Loaded once, lazily. */
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Where pdfjs finds the fourteen standard fonts.
 *
 * Not optional, and not cosmetic. Without it pdfjs prints *"Ensure that the `standardFontDataUrl`
 * API parameter is provided"* on every document — a warning **about our own usage**, which
 * `docs/ARCHITECTURE.md` rules is a defect report rather than noise. What it is reporting: a PDF
 * that names Helvetica without embedding it leaves pdfjs without the glyph-to-Unicode mapping,
 * so the extracted characters can be wrong rather than merely missing.
 *
 * That failure is silent and it is the dangerous shape — a value extracted from mis-mapped glyphs
 * is a wrong value carrying complete provenance, which is worse than no value at all (D-088).
 * `standardFonts.test.ts` asserts the console stays clean, because an expected warning is one
 * nobody notices changing.
 */
function standardFontDataUrl(): string {
  // Resolved through the module graph, not by counting `..` segments. A relative path is correct
  // for `src/` and wrong for `dist/src/`, and would have degraded to the same silent warning the
  // moment this package was consumed as a build artifact rather than as source.
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  // A filesystem path with a trailing separator, deliberately **not** a `file://` URL. In Node,
  // pdfjs loads standard fonts through the filesystem; hand it a URL and every load fails with
  // `Unable to load font data at: file:///…` — a warning, not an error, so the document still
  // parses and the mapping is quietly missing. Caught by `standardFonts.test.ts`, which is the
  // second thing that test found in the fix it was written for.
  return join(dirname(pkg), 'standard_fonts') + sep;
}

async function readFormFields(bytes: Uint8Array): Promise<{ fields: FormField[]; hasAcroForm: boolean }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (isPasswordError(e) || String((e as Error)?.message ?? '').includes('is encrypted')) {
      throw new EncryptedPdfError('pdf is encrypted; a password is required to read it');
    }
    // A file pdfjs can read and pdf-lib cannot is a real case (pdf-lib is stricter about some
    // cross-reference layouts). Losing the form is worse than losing nothing, but it is not fatal
    // to the document — the text path still runs, and the page records what it used.
    return { fields: [], hasAcroForm: false };
  }

  let form;
  try {
    form = doc.getForm();
  } catch {
    return { fields: [], hasAcroForm: false };
  }

  const pages = doc.getPages();
  const pageIndexOf = (ref: unknown): number | null => {
    for (let i = 0; i < pages.length; i++) {
      if ((pages[i] as { ref: unknown }).ref === ref) return i + 1;
    }
    return null;
  };

  const out: FormField[] = [];
  let declared = false;
  let all: ReturnType<typeof form.getFields>;
  try {
    all = form.getFields();
  } catch {
    return { fields: [], hasAcroForm: false };
  }
  declared = all.length > 0;

  for (const field of all) {
    const name = field.getName();
    // Only text-bearing fields carry a value a check can compare. Checkboxes and radio groups
    // describe structure, and reading them well needs the check that consumes them to exist first.
    const maybeText = field as unknown as { getText?: () => string | undefined };
    const text = typeof maybeText.getText === 'function' ? (maybeText.getText() ?? '') : null;
    if (text === null) continue;

    let widgets: ReturnType<typeof field.acroField.getWidgets>;
    try {
      widgets = field.acroField.getWidgets();
    } catch {
      continue;
    }
    for (const w of widgets) {
      let rect: Rect;
      try {
        const r = w.getRectangle();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      } catch {
        continue;
      }
      let page: number | null = null;
      try {
        page = pageIndexOf(w.P());
      } catch {
        page = null;
      }
      const trimmed = text.trim();
      out.push({ name, value: trimmed === '' ? null : trimmed, page, rect });
    }
  }
  return { fields: out, hasAcroForm: declared };
}

async function readPositionedText(bytes: Uint8Array): Promise<{ pageCount: number; pages: PdfPage[] }> {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      // pdfjs transfers the buffer it is handed; a copy keeps the caller's bytes intact, which
      // matters because the same bytes are hashed and handed to pdf-lib.
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontDataUrl(),
    }).promise;
  } catch (e) {
    if (isPasswordError(e)) throw new EncryptedPdfError('pdf is encrypted; a password is required to read it');
    throw new UnreadablePdfError(`pdf could not be parsed: ${String((e as Error)?.message ?? e)}`);
  }

  const pages: PdfPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const raw of content.items) {
        const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        const text = it.str ?? '';
        if (text.trim() === '') continue;
        const t = it.transform ?? [1, 0, 0, 1, 0, 0];
        items.push({
          text,
          rect: {
            x: t[4] ?? 0,
            y: t[5] ?? 0,
            width: it.width ?? 0,
            height: it.height ?? 0,
          },
        });
      }
      pages.push({ page: n, items });
      page.cleanup();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return { pageCount: doc.numPages, pages };
}

/** Opens a PDF and reads both halves. Throws `EncryptedPdfError` / `UnreadablePdfError` only. */
export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  // Text first: pdfjs is the more tolerant reader, and it is the one that distinguishes
  // "encrypted" from "malformed" reliably. Establishing which of those we have decides the
  // document's outcome, so it is settled before anything else runs.
  const { pageCount, pages } = await readPositionedText(bytes);
  const { fields, hasAcroForm } = await readFormFields(bytes);
  return { pageCount, pages, fields, hasAcroForm };
}
