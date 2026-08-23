/**
 * Reading text out of a PDF, for the COA rules (D-057).
 *
 * ## Why there is no PDF library here
 *
 * `docs/ARCHITECTURE.md` rules out a PDF library for *producing* the report — the worker already
 * has a browser, and `page.pdf()` is the whole mechanism. That ruling is about generation and does
 * not cover reading, so this is a new decision rather than a departure from an old one: extraction
 * uses Node's own `zlib` and nothing else.
 *
 * The trade is deliberate and its limit is the point. This reads the text of a **digitally
 * generated** PDF — uncompressed or Flate-compressed content streams, which is what a lab's
 * reporting software emits. It reads nothing from a **scanned** COA, which is an image of a page
 * with no text objects in it at all.
 *
 * That limit is safe in the only direction that matters here. COA-002 and COA-003 are `critical`
 * and `auto_fail`; a partial extractor that quietly returned "no purity found" would fail a
 * merchant whose certificate states 99.2% in a scan. **Text that could not be extracted is
 * `not_evaluable`, never an absent value** — and `extractPdfText` says which case it is rather
 * than returning an empty string for both.
 */

import { inflateSync, inflateRawSync } from 'node:zlib';

export interface PdfText {
  /** Text recovered from the document's content streams, in page order. */
  readonly text: string;
  /** How many content streams were found, and how many yielded text. */
  readonly streams: number;
  readonly decoded: number;
  /**
   * Why no text could be recovered, when none could.
   *
   * Present exactly when `text` is empty. A caller must report `not_evaluable` carrying this,
   * rather than treating the empty string as a document that says nothing.
   */
  readonly emptyReason?: string;
}

/** True when the bytes begin with the PDF magic number. A content type is a claim; this is not. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

/**
 * Extracts what text there is.
 *
 * Walks the file for `stream` … `endstream` pairs, inflates the ones that are Flate-compressed,
 * and pulls the string operands out of the text-showing operators — `Tj`, `TJ`, `'` and `"`.
 * Everything else in the content stream is positioning and graphics, which a text extractor has
 * no use for.
 */
export function extractPdfText(bytes: Uint8Array): PdfText {
  if (!looksLikePdf(bytes)) {
    return {
      text: '',
      streams: 0,
      decoded: 0,
      emptyReason: 'the bytes fetched are not a PDF: they do not begin with %PDF',
    };
  }

  const raw = Buffer.from(bytes);
  const parts: string[] = [];
  let streams = 0;
  let decoded = 0;

  let cursor = 0;
  for (;;) {
    const start = raw.indexOf('stream', cursor);
    if (start === -1) break;

    const end = raw.indexOf('endstream', start);
    if (end === -1) break;

    streams += 1;

    // Skip the EOL that must follow the `stream` keyword.
    let from = start + 'stream'.length;
    if (raw[from] === 0x0d) from += 1;
    if (raw[from] === 0x0a) from += 1;

    const body = raw.subarray(from, end);
    const text = decodeStream(body);
    if (text !== null) {
      decoded += 1;
      const shown = showText(text);
      if (shown !== '') parts.push(shown);
    }

    cursor = end + 'endstream'.length;
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();

  /*
    Bytes came out. That is not the same as text coming out (D-058).

    biotechpeptides.com's certificate yielded 2,944 characters of this:

        !"#  $% # '    +#', - 7   .  7   )    ( $#' $=$9"$ 9# ,#>75$ +##

    The content streams decoded correctly; the font is a subset with its own encoding, and
    without its ToUnicode map the byte values are not the characters a reader sees. Every field
    reader then found nothing, and COA-004 reported "5 of 5 required fields were not found" —
    an observation about the merchant's certificate derived from our inability to read it.

    Measured rather than guessed, and the separation is not close:

        biotechpeptides   letters/total 0.002   letter-runs>=3: 0
        corepeptides      letters/total 0.718   letter-runs>=3: 227

    A document with no run of three letters anywhere in it has not been read.
  */
  const readable = isReadableText(text);

  if (text !== '' && readable) return { text, streams, decoded };

  if (text !== '' && !readable) {
    return {
      text: '',
      streams,
      decoded,
      emptyReason:
        `the ${decoded} decoded content stream(s) produced ${text.length} characters that are not ` +
        `readable text — the document's fonts carry their own encoding and no character map to ` +
        `resolve it, so what the certificate says could not be read`,
    };
  }

  return {
    text: '',
    streams,
    decoded,
    emptyReason:
      streams === 0
        ? 'the PDF contains no content streams to read'
        : decoded === 0
          ? `none of the ${streams} content stream(s) could be decompressed, so the document may use ` +
            `a filter this reader does not implement`
          : `the ${decoded} decoded content stream(s) carry no text objects, which is what a scanned ` +
            `certificate looks like — an image of a page rather than text`,
  };
}

/** Inflates a stream if it is compressed, or returns it as-is if it is already plain. */
function decodeStream(body: Buffer): string | null {
  // Already text: a content stream begins with operators, not with a zlib header.
  const head = body.subarray(0, 2);
  const looksDeflated = head[0] === 0x78 || (head[0] !== undefined && (head[0] & 0x0f) === 0x08);

  if (!looksDeflated) {
    const plain = body.toString('latin1');
    return /\b(Tj|TJ|BT)\b/.test(plain) ? plain : null;
  }

  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(body).toString('latin1');
    } catch {
      // Not this encoding. Try the next; a stream that decodes under neither is reported as
      // undecoded rather than as an empty document.
    }
  }

  return null;
}

/**
 * Pulls the shown strings out of a decoded content stream.
 *
 * PDF strings are parenthesised with backslash escapes, or hex between angle brackets. Only the
 * text-showing operators are followed, so numbers used for kerning and positioning do not leak
 * into the extracted text as digits — which would matter a great deal to a rule reading a purity
 * percentage.
 */
function showText(stream: string): string {
  const out: string[] = [];

  // `(...) Tj`, `(...) '`, `(...) "` and `[...] TJ`, the last being an array of strings and kerns.
  const pattern = /(\((?:\\.|[^\\()])*\)|\[(?:[^\][\\]|\\.)*\])\s*(TJ|Tj|'|")/g;

  for (const match of stream.matchAll(pattern)) {
    const operand = match[1] ?? '';
    if (operand.startsWith('[')) {
      for (const piece of operand.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
        out.push(unescapePdfString(piece[0]));
      }
      out.push(' ');
    } else {
      out.push(unescapePdfString(operand));
      out.push(' ');
    }
  }

  // Hex strings, which some producers use for the whole document.
  for (const match of stream.matchAll(/<([0-9A-Fa-f\s]{4,})>\s*(TJ|Tj)/g)) {
    out.push(fromHex(match[1] ?? ''));
    out.push(' ');
  }

  return out.join('').replace(/\s+/g, ' ').trim();
}

function unescapePdfString(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_, ch: string) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      return map[ch] ?? ch;
    })
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function fromHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    // UTF-16BE producers pad with zero bytes; dropping them keeps the text readable.
    if (code !== 0) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Whether extracted characters are text a person could read.
 *
 * A subset font without a ToUnicode map yields byte values that are not characters. The test is
 * whether words appear at all: three consecutive letters is the smallest thing that distinguishes
 * language from noise, and a certificate has hundreds of them.
 *
 * The threshold is deliberately far below anything a real document produces. The failing case had
 * **zero** such runs in 2,944 characters; the passing one had 227 in 2,232. This is not a close
 * call being adjudicated, it is a floor under an obvious difference.
 */
export function isReadableText(text: string): boolean {
  if (text.length < 20) return false;
  const runs = text.match(/[A-Za-z]{3,}/g) ?? [];
  return runs.length >= 5;
}
