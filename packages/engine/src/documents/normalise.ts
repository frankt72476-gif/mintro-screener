/**
 * Local normalisation for cross-document comparison. No vendor, no network (§1).
 *
 * Every function here answers one question: *are these two the same value written differently?*
 * They never answer *is this value correct*, and they are deliberately conservative — a
 * normalisation that folds two genuinely different values together turns a discrepancy into a
 * `pass`, which is the worst outcome available to family C.
 *
 * §1's rule for what the answer means: **raw differs and normalised matches is a `pass`, with both
 * forms shown**; normalised differs is an adverse finding. So the evidence has to carry the raw
 * strings, not only the verdict — a reader who sees "Acme Foods LLC" and "ACME FOODS, L.L.C."
 * agreeing can judge the normalisation for themselves, and one who sees only "matched" cannot.
 */

/** Case, punctuation and spacing folded away. The floor every other normaliser builds on. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Company names.
 *
 * Only the legal-form suffix is folded, because that is the difference the inventory names:
 * "Acme Foods LLC" against "Acme Foods, L.L.C.". Nothing else is touched — no stemming, no
 * abbreviation expansion, no word reordering. "Acme Foods" and "Acme Food" stay different, and a
 * reviewer decides whether that matters.
 */
const LEGAL_FORMS = [
  'llc', 'l l c', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'lp', 'l p', 'llp', 'l l p', 'pllc', 'p l l c', 'pc', 'p c',
];

export function normaliseName(text: string): string {
  let out = squash(text);
  // Suffixes only, and repeatedly: "Acme Holdings Inc Co" is two suffixes, not one word ending.
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (out.endsWith(` ${form}`)) {
        out = out.slice(0, -(form.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Personal names.
 *
 * Folds "SMITH, JANE A" and "Jane A Smith" together by sorting the parts, which also folds any
 * other ordering difference. Middle initials are kept: dropping them would make "Jane A Smith" and
 * "Jane B Smith" the same person, and this check exists to notice exactly that kind of thing.
 */
export function normalisePersonName(text: string): string {
  return squash(text).split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Street addresses.
 *
 * USPS-style abbreviations only, both directions folded to the short form, plus unit designators.
 * The inventory names suite formatting and abbreviation as the difference to absorb; anything
 * beyond that would need a USPS call, which §1 rules out.
 */
const ADDRESS_WORDS: Readonly<Record<string, string>> = {
  street: 'st', road: 'rd', avenue: 'ave', av: 'ave', boulevard: 'blvd', drive: 'dr',
  lane: 'ln', court: 'ct', place: 'pl', terrace: 'ter', parkway: 'pkwy', highway: 'hwy',
  circle: 'cir', square: 'sq', trail: 'trl',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  suite: 'ste', apartment: 'apt', unit: 'ste', number: '', floor: 'fl',
};

export function normaliseAddress(text: string): string {
  return squash(text)
    .split(' ')
    .map((word) => ADDRESS_WORDS[word] ?? word)
    .filter(Boolean)
    .join(' ');
}

/** Digit strings — EIN, routing, account. Formatting is noise; the digits are the value. */
export function normaliseDigits(text: string): string {
  return text.replace(/\D+/g, '');
}

/**
 * Dates, to `YYYY-MM-DD`.
 *
 * Returns null rather than a guess when the string will not parse. A date comparison is `fail`-
 * capable (C-07, C-16), so a misparse here is a false failure about a real person's date of birth,
 * and "we could not read it" is the only honest alternative.
 */
export function normaliseDate(text: string): string | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return trimmed;

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slash) {
    const [, m, d, y] = slash;
    const year = Number(y);
    // A two-digit year is ambiguous by construction. 70 is the usual pivot and it is a guess; it
    // is applied here rather than in each caller so there is one place to change it.
    const full = year < 100 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
    return `${full}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Money and percentages: the number, without the symbol or the thousands separators. */
export function normaliseAmount(text: string): number | null {
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Entity type, to a canonical token.
 *
 * A W-9 classification box, an application dropdown and an Articles heading say the same thing
 * three ways. Unrecognised input is returned squashed rather than forced into a bucket — an
 * entity type we do not know is not evidence of disagreement.
 */
const ENTITY_TYPES: readonly (readonly [RegExp, string])[] = [
  [/\b(single member llc|smllc)\b/, 'llc'],
  [/\bl ?l ?c\b|limited liability/, 'llc'],
  [/\bs corp|subchapter s\b/, 's_corp'],
  [/\bc corp\b/, 'c_corp'],
  [/\bcorp|incorporated|\binc\b/, 'corporation'],
  [/sole proprietor|\bsole prop\b|\bdba\b/, 'sole_proprietor'],
  [/\bpartnership|\bllp\b|\blp\b/, 'partnership'],
  [/non ?profit|501 ?c/, 'nonprofit'],
  [/\btrust\b/, 'trust'],
];

export function normaliseEntityType(text: string): string {
  const squashed = squash(text);
  for (const [pattern, canonical] of ENTITY_TYPES) {
    if (pattern.test(squashed)) return canonical;
  }
  return squashed;
}

/** US state names to their two-letter code. Anything else is returned squashed. */
const STATES: Readonly<Record<string, string>> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa',
  'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc',
};

export function normaliseState(text: string): string {
  const squashed = squash(text);
  return STATES[squashed] ?? squashed;
}

/** How a field's values are compared. Chosen per field, not per check. */
export type Normaliser = (text: string) => string;

export const NORMALISERS: Readonly<Record<string, Normaliser>> = {
  legal_name: normaliseName,
  dba_name: normaliseName,
  account_holder_name: normaliseName,
  domain_registrant: normaliseName,
  bank_name: normaliseName,
  processor_name: normaliseName,
  owner_name: normalisePersonName,
  signer_name: normalisePersonName,
  business_address: normaliseAddress,
  owner_residential_address: normaliseAddress,
  ein: normaliseDigits,
  routing_number: normaliseDigits,
  account_number: normaliseDigits,
  entity_type: normaliseEntityType,
  formation_state: normaliseState,
  formation_date: (t) => normaliseDate(t) ?? squash(t),
  owner_dob: (t) => normaliseDate(t) ?? squash(t),
};

/** The default for a field with no entry above: case and punctuation only. */
export function normaliserFor(field: string): Normaliser {
  return NORMALISERS[field] ?? squash;
}

/**
 * The ABA routing checksum.
 *
 * Arithmetic on the digits, so it is local and free. It proves a number is *well-formed*, which is
 * a weaker claim than resolving to an institution and much weaker than saying anything about an
 * account — see the note on C-10.
 */
export function abaChecksumValid(routing: string): boolean {
  const digits = normaliseDigits(routing);
  if (digits.length !== 9) return false;
  const d = [...digits].map(Number);
  const sum =
    3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + 1 * (d[2]! + d[5]! + d[8]!);
  return sum % 10 === 0;
}
