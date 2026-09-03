/**
 * What the delivered file may and may not contain.
 *
 * The useful assertions are about the captured bytes, not the render path. A report that reaches
 * an underwriter with a hole in it has already done its damage, so every one of these is a job
 * failure rather than a defect logged against a file that went anyway.
 *
 * **The refusals carry the weight here.** A guard that has never been made to fire is not a guard,
 * so each one is given the thing it exists to catch — including the empty capture, which is the
 * failure most likely to happen and least likely to look like one: an empty document passes "no
 * scripts, no external references" perfectly.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHARACTERISATION_TERMS,
  DETERMINATION_TERMS,
  DIRECTIVE_TERMS,
  REMEDY_TERMS,
  REPORT_POSTURE,
  auditCopy,
} from '@mintro/engine';
import {
  CAPTURE_SIZE_CEILING_BYTES,
  CAPTURE_SIZE_FLOOR_BYTES,
  assembleCapture,
  assertCapturable,
} from '../src/capture/document.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A rendered page, near enough to what `page.content()` gives. */
function rendered(body: string, head = ''): string {
  return `<!DOCTYPE html><html lang="en" class="printing"><head><title>app</title>${head}</head><body>${body}</body></html>`;
}

/** Padding, so a document under test clears the floor for reasons other than the one being tested. */
const filler = `<p class="posture">${REPORT_POSTURE}</p><p>${'observation '.repeat(900)}</p>`;

function capture(
  body: string,
  options: { readonly head?: string; readonly images?: Map<string, string> } = {},
): string {
  return assembleCapture({
    html: rendered(body + filler, options.head ?? ''),
    css: ['.a{color:red}'],
    fontCss: "@font-face{font-family:'Inter';src:url(data:font/woff2;base64,AA) format('woff2')}",
    images: options.images ?? new Map(),
    merchantDomain: 'example.test',
    runId: RUN,
  });
}

describe('assembling the document', () => {
  it('carries the noindex meta and the run it is about', () => {
    const html = capture('<p>report</p>');

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain(RUN);
  });

  it('inlines the stylesheet and the fonts, and links to neither', () => {
    const html = capture('<p>report</p>', { head: '<link rel="stylesheet" href="/assets/index.css">' });

    expect(html).toContain('.a{color:red}');
    expect(html).toContain('@font-face');
    expect(html).not.toContain('<link');
  });

  it('names the merchant in the title without letting it become markup', () => {
    const html = assembleCapture({
      html: rendered(filler),
      css: [],
      fontCss: '',
      images: new Map(),
      // A domain is attacker-adjacent input: it comes from the merchant, and it lands in a
      // document sent to a third party.
      merchantDomain: '<script>alert(1)</script>.test',
      runId: RUN,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('replaces every image marker with its data URI', () => {
    const html = capture('<img src="#mintro-capture-0"><img src="#mintro-capture-1">', {
      images: new Map([
        ['#mintro-capture-0', PNG],
        ['#mintro-capture-1', PNG],
      ]),
    });

    expect(html).not.toContain('#mintro-capture-');
    expect(html.match(/src="data:image\/png/g)).toHaveLength(2);
  });

  it('strips the bundle, and the noscript nobody expects', () => {
    /*
      The scripts are the obvious half. `<noscript>` is the half that surprises people: a captured
      file has no scripts by construction, so it is a scripting-disabled context, and whatever the
      app author wrote for that case is *shown* — in the middle of a screening report.
    */
    const html = capture(
      '<p>report</p><script>alert(1)</script><noscript>Enable JavaScript to use this app.</noscript>',
      { head: '<script type="module" src="/assets/index.js"></script>' },
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<noscript');
    expect(html).not.toContain('Enable JavaScript');
  });

  it('strips inline event handlers', () => {
    const html = capture('<div onclick="steal()" onmouseover=\'x()\'>report</div>');

    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
  });

  it('refuses a document with no head rather than repairing one', () => {
    expect(() =>
      assembleCapture({
        html: '<p>no head here</p>',
        css: [],
        fontCss: '',
        images: new Map(),
        merchantDomain: 'example.test',
        runId: RUN,
      }),
    ).toThrow(/no <head>/);
  });
});

describe('what the file is refused for', () => {
  const ok = (body: string, images = 0): void =>
    assertCapturable(capture(body), { images, runId: RUN });

  it('accepts a document that is fit to deliver', () => {
    // The control. Without it every refusal below would pass against a guard that refuses
    // everything, which is the failure mode of a suite made only of negatives.
    expect(() => ok('<p>report</p>')).not.toThrow();
  });

  it('refuses an empty capture', () => {
    /*
      The one the spec asks for by name, and the reason the floor exists. A render that produced
      nothing, a serialization that returned a shell, a page that errored into a blank state —
      every one of those satisfies "no scripts, no external references" perfectly.
    */
    expect(() => assertCapturable('', { images: 0, runId: RUN })).toThrow(/floor|bytes/i);
    expect(() => assertCapturable('<html></html>', { images: 0, runId: RUN })).toThrow(/floor|bytes/i);
    expect(CAPTURE_SIZE_FLOOR_BYTES).toBeGreaterThan(0);
  });

  it('refuses a document over the ceiling', () => {
    // 40 MB, and it fails the job. It does not warn and proceed.
    const huge = capture(`<p>${'x'.repeat(CAPTURE_SIZE_CEILING_BYTES)}</p>`);

    expect(() => assertCapturable(huge, { images: 0, runId: RUN })).toThrow(/ceiling/);
  });

  it('refuses a surviving script, noscript, link or @import', () => {
    for (const [body, pattern] of [
      ['<script>x()</script>', /<script>/],
      ['<noscript>x</noscript>', /<noscript>/],
      ['<link rel="stylesheet" href="https://x.test/a.css">', /<link>/],
      ['<style>@import url(https://x.test/a.css);</style>', /@import/],
    ] as const) {
      // Assembled around the stripper rather than through it — this asserts the *check*, so it is
      // given a document the stripper never saw.
      const html = capture('<p>report</p>').replace('</body>', `${body}</body>`);
      expect(() => assertCapturable(html, { images: 0, runId: RUN }), body).toThrow(pattern);
    }
  });

  it('refuses a missing noindex meta', () => {
    const html = capture('<p>report</p>').replace(
      '<meta name="robots" content="noindex, nofollow">',
      '',
    );

    expect(() => assertCapturable(html, { images: 0, runId: RUN })).toThrow(/noindex/);
  });

  it('refuses a document about a different run', () => {
    expect(() =>
      assertCapturable(capture('<p>report</p>'), {
        images: 0,
        runId: '99999999-9999-4999-8999-999999999999',
      }),
    ).toThrow(/not the document/);
  });

  it('refuses any reference that is not inline', () => {
    for (const body of [
      '<img src="https://cdn.test/shot.png">',
      '<img src="/assets/shot.png">',
      '<div style="background:url(/assets/x.png)"></div>',
      '<video poster="https://cdn.test/p.jpg"></video>',
    ]) {
      const html = capture('<p>report</p>').replace('</body>', `${body}</body>`);
      expect(() => assertCapturable(html, { images: 0, runId: RUN }), body).toThrow(/not inline/);
    }
  });

  it('refuses a relative href while keeping the citations', () => {
    /*
      An `href` on an anchor is a citation — the source URL a finding was observed at — and those
      are the evidence trail. What must not survive is a *relative* one: the origin it resolves
      against is wherever the file happens to be sitting.
    */
    const cited = capture('<a href="https://merchant.test/collections/weight-loss">source</a>');
    expect(() => assertCapturable(cited, { images: 0, runId: RUN })).not.toThrow();

    const fragment = capture('<a href="#finding-4">GATE-002</a>');
    expect(() => assertCapturable(fragment, { images: 0, runId: RUN })).not.toThrow();

    const relative = capture('<a href="/report/other">other</a>');
    expect(() => assertCapturable(relative, { images: 0, runId: RUN })).toThrow(/not inline/);
  });

  it('refuses a marker whose bytes could not be fetched', () => {
    /*
      Substitution leaves an unmatched marker in place rather than blanking it, so the document
      still says which capture is missing. Two guards catch it — the reference check first, because
      a `src` that is not a data URI is a request the file would make. Either is a job failure;
      what matters is that the report does not go with a hole where a screenshot should be.
    */
    const html = capture('<img src="#mintro-capture-0"><img src="#mintro-capture-1">', {
      images: new Map([['#mintro-capture-0', PNG]]),
    });

    expect(() => assertCapturable(html, { images: 2, runId: RUN })).toThrow(/not inline/);
  });

  it('refuses a report holding fewer captures than the page displayed', () => {
    /*
      The count guard on its own, given a document that is otherwise perfect: every image in it is
      properly inline, and one the page displayed is simply not there. Nothing else in the suite
      would notice — which is exactly why "some of the images inlined" must not read as success.
    */
    const html = capture('<img src="#mintro-capture-0">', {
      images: new Map([['#mintro-capture-0', PNG]]),
    });

    expect(() => assertCapturable(html, { images: 2, runId: RUN })).toThrow(/inlines 1 image/);
    expect(() => assertCapturable(html, { images: 1, runId: RUN })).not.toThrow();
  });

  it('accepts when every displayed capture is inline', () => {
    const html = capture('<img src="#mintro-capture-0"><img src="#mintro-capture-1">', {
      images: new Map([
        ['#mintro-capture-0', PNG],
        ['#mintro-capture-1', PNG],
      ]),
    });

    expect(() => assertCapturable(html, { images: 2, runId: RUN })).not.toThrow();
  });
});

/**
 * Against a document shaped like the real one.
 *
 * Every other test in this file builds its own HTML, and that is how the lockup defect survived:
 * the fixtures were written from the same idea of the page as the code was, so both were missing
 * the same image. The guard fired on everything in production and on nothing here.
 *
 * `fixtures/print-dom.html` is the print route's actual shape — a brand lockup with a relative
 * `src`, evidence images behind signed URLs, a stylesheet link, a module script, a Google Fonts
 * link and a `<noscript>`.
 */
describe('the real print DOM', () => {
  const fixture = readFileSync('apps/worker/test/fixtures/print-dom.html', 'utf8');

  /** Every image the page displayed, marked — the lockup included. */
  const allMarked = new Map([
    ['#mintro-capture-0', PNG],
    ['#mintro-capture-1', PNG],
    ['#mintro-capture-2', PNG],
  ]);

  /**
   * Marks the first `markers` images, the way `capture.ts` does in the page.
   *
   * `<img>` only. An earlier version matched every `src=` and put the first marker on the module
   * script, which is not an image and is stripped anyway — so the last evidence capture went
   * unmarked and the failure looked like the bug this fixture is here to catch. Worth keeping in
   * mind: a helper that is nearly right produces a failure that reads as a real one.
   */
  const markUp = (html: string, markers: number): string => {
    let index = 0;
    return html.replace(
      /<img([^>]*?)src="(?!data:)[^"]*"/g,
      (match, rest: string) =>
        index < markers ? `<img${rest}src="#mintro-capture-${index++}"` : match,
    );
  };

  /*
    Stylesheet bulk, so the fixture clears the floor for the reason a real capture does.

    The fixture body is a trimmed report — a few kilobytes — while a delivered file carries the
    app's 88 KB stylesheet and 1.1 MB of inlined fonts before a single finding. Passing a
    one-rule stylesheet here would put the document under the 8 KB floor and every assertion below
    would fail on size rather than on the thing it is testing.
  */
  const bulkCss = `.a{color:red}${'.pad{margin:0}'.repeat(700)}`;

  const captureFixture = (markers: number, images = allMarked): string =>
    assembleCapture({
      html: markUp(fixture, markers),
      css: [bulkCss],
      fontCss: '@font-face{font-family:X;src:url(data:font/woff2;base64,AA) format("woff2")}',
      images,
      merchantDomain: 'example-peptides.test',
      runId: RUN,
    });

  it('delivers when every image is marked and inlined', () => {
    const html = captureFixture(3);

    expect(() => assertCapturable(html, { images: 3, runId: RUN })).not.toThrow();
    expect(html.match(/src="data:image\/png/g)).toHaveLength(3);
  });

  it('refuses the document when the brand lockup is left behind', () => {
    /*
      The defect, reproduced. Marking only the two evidence images is exactly what the first
      version of `capture.ts` did — it marked images found in the injected evidence map, and the
      lockup is not in it.

      The lockup is in every report, so this was not an edge case: it was every capture.
    */
    const html = captureFixture(2);

    expect(html).toContain('/brand/mintro-lockup-full.png');
    expect(() => assertCapturable(html, { images: 3, runId: RUN })).toThrow(/not inline/);
  });

  it('strips the bundle, the font link and the noscript out of the real shape', () => {
    const html = captureFixture(3);

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<noscript');
    expect(html).not.toContain('This application requires JavaScript');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('/assets/index-');
  });

  it('keeps the masthead and the findings', () => {
    // The strip must not take the document with it. A capture that passed every refusal by being
    // empty of content is the failure the floor exists for, and this is the positive half.
    const html = captureFixture(3);

    expect(html).toContain('example-peptides.test');
    expect(html).toContain('Rule set v2.4.0');
    expect(html).toContain('GATE-002');
    expect(html).toContain('The footer states research use only.');
  });
});

/**
 * The one sentence that has to survive into the artifact.
 *
 * A captured report is a forwardable link. Someone at the sponsoring bank may open it with no
 * covering email, having never heard of Mintro, and `REPORT_POSTURE` is the only thing in the
 * document that tells them what they are reading. Anything that lived only in `send.ts` would not
 * have travelled with it.
 */
describe('what the report says about itself', () => {
  it('is required in the delivered file', () => {
    const without = capture('<p>report</p>').replace(REPORT_POSTURE, '');

    expect(() => assertCapturable(without, { images: 0, runId: RUN })).toThrow(/statement of what it is/);
  });

  it('is present in the real print DOM', () => {
    // In the fixture because ReportView renders it into the masthead. If it is ever moved out of
    // the captured surface, this fails alongside the guard rather than after it.
    const fixture = readFileSync('apps/worker/test/fixtures/print-dom.html', 'utf8');

    expect(fixture).toContain(REPORT_POSTURE);
  });

  it('makes no determination and characterises nothing', () => {
    /*
      Frank's copy, audited rather than trusted. It states what Mintro did — reviewed public pages,
      recorded what it found — and never what anyone should conclude or do.

      `CHARACTERISATION_TERMS` is the one to watch: "issues", "problems", "concerns" are readings,
      and IQwallet makes them. "Things" is doing deliberate work in this sentence.
    */
    for (const terms of [DIRECTIVE_TERMS, DETERMINATION_TERMS, CHARACTERISATION_TERMS, REMEDY_TERMS]) {
      expect(auditCopy(REPORT_POSTURE, terms).flagged).toEqual([]);
    }
  });

  it('holds on the blocked-package path, where IQwallet never receives it', () => {
    // "Before the underwriting team makes its boarding decision" describes a sequence, not a
    // recipient — so the sentence stays true when the report goes only to the agent.
    expect(REPORT_POSTURE).not.toContain('IQwallet');
    expect(REPORT_POSTURE).not.toMatch(/attached|enclosed|this email/i);
  });
});
