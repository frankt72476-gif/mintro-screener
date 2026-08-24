/**
 * What is this file, actually?
 *
 * **D-089: dispatch on magic bytes, never on the filename.** The extension is merchant-supplied
 * metadata *about* content; establishing content from something adjacent to it rather than from
 * the content itself is constraint 9's error in miniature.
 *
 * The surveyed app dispatched on `path.extname` and paid for it three ways, all measured:
 * a PDF saved as `.txt` was skipped, an HTML error page saved as `.pdf` reached the PDF parser
 * and threw, and `.heic` — the iPhone camera default, and the format of the two most-photographed
 * document types in the catalog — was dropped with no record at all.
 *
 * The filename is still accepted by `extract()`, and is used for nothing but diagnostics. That is
 * deliberate: a caller who passes it should not be able to change the outcome by lying.
 */

/** Types this extractor can read. */
export type ReadableType = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp';

/**
 * Types recognised and refused. Naming them is the point — an unsupported file must resolve to a
 * recorded outcome with a reason (D-092), and "we know exactly what this is and cannot read it"
 * is a far more useful thing for an operator to see than "unknown".
 */
export type RefusedType = 'heic' | 'html' | 'tiff' | 'zip-or-office' | 'rtf' | 'unknown';

export type DetectedType = ReadableType | RefusedType;

const READABLE = new Set<DetectedType>(['pdf', 'jpeg', 'png', 'gif', 'webp']);

export function isReadable(t: DetectedType): t is ReadableType {
  return READABLE.has(t);
}

const starts = (b: Uint8Array, sig: readonly number[], at = 0): boolean => {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
};

const ascii = (b: Uint8Array, at: number, len: number): string => {
  let s = '';
  for (let i = at; i < Math.min(b.length, at + len); i++) s += String.fromCharCode(b[i] as number);
  return s;
};

/**
 * Detect the type from the leading bytes.
 *
 * Never throws and never returns nothing — an unrecognised file is `'unknown'`, which is itself a
 * recorded outcome rather than a gap.
 */
export function sniff(bytes: Uint8Array): DetectedType {
  if (bytes.length === 0) return 'unknown';

  // %PDF — the one type with a real parser behind it.
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';

  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';

  // RIFF....WEBP
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';

  // ISO-BMFF: a 4-byte box length, then 'ftyp', then a brand. HEIC/HEIF live here, and so does
  // MP4 — the brand is what separates them, so it is read rather than assumed.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'heim' || brand === 'heis') return 'heic';
    if (brand === 'mif1' || brand === 'msf1') return 'heic'; // HEIF stills
  }

  if (starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';

  // PK\x03\x04 — .docx, .xlsx, .pptx and plain .zip are one signature. All four are refused, so
  // telling them apart would change nothing an operator sees.
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip-or-office';

  if (ascii(bytes, 0, 5) === '{\\rtf') return 'rtf';

  // HTML has no magic number, so this is a sniff rather than a signature: skip a BOM and any
  // leading whitespace, then look for a doctype or a tag. This is what catches the storefront
  // that answers a `.pdf` request with its themed 404 page — the case D-026 and the terms-fetch
  // ruling are both about, arriving here in a new costume.
  let i = 0;
  if (starts(bytes, [0xef, 0xbb, 0xbf])) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  const head = ascii(bytes, i, 64).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml') || head.startsWith('<head')) {
    return 'html';
  }

  return 'unknown';
}

/** Why a recognised-but-refused type cannot be read. Rendered into `reason` (D-092). */
export function refusalReason(t: RefusedType): string {
  switch (t) {
    case 'heic':
      // Worth stating at length because it is a product gap, not a technical shrug: HEIC is the
      // iPhone camera default, and photographed IDs and voided checks are the catalog's most
      // common page-tier documents. Decoding it needs a codec this package does not carry.
      return 'heic: HEIF/HEIC images cannot be decoded by this extractor and are not accepted by the vision model; the file must be converted to JPEG or PNG before extraction';
    case 'html':
      return 'html: the bytes are an HTML document, not the document that was asked for — a request that did not end at the document you asked for did not reach it';
    case 'tiff':
      return 'tiff: TIFF images are not accepted by the vision model; convert to JPEG or PNG';
    case 'zip-or-office':
      return 'zip-or-office: ZIP-container formats (.docx, .xlsx, .pptx, .zip) are not read by this extractor';
    case 'rtf':
      return 'rtf: RTF documents are not read by this extractor';
    case 'unknown':
      return 'unknown: the leading bytes match no type this extractor recognises';
  }
}
