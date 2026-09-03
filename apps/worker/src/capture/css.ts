/**
 * The stylesheet, made to work in a file rather than in a printer.
 *
 * A captured report is opened **on screen**, in a browser, by someone at IQwallet. The document it
 * has to look like is the *printed* one — the layout the PDF produced. Those are two different
 * media, and the app's stylesheet distinguishes them in two ways that behave very differently once
 * the bytes are frozen.
 *
 * ## `.printing` survives; `@media print` does not
 *
 * `App.tsx` puts a `printing` class on the root element, and 45 selectors key off it. Those work
 * anywhere, including in a saved file.
 *
 * The other 23 blocks are `@media print`, and they are **not decoration**. They carry
 * `.rail,.acts,.chip,.caret{display:none!important}`, `.shell{display:block}`,
 * `.cat-body,.ev{display:block!important}`, `.print-head{display:flex!important}`,
 * `.headbar{display:none}`, `.navcards{display:none}`. Captured verbatim and opened on screen,
 * none of them apply: the report renders with the analyst rail beside it, the nav cards above it,
 * every category body collapsed and no masthead. It would read as a screenshot of the app rather
 * than as a document.
 *
 * So the wrapper comes off and the rules inside become unconditional.
 *
 * ## Why in place, and not appended
 *
 * Because the cascade decides ties by document order, and a media query adds no specificity. In a
 * real print render both the screen rules and the print rules apply, and where two rules of equal
 * specificity disagree the later one in the file wins. Hoisting every print block to the end of
 * the stylesheet would hand each of them a win it does not currently have — silently, in a
 * document nobody re-renders to compare.
 *
 * Replacing each block **exactly where it sits** reproduces the print cascade rather than
 * approximating it. It costs nothing and it is the difference between a faithful capture and one
 * that is subtly not the document that was reviewed.
 *
 * What is left over is inert rather than wrong: `break-inside`, `page-break-inside`, `break-after`
 * and `string-set` do nothing outside paged media, and a nested `@page { @top-left { … } }` hoists
 * to a valid top-level `@page` rule that a screen render ignores.
 */

/** A `url(...)` reference found in a stylesheet, with the value as it appears in the text. */
export interface CssUrlReference {
  /** Exactly as written, quotes and all, so a replacement can be done by literal substitution. */
  readonly raw: string;
  /** The URL itself, unquoted. */
  readonly url: string;
}

/**
 * Unwraps every `@media print` block, leaving its rules at the same position in the file.
 *
 * Brace-counting rather than a regular expression, because these blocks nest: several of them
 * contain `@page { @top-right { … } }`, which is two levels deep, and a lazy `[^}]*` match stops
 * at the first inner brace and cuts a rule in half. A malformed stylesheet is a report that
 * renders wrong in a way nobody notices until it is somebody's evidence.
 */
export function hoistPrintRules(css: string): string {
  let out = '';
  let cursor = 0;

  for (;;) {
    const start = css.indexOf('@media print', cursor);
    if (start === -1) {
      out += css.slice(cursor);
      return out;
    }

    const open = css.indexOf('{', start);
    if (open === -1) {
      // A truncated stylesheet. Copy the rest verbatim rather than inventing a closing brace.
      out += css.slice(cursor);
      return out;
    }

    const close = matchingBrace(css, open);
    if (close === -1) {
      out += css.slice(cursor);
      return out;
    }

    out += css.slice(cursor, start);
    // The block's contents, in place. A newline either side so an unterminated final declaration
    // cannot run into the next rule.
    out += `\n${css.slice(open + 1, close).trim()}\n`;
    cursor = close + 1;
  }
}

/** The index of the `}` closing the `{` at `open`, or -1 if the stylesheet ends first. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every `url(...)` in a stylesheet that is not already inline.
 *
 * `data:` is skipped because it is already self-contained, and `#` because an SVG fragment
 * reference points inside the document rather than out of it. Everything else has to be fetched
 * and inlined or the captured file has a hole in it.
 */
export function cssUrlReferences(css: string): readonly CssUrlReference[] {
  const found = new Map<string, CssUrlReference>();

  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const url = match[2]!.trim();
    if (url.startsWith('data:') || url.startsWith('#')) continue;
    found.set(match[0], { raw: match[0], url });
  }

  return [...found.values()];
}

/**
 * Removes `@import` rules.
 *
 * An `@import` is an external stylesheet reference that no amount of inlining the *link* elements
 * would catch, and one surviving in a captured file is a report whose appearance depends on a
 * server answering years from now. There are none today; this exists so that adding one does not
 * quietly become a network dependency in a frozen document. The assertions refuse the file if one
 * survives, so this is the removal and that is the proof.
 */
export function stripImports(css: string): string {
  return css.replace(/@import\s+[^;]+;/g, '');
}
