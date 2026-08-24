/**
 * Fixtures, generated rather than committed.
 *
 * `CLAUDE.md` says fixtures live in `fixtures/`, are saved from real sources, and are committed.
 * That convention is for saved storefront HTML and it is right for HTML: a reviewer can read it.
 * These are binary PDFs, and a committed one is a blob nobody can review — a reader cannot tell a
 * filled form from a flattened one by looking, which is exactly the distinction two of these
 * fixtures exist to draw. **The generator is the reviewable artifact**, so it is the thing kept.
 *
 * And per the brief, none of these is a real merchant document. Every name, number and address
 * below is invented. `47-2841903` is not anyone's EIN; `122105155` is a real ABA *checksum*, which
 * is the point of it — the routing pattern is only safe because the checksum discriminates, and a
 * fixture that failed the checksum would test nothing.
 *
 * Deterministic: same bytes on every run, so a hash-keyed cache test means something.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/** A 1×1 transparent PNG. Small enough to inline, real enough for `embedPng`. */
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea735d2b40000000049454e44ae426082',
  'hex',
);

async function newDoc(): Promise<{ doc: PDFDocument; font: PDFFont }> {
  const doc = await PDFDocument.create();
  // Fixed metadata dates: `PDFDocument.create()` otherwise stamps "now", and a fixture whose bytes
  // change every run cannot test a content-addressed cache.
  const epoch = new Date(0);
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return { doc, font };
}

function label(page: PDFPage, font: PDFFont, text: string, x: number, y: number): void {
  page.drawText(text, { x, y, size: 10, font });
}

/**
 * A filled merchant application with live AcroForm widgets.
 *
 * The values are in the form dictionary and **not** in the page content stream. That is the whole
 * point of the fixture: it reproduces, in this repo's stack, what the survey measured in the
 * other one — a text-only reader sees the blank template and none of the answers.
 */
export async function filledAcroForm(): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const page = doc.addPage([612, 792]);
  page.drawText('Merchant Processing Application', { x: 50, y: 740, size: 14, font });
  label(page, font, 'Business Legal Name:', 50, 700);
  label(page, font, 'DBA:', 50, 670);
  label(page, font, 'Federal Tax ID:', 50, 640);
  label(page, font, 'Bank Routing #:', 50, 610);
  label(page, font, 'Owner 1 Name:', 50, 580);
  label(page, font, 'Owner 1 Ownership %:', 50, 550);
  label(page, font, 'Owner 2 Name:', 50, 520);

  const form = doc.getForm();
  const put = (name: string, value: string, y: number): void => {
    const f = form.createTextField(name);
    f.setText(value);
    f.addToPage(page, { x: 220, y: y - 4, width: 260, height: 16, font });
  };
  put('business.legal_name', 'Northwind Peptides LLC', 700);
  put('dba_name', 'Northwind Labs', 670);
  put('federal_tax_id', '47-2841903', 640);
  put('bank_routing_number', '122105155', 610);
  put('owner_1_name', 'Dana Reyes', 580);
  put('owner_1_ownership_pct', '60%', 550);
  put('owner_2_name', 'Sam Okafor', 520);

  // A widget that exists and holds nothing. This is the only place "present and empty" is directly
  // observable rather than inferred, and D-077 turns on it being distinguishable from "absent".
  const blank = form.createTextField('bank_name');
  blank.setText('');
  blank.addToPage(page, { x: 220, y: 486, width: 260, height: 16, font });
  label(page, font, 'Bank Name:', 50, 490);

  return doc.save();
}

/**
 * The same application, flattened.
 *
 * Flattening paints the values into the content stream and destroys the widgets, which is what
 * DocuSign and most signing platforms return. There is no form left to read, so this must fall
 * through to the text route and be marked as having done so.
 */
export async function flattenedAcroForm(): Promise<Uint8Array> {
  const bytes = await filledAcroForm();
  const doc = await PDFDocument.load(bytes);
  doc.getForm().flatten();
  return doc.save();
}

/** An ordinary text-layer document — an EIN letter, near enough. Character tier, no widgets. */
export async function textLayerPdf(): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const page = doc.addPage([612, 792]);
  page.drawText('INTERNAL REVENUE SERVICE', { x: 50, y: 740, size: 12, font });
  label(page, font, 'Date of this notice: 03/14/2026', 50, 715);
  label(page, font, 'Business Legal Name: Northwind Peptides LLC', 50, 690);
  label(page, font, 'EIN: 47-2841903', 50, 665);
  label(page, font, 'Business Address: 1180 Harbor Way, Tacoma, WA 98402', 50, 640);
  label(page, font, 'Entity Type: Limited Liability Company', 50, 615);
  return doc.save();
}

/**
 * A page whose only text is a scanner's page stamp.
 *
 * The separator-stripping half of D-090. Read through pdfjs there is no `-- N of M --` to strip —
 * that string is `pdf-parse` furniture and never existed in a PDF — but a scanner that stamps
 * `Page 1 of 2` onto a blank scan produces the same failure from a different source, and that is
 * the case worth defending against.
 */
export async function stampedScanPdf(pageCount = 2): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const png = await doc.embedPng(TINY_PNG);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawImage(png, { x: 60, y: 300, width: 480, height: 380 });
    page.drawText(`Page ${i} of ${pageCount}`, { x: 270, y: 40, size: 9, font });
  }
  return doc.save();
}

/**
 * A scan whose **first page carries a real text header** and whose remaining pages are images.
 *
 * This is the fixture that actually discriminates per-page routing from aggregate routing, and it
 * exists because the obvious one does not. A *pure*-image PDF measures zero glyphs whether you
 * total the document or read it page by page, so it passes under both designs — the surveyed app's
 * bug needed `pdf-parse`'s `-- N of M --` separators to inflate the total, and reading through
 * pdfjs there are none.
 *
 * Here the header alone clears the floor. Summed across the document it licenses the text route
 * for every page, and pages 2–4 then yield nothing and look like pages that had nothing on them.
 * Read per page, only page 1 is text. Same failure the survey measured, reachable in our stack.
 */
export async function partiallyTextedScanPdf(pageCount = 4): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const png = await doc.embedPng(TINY_PNG);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawImage(png, { x: 60, y: 200, width: 480, height: 380 });
    if (i === 1) {
      page.drawText('Harbor Mutual Savings — Business Checking Statement', { x: 50, y: 740, size: 11, font });
    }
  }
  return doc.save();
}

/** A pure-image scan with no text of any kind. Every page must route to vision, not just page 1. */
export async function imageOnlyPdf(pageCount = 4): Promise<Uint8Array> {
  const { doc } = await newDoc();
  const png = await doc.embedPng(TINY_PNG);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawImage(png, { x: 60, y: 300, width: 480, height: 380 });
  }
  return doc.save();
}

/**
 * Text pages and scanned pages in one file — a typed application with a photographed page stapled
 * into the middle. The ordinary case, and the one a per-document routing decision must get wrong.
 */
export async function hybridPdf(): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const png = await doc.embedPng(TINY_PNG);

  const p1 = doc.addPage([612, 792]);
  p1.drawText('Merchant Processing Application', { x: 50, y: 740, size: 14, font });
  label(p1, font, 'Business Legal Name: Northwind Peptides LLC', 50, 700);
  label(p1, font, 'EIN: 47-2841903', 50, 675);

  const p2 = doc.addPage([612, 792]);
  p2.drawImage(png, { x: 60, y: 300, width: 480, height: 380 });

  const p3 = doc.addPage([612, 792]);
  label(p3, font, 'Bank Name: Harbor Mutual Savings', 50, 700);
  label(p3, font, 'Bank Routing #: 122105155', 50, 675);
  label(p3, font, 'Account Number: 000123456789', 50, 650);

  return doc.save();
}

/**
 * The measured junk case, reproduced as a page.
 *
 * Two rows of stacked labels with no values, exactly the layout that produced the surveyed app's
 * `business_legal_name = "Merchant Address"` (label above, next label taken as the value) and
 * `dba_name = "(Doing Business As) Name"` (next label on the same row taken as the value).
 */
export async function labelTrapPdf(): Promise<Uint8Array> {
  const { doc, font } = await newDoc();
  const page = doc.addPage([612, 792]);
  page.drawText('DBA (Doing Business As) Name:', { x: 50, y: 700, size: 10, font });
  page.drawText('Business/Corporate Name:', { x: 300, y: 700, size: 10, font });
  page.drawText('Merchant Name', { x: 50, y: 640, size: 10, font });
  page.drawText('Merchant Address', { x: 50, y: 620, size: 10, font });
  page.drawText('Bank Name:', { x: 50, y: 560, size: 10, font });
  page.drawText('Name on Bank Account:', { x: 300, y: 560, size: 10, font });
  // Enough prose to clear the density floor, so the page genuinely takes the text route.
  page.drawText('This form must be completed in full and returned with supporting documentation.', {
    x: 50, y: 500, size: 9, font,
  });
  return doc.save();
}

/**
 * A password-protected PDF.
 *
 * `pdf-lib` cannot write encryption, so this is assembled by hand: a minimal document with a
 * standard-security-handler `/Encrypt` dictionary in the trailer. The content is not really
 * RC4-enciphered and does not need to be — a reader must ask for a password before it can look,
 * which is the state under test.
 */
export function encryptedPdf(): Uint8Array {
  const objects: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>',
  };
  const stream = 'BT /F1 12 Tf 50 700 Td (Statement) Tj ET';
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objects[5] = `<< /Filter /Standard /V 1 /R 2 /O <${'30'.repeat(32)}> /U <${'31'.repeat(32)}> /P -1 >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = body.length;
  body += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  const id = 'ab'.repeat(16);
  body += `trailer\n<< /Size 6 /Root 1 0 R /Encrypt 5 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

/** A storefront's themed 404, saved as `statement.pdf`. Caught by magic bytes, never by name. */
export function htmlNamedPdf(): Uint8Array {
  const html = '<!DOCTYPE html>\n<html><head><title>Page not found</title></head><body><h1>404</h1></body></html>\n';
  return new Uint8Array(Buffer.from(html, 'utf8'));
}

/**
 * A HEIC still — the iPhone camera default.
 *
 * Only the ISO-BMFF header needs to be real: detection reads the `ftyp` box and its brand, and
 * detection is the whole behaviour under test. There is no decoder here to feed.
 */
export function heicImage(): Uint8Array {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(24, 0);
  header.write('ftyp', 4, 'ascii');
  header.write('heic', 8, 'ascii');
  header.writeUInt32BE(0, 12);
  header.write('heicmif1', 16, 'ascii');
  return new Uint8Array(header);
}

/** A minimal but structurally valid GIF87a. */
export function gifImage(): Uint8Array {
  return new Uint8Array(
    Buffer.from('474946383761010001008000000000ffffff2c00000000010001000002024401003b', 'hex'),
  );
}

/** A JPEG header. Enough for detection; the vision client in tests is a fake. */
export function jpegImage(): Uint8Array {
  return new Uint8Array(Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'));
}
