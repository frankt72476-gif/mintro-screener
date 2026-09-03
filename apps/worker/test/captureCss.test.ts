/**
 * The print rules survive the move to screen, and land where they were.
 *
 * A captured report is read on screen and has to look like the printed document. `@media print`
 * does not apply on screen, and the app keeps rules there that are not decoration — hiding the
 * analyst rail, expanding category bodies, showing the masthead. Captured verbatim, the report
 * would open looking like a screenshot of the app.
 *
 * Two things are asserted, and the second is the one that would be easy to get wrong: the rules
 * become unconditional, **and they stay at the same offset in the file**. Media queries add no
 * specificity, so the cascade decides ties by document order. Appending the hoisted blocks would
 * hand each of them a win over an equal-specificity screen rule that currently beats it — in a
 * document nobody re-renders to compare.
 */

import { describe, expect, it } from 'vitest';
import { cssUrlReferences, hoistPrintRules, stripImports } from '../src/capture/css.js';

describe('hoisting print rules', () => {
  it('unwraps a block, leaving its rules', () => {
    const out = hoistPrintRules('a{color:red}@media print{.rail{display:none}}b{color:blue}');

    expect(out).not.toContain('@media print');
    expect(out).toContain('.rail{display:none}');
    expect(out).toContain('a{color:red}');
    expect(out).toContain('b{color:blue}');
  });

  it('leaves the rules where they were, not at the end', () => {
    // The assertion this file exists for. `.x` loses to the later `.x` today; it must still lose.
    const out = hoistPrintRules('@media print{.x{color:red}}.x{color:blue}');

    expect(out.indexOf('color:red')).toBeLessThan(out.indexOf('color:blue'));
  });

  it('handles the nested @page rules without cutting them in half', () => {
    /*
      Several blocks contain `@page{@top-right{…}}`, which is two levels deep. A lazy `[^}]*` match
      stops at the first inner brace and truncates the stylesheet — and a truncated stylesheet is a
      report that renders wrong in a way nobody notices until it is somebody's evidence.
    */
    const css = '@media print{.b{break-after:avoid}@page{@top-right{content:string(band)}}}.after{color:red}';
    const out = hoistPrintRules(css);

    expect(out).toContain('@page{@top-right{content:string(band)}}');
    expect(out).toContain('.after{color:red}');
    expect(out).not.toContain('@media print');
    // Braces still balance. The cheapest proof that nothing was cut.
    expect([...out].filter((c) => c === '{')).toHaveLength([...out].filter((c) => c === '}').length);
  });

  it('unwraps every block, not the first', () => {
    const out = hoistPrintRules('@media print{.a{x:1}}p{}@media print{.b{y:2}}q{}@media print{.c{z:3}}');

    expect(out).not.toContain('@media print');
    for (const rule of ['.a{x:1}', '.b{y:2}', '.c{z:3}']) expect(out).toContain(rule);
  });

  it('leaves other media queries alone', () => {
    // Only `print` is unreachable in a saved file. A width query still means something.
    const out = hoistPrintRules('@media (max-width:720px){.a{x:1}}@media print{.b{y:2}}');

    expect(out).toContain('@media (max-width:720px){.a{x:1}}');
    expect(out).not.toContain('@media print');
  });

  it('does not invent a closing brace for a truncated stylesheet', () => {
    // Copied through rather than repaired. Guessing where a rule ended is guessing what was styled.
    const out = hoistPrintRules('a{color:red}@media print{.x{y:1}');

    expect(out).toContain('a{color:red}');
  });

  it('is a no-op on a stylesheet with no print rules', () => {
    const css = '.a{color:red}@media (max-width:720px){.b{color:blue}}';

    expect(hoistPrintRules(css)).toBe(css);
  });

  it('handles the real stylesheet', () => {
    // Against the shape the built CSS actually has: 23 blocks in 88 KB, several with nested @page.
    const css = Array.from(
      { length: 23 },
      (_, i) => `.s${i}{color:red}@media print{.p${i}{display:none}@page{@top-left{content:""}}}`,
    ).join('');
    const out = hoistPrintRules(css);

    expect(out).not.toContain('@media print');
    expect((out.match(/@page/g) ?? []).length).toBe(23);
    expect([...out].filter((c) => c === '{')).toHaveLength([...out].filter((c) => c === '}').length);
  });
});

describe('finding what a stylesheet points at', () => {
  it('reports every url(), quoted or not', () => {
    const refs = cssUrlReferences(`a{background:url(/a.png)}b{background:url("/b.png")}c{background:url('/c.png')}`);

    expect(refs.map((reference) => reference.url).sort()).toEqual(['/a.png', '/b.png', '/c.png']);
  });

  it('skips what is already inline, and fragments', () => {
    // A data URI is self-contained; a `#` points inside this document.
    const refs = cssUrlReferences('a{background:url(data:image/png;base64,AA)}b{filter:url(#blur)}');

    expect(refs).toEqual([]);
  });

  it('reports each distinct reference once', () => {
    const refs = cssUrlReferences('a{background:url(/x.png)}b{background:url(/x.png)}');

    expect(refs).toHaveLength(1);
    // The raw text is what a caller substitutes on, so it has to come back verbatim.
    expect(refs[0]!.raw).toBe('url(/x.png)');
  });
});

describe('@import', () => {
  it('is removed', () => {
    // An external stylesheet no amount of inlining <link> elements would catch. There are none
    // today; this exists so adding one does not become a network dependency in a frozen document.
    expect(stripImports('@import url("other.css");a{color:red}')).toBe('a{color:red}');
  });
});
