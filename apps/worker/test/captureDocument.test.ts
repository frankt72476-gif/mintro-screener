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
const filler = `<p>${'observation '.repeat(900)}</p>`;

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
