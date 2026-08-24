/**
 * Values whose *shape* identifies them, and one that carries its own checksum.
 *
 * These are the only values this package will emit without a label beside them, and the bar is
 * deliberately high: the pattern has to be decisive on its own. A nine-digit run is not an account
 * number just because an account number is nine digits — but a nine-digit run that passes the ABA
 * checksum is a routing number in a way that no page of prose accidentally is.
 *
 * Everything else needs a label (`extractText.ts`), because a bare string on a page is not
 * self-identifying and pretending otherwise is how a harvester starts returning headings.
 */

/**
 * The ABA routing checksum: 3·d1 + 7·d2 + d3, repeating, ≡ 0 mod 10.
 *
 * This is what makes `routing_number` safe to pattern-match. Roughly one in ten arbitrary
 * nine-digit runs passes by chance, which is not nothing — so a pattern hit is still only emitted
 * where the surrounding text does not contradict it, and C-10 exists downstream to set it against
 * the Federal Reserve directory.
 */
export function isValidAba(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map((c) => c.charCodeAt(0) - 48);
  const sum =
    3 * ((d[0] as number) + (d[3] as number) + (d[6] as number)) +
    7 * ((d[1] as number) + (d[4] as number) + (d[7] as number)) +
    1 * ((d[2] as number) + (d[5] as number) + (d[8] as number));
  return sum % 10 === 0;
}

/** `NN-NNNNNNN`. The hyphen is what distinguishes an EIN from any other nine-digit run. */
export const EIN_RE = /\b(\d{2}-\d{7})\b/;

/** A nine-digit run, checksum tested separately. */
export const NINE_DIGITS_RE = /\b(\d{9})\b/;

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** `03/14/2026`, `2026-03-14`, `14 March 2026`, `March 14, 2026`. */
export const DATE_RE = new RegExp(
  [
    '\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b',
    '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    `\\b\\d{1,2}\\s+${MONTHS}\\.?\\,?\\s+\\d{4}\\b`,
    `\\b${MONTHS}\\.?\\s+\\d{1,2}\\,?\\s+\\d{4}\\b`,
  ].join('|'),
  'i',
);

/** `$1,234.56`, `1,234.56`, `1234`. Currency symbol optional; separators tolerated. */
export const MONEY_RE = /(?:\$\s?)?\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b|\$\s?\d+(?:\.\d{2})?/;

export const PERCENT_RE = /\b\d{1,3}(?:\.\d+)?\s?%/;

export const NUMBER_RE = /\b\d{1,3}(?:,\d{3})*\b|\b\d+\b/;

/**
 * `Page 3 of 12`, `3 of 12`, `Page 3/12`. Read as a value by A-02, which is why it is a field.
 *
 * The slash form **requires the word `page`**. Without that requirement the first draft of this
 * pattern read `Date of this notice: 03/14/2026` and reported a page marker of `03/14` — a date,
 * harvested as page furniture, on the first fixture this package ever saw. Found by running it.
 */
export const PAGE_MARKER_RE = /\b(?:page\s+)?(\d{1,4})\s+of\s+(\d{1,4})\b|\bpage\s*(\d{1,4})\s*\/\s*(\d{1,4})\b/i;

/** Digits only, punctuation removed. For comparing digit strings without formatting noise. */
export function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}
