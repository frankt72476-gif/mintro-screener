/**
 * Turning a rendered page into a file that will still be that page in 2031.
 *
 * Everything here is a string transform over serialized HTML. No browser, no network, no storage —
 * which is what lets the assertions at the bottom be tested against a fixture rather than against
 * a live render, and what keeps the one dangerous operation (deciding a document is fit to
 * deliver) in a pure function.
 *
 * ## What "self-contained" has to mean
 *
 * Not "mostly inlined". The file is opened years from now, possibly from a laptop with no route to
 * any Mintro system, and it has to be the same document it was the day it was sent. So: no script,
 * no stylesheet link, no font request, no image request, no relative URL of any kind. The
 * assertions treat every one of those as a failure of the job rather than a defect of the file,
 * because a report that reaches an underwriter with a hole in it has already done its damage.
 *
 * ## `<noscript>` is the one nobody expects
 *
 * A captured file is a JavaScript-less context by construction — the scripts are stripped. So any
 * `<noscript>` content, which the app author wrote expecting it to appear only for someone with
 * scripting disabled, **renders**. Whatever it says would appear in the middle of a screening
 * report handed to a bank's processor. It comes out.
 */

/** What the assembler needs. Everything is already fetched; nothing here reaches for anything. */
export interface CaptureInput {
  /** `page.content()` — the serialized DOM after the report has rendered. */
  readonly html: string;
  /** The app's stylesheets, in link order, already hoisted and with their `url()`s inlined. */
  readonly css: readonly string[];
  /** `@font-face` rules with the woff2 bytes inline. */
  readonly fontCss: string;
  /** Marker in the DOM → the data URI that replaces it. */
  readonly images: ReadonlyMap<string, string>;
  /** For the document title. */
  readonly merchantDomain: string;
  readonly runId: string;
}

/** Assembles the document. Does not validate it — `assertCapturable` does, and it is separate. */
export function assembleCapture(input: CaptureInput): string {
  let html = input.html;

  html = substituteImages(html, input.images);
  html = stripExecutable(html);
  html = stripResourceLinks(html);
  html = injectHead(html, input);

  return html;
}

/**
 * Marker → data URI.
 *
 * The page renders real signed URLs, loads them, and reports what resolved; only afterwards is
 * each `src` swapped for a short opaque marker and the DOM serialized. So this is a literal
 * substitution over tokens this system chose, rather than a match against signed URLs whose
 * ampersands are entity-escaped by serialization and whose query strings are nobody's idea of a
 * safe search key.
 *
 * A marker with no replacement is left alone rather than blanked. The assertions then refuse the
 * document, which is the honest outcome: a report missing a capture is not a report to deliver,
 * and a blank `src` would have made it look like one.
 */
function substituteImages(html: string, images: ReadonlyMap<string, string>): string {
  let out = html;
  for (const [marker, dataUri] of images) {
    out = out.split(`"${marker}"`).join(`"${dataUri}"`);
  }
  return out;
}

/** Anything that executes, or that would show itself because nothing executes. */
function stripExecutable(html: string): string {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '')
      // See the header: with the scripts gone, this content would be *shown*, not hidden.
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      // React attaches handlers as properties rather than attributes, so there should be none of
      // these. Removed anyway: "should be none" is not a property of the delivered bytes.
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  );
}

/**
 * Every `<link>` that points at something.
 *
 * All of them, not a list of the ones known to be there. The stylesheet is inlined by
 * `injectHead`; `modulepreload`, `preload` and `prefetch` name the bundle that has just been
 * stripped; `preconnect` names a font CDN this document no longer uses; `icon` is chrome rather
 * than content. What they have in common is that each is a request the file would make, and the
 * file makes none.
 */
function stripResourceLinks(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, '');
}

/**
 * The head this document ships with.
 *
 * Rebuilt rather than edited. The head that comes out of the app is the app's — a bundle
 * reference, a font CDN, a favicon, a viewport — and almost none of it describes a frozen
 * document.
 *
 * `robots` is unconditional and it is the primary control. For an HTML document the meta tag is
 * the mechanism rather than a fallback: it travels with the bytes, so it holds if the file is ever
 * served from somewhere other than where it was written. The `X-Robots-Tag` header is set at the
 * serving layer where the serving layer can set one, as defence in depth.
 */
function injectHead(html: string, input: CaptureInput): string {
  const styles = [input.fontCss, ...input.css]
    .filter((sheet) => sheet.trim() !== '')
    .map((sheet) => `<style>${sheet}</style>`)
    .join('\n');

  const head =
    `<meta charset="utf-8">\n` +
    `<meta name="robots" content="noindex, nofollow">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    // Names the merchant and the run. A file on a desktop needs to say which document it is, and
    // the run id is the only identifier that is unambiguous across re-scans of one merchant.
    `<title>${escapeHtml(`Mintro screening report — ${input.merchantDomain}`)}</title>\n` +
    `<meta name="mintro-run" content="${escapeHtml(input.runId)}">\n` +
    styles;

  const open = html.search(/<head\b[^>]*>/i);
  const close = html.search(/<\/head>/i);

  if (open === -1 || close === -1 || close < open) {
    // No head to replace. Refused rather than repaired: a serialized document without one is not
    // the page this was pointed at, and guessing where to put a title is guessing what was
    // captured.
    throw new Error('the captured document has no <head> — refusing to assemble a report from it');
  }

  const openEnd = html.indexOf('>', open) + 1;
  return `${html.slice(0, openEnd)}\n${head}\n${html.slice(close)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    character === '&'
      ? '&amp;'
      : character === '<'
        ? '&lt;'
        : character === '>'
          ? '&gt;'
          : character === '"'
            ? '&quot;'
            : '&#39;',
  );
}

/** The ceiling. Exceeding it fails the job; it does not warn and proceed. */
export const CAPTURE_SIZE_CEILING_BYTES = 40 * 1024 * 1024;

/**
 * A floor, and the reason there is one.
 *
 * The failure this catches is not a big file, it is an empty one: a render that produced nothing,
 * a serialization that returned `<html></html>`, a page that errored into a blank state. Every one
 * of those passes "no scripts, no external URLs" perfectly. Silent failure rendering as an empty
 * state instead of an error is the recurring shape here (D-036, D-200, D-213), and a size check is
 * the cheapest thing that cannot be fooled by it.
 */
export const CAPTURE_SIZE_FLOOR_BYTES = 8 * 1024;

export interface CaptureExpectation {
  /** How many `<img>` the page reported. Every one must be inline in the delivered file. */
  readonly images: number;
  readonly runId: string;
}

/**
 * Refuses a document that is not fit to deliver.
 *
 * Returns nothing and throws on the first failure it finds, because there is no partial answer
 * here: every one of these means the job fails and no report is delivered.
 */
export function assertCapturable(html: string, expected: CaptureExpectation): void {
  const bytes = Buffer.byteLength(html, 'utf8');

  if (bytes < CAPTURE_SIZE_FLOOR_BYTES) {
    throw new Error(
      `the captured report is ${bytes} bytes, below the ${CAPTURE_SIZE_FLOOR_BYTES}-byte floor. ` +
        'A document this small is a render that did not happen, not a short report.',
    );
  }

  if (bytes > CAPTURE_SIZE_CEILING_BYTES) {
    throw new Error(
      `the captured report is ${(bytes / 1048576).toFixed(1)} MB, over the ` +
        `${CAPTURE_SIZE_CEILING_BYTES / 1048576} MB ceiling. The job fails rather than delivering ` +
        'a document that cannot reasonably be opened.',
    );
  }

  if (/<script\b/i.test(html)) {
    throw new Error(
      'the captured report contains a <script>. A report that executes anything is a report whose ' +
        'output depends on the day it is opened.',
    );
  }

  if (/<noscript\b/i.test(html)) {
    throw new Error(
      'the captured report contains a <noscript>, whose content would be shown — the file has no ' +
        'scripts, so it is a scripting-disabled context by construction.',
    );
  }

  if (/<link\b/i.test(html)) {
    throw new Error('the captured report contains a <link>, which is a request it would make');
  }

  if (/@import\b/i.test(html)) {
    throw new Error('the captured report contains an @import, which is an external stylesheet');
  }

  if (!/<meta\s+name="robots"\s+content="noindex, nofollow">/i.test(html)) {
    throw new Error('the captured report has no noindex meta tag');
  }

  if (!html.includes(expected.runId)) {
    throw new Error(
      `the captured report does not mention run ${expected.runId}. It is not the document this ` +
        'job set out to capture.',
    );
  }

  const external = externalReferences(html);
  if (external.length > 0) {
    throw new Error(
      `the captured report has ${external.length} reference(s) that are not inline: ` +
        `${external.slice(0, 5).join(', ')}${external.length > 5 ? ', …' : ''}`,
    );
  }

  /*
    Every capture the page displayed is in the file.

    Counted rather than sampled, and compared against what the *page* reported rather than against
    what this function can see, so "some of the images inlined" cannot read as success. This is the
    assertion that catches a marker whose bytes could not be fetched: the substitution leaves the
    marker in place, the count comes up short, and the job fails instead of delivering a report
    with a hole where a screenshot should be.
  */
  const inlined = (html.match(/<img\b[^>]*\ssrc="data:image\//gi) ?? []).length;
  if (inlined !== expected.images) {
    throw new Error(
      `the captured report inlines ${inlined} image(s) and the page displayed ${expected.images}. ` +
        'A report missing a capture is not a report to deliver.',
    );
  }
}

/**
 * Anything the document would fetch.
 *
 * Resource attributes only. An `href` on an anchor is a *citation* — the source URL a finding was
 * observed at — and those are absolute, external, and the point of the document; stripping them
 * would remove the evidence trail. What must not survive is a **relative** reference of any kind,
 * because the origin it would resolve against is a storage bucket, and a fragment reference to a
 * page the file no longer sits beside resolves to nothing.
 */
function externalReferences(html: string): readonly string[] {
  const bad: string[] = [];

  for (const match of html.matchAll(/\s(src|srcset|poster)\s*=\s*"([^"]*)"/gi)) {
    const value = match[2]!.trim();
    if (!value.startsWith('data:')) bad.push(`${match[1]}="${value.slice(0, 60)}"`);
  }

  for (const match of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const value = match[2]!.trim();
    if (!value.startsWith('data:') && !value.startsWith('#')) bad.push(`url(${value.slice(0, 60)})`);
  }

  for (const match of html.matchAll(/\shref\s*=\s*"([^"]*)"/gi)) {
    const value = match[1]!.trim();
    // Absolute citations stay. Fragments stay — they address this document. Everything else is a
    // path that resolves against wherever the file happens to be sitting.
    if (value.startsWith('https://') || value.startsWith('http://') || value.startsWith('#')) continue;
    if (value.startsWith('mailto:')) continue;
    bad.push(`href="${value.slice(0, 60)}"`);
  }

  return bad;
}
