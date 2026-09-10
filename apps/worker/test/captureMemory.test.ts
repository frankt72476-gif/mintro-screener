/**
 * Assembling a capture must not cost a multiple of the capture (D-275).
 *
 * ## What happened
 *
 * Run `50a49af8` (cheatcodespeptides.com) published version 1 at 2026-09-10T20:46:30Z. The capture
 * request was claimed one second later and the worker was **OOM-killed**: 786,940 kB of anonymous
 * memory on a 1024 MB machine. The stale-claim reaper handed the job back fifteen minutes later,
 * to the second, and it died again the same way. Two kills, same point, same run.
 *
 * The run has sixty captures. `substituteImages` was `split(marker).join(dataUri)` once per image
 * over a single growing string, and the three strip-and-inject passes ran *after* it, each
 * rewriting the inflated document. So the assembler built roughly sixty ever-larger copies plus
 * three more of the finished size, to produce one file.
 *
 * ## What is asserted, and what is not
 *
 * Peak resident memory is not a property this suite can measure honestly — `process.memoryUsage()`
 * across a garbage collector says more about when the collector ran than about what the code
 * allocated. What *is* a fact about the code is the **shape of the copying**, and the quadratic
 * loop shows up in the clock: that is what the timing test below asserts, with a bound loose enough
 * to mean *not quadratic* rather than to name a speed.
 *
 * **The reordering is not asserted, and this says so rather than pretending.** Moving the
 * substitution after the three strip passes saves three copies of the inflated document, and it
 * changes the output not at all: base64 is `[A-Za-z0-9+/=]`, so a data URI can hold neither the
 * `<` that `stripExecutable` and `stripResourceLinks` need nor the quoted `on…=` attribute form.
 * A test claiming to observe the order would be a test of nothing. What is asserted is that the
 * stripping still happens after the move, which is the thing the reorder could plausibly break.
 */

import { describe, expect, it } from 'vitest';
import { assembleCapture } from '../src/capture/document.js';
import { MARKER_PREFIX } from '../src/capture.js';

/** A base64 payload of a given size, deterministic so a failure is reproducible (D-106). */
const payload = (bytes: number): string =>
  `data:image/png;base64,${'QUJDRA'.repeat(Math.ceil(bytes / 6)).slice(0, bytes)}`;

function document(images: number, bytesEach: number): {
  readonly html: string;
  readonly images: Map<string, string>;
} {
  const map = new Map<string, string>();
  const tags: string[] = [];

  for (let index = 0; index < images; index += 1) {
    const marker = `${MARKER_PREFIX}${index}`;
    map.set(marker, payload(bytesEach));
    tags.push(`<img src="${marker}" alt="capture ${index}">`);
  }

  return {
    html: `<html><head><title>r</title></head><body>${tags.join('')}</body></html>`,
    images: map,
  };
}

const assemble = (input: { html: string; images: Map<string, string> }): string =>
  assembleCapture({
    html: input.html,
    css: [],
    fontCss: '',
    images: input.images,
    merchantDomain: 'shop.example',
    runId: '11111111-2222-4333-8444-555555555555',
  });

describe('every marker is replaced', () => {
  it('substitutes all sixty, which is what run 50a49af8 carried', () => {
    const built = assemble(document(60, 512));

    expect(built).not.toContain(MARKER_PREFIX);
    expect(built.split('data:image/png;base64,')).toHaveLength(61);
  });

  /*
    A marker with no replacement is left alone rather than blanked, so the assertions refuse the
    document. A blank `src` would make a report missing its evidence look like one that has it.
  */
  it('leaves a marker with no bytes alone rather than blanking it', () => {
    const built = assemble({
      html: `<html><head><title>r</title></head><body><img src="${MARKER_PREFIX}0"><img src="${MARKER_PREFIX}1"></body></html>`,
      images: new Map([[`${MARKER_PREFIX}0`, payload(64)]]),
    });

    expect(built).toContain(`src="${MARKER_PREFIX}1"`);
    expect(built).not.toContain('src=""');
  });
});

describe('the document is inflated once', () => {
  /*
    The shape of the old bug, in one number.

    Quadratic copying is invisible in the output and plain in the clock: sixty images at a hundred
    kilobytes each took time proportional to the square of the total under the old assembler and is
    linear under this one. The bound is deliberately loose — this asserts *not quadratic*, not a
    performance target, and a loose bound is one that does not fail on a busy machine.
  */
  it('assembles six megabytes of images without quadratic cost', () => {
    const small = document(6, 100_000);
    const large = document(60, 100_000);

    const timed = (input: ReturnType<typeof document>): number => {
      const started = performance.now();
      const built = assemble(input);
      expect(built.length).toBeGreaterThan(input.images.size * 100_000);
      return performance.now() - started;
    };

    timed(small); // warm, so the first-call cost is not the measurement
    const one = Math.max(timed(small), 1);
    const ten = timed(large);

    // Ten times the images. Linear would be ~10×; the old loop was ~100×. Twenty-five is neither.
    expect(ten / one).toBeLessThan(25);
  });
});

describe('the stripping still happens after the reorder', () => {
  /*
    The one thing moving the substitution to the end could break.

    It cannot change what the strip passes match — base64 carries no `<` and no quoted attribute —
    so the risk is not that they edit an image, it is that a reordering drops one. Both are asserted
    on one document, so neither can be satisfied by simply not stripping.
  */
  it('strips scripts and handlers from the markup, and leaves the image whole', () => {
    const bytes = payload(64);
    const built = assemble({
      html:
        `<html><head><title>r</title></head><body><script>alert(1)</script>` +
        `<img src="${MARKER_PREFIX}0" onerror="x()"></body></html>`,
      images: new Map([[`${MARKER_PREFIX}0`, bytes]]),
    });

    expect(built).not.toContain('alert(1)');
    expect(built).not.toContain('onerror=');
    expect(built).toContain(bytes);
  });

  /*
    And the `<link>` pass, which is the other one that now runs while the document is small. A
    stylesheet link left in the file is a request the delivered bytes would make, which is the whole
    reason the pass exists.
  */
  it('strips resource links', () => {
    const built = assemble({
      html:
        `<html><head><title>r</title><link rel="stylesheet" href="/a.css"></head>` +
        `<body><img src="${MARKER_PREFIX}0"></body></html>`,
      images: new Map([[`${MARKER_PREFIX}0`, payload(64)]]),
    });

    expect(built).not.toContain('/a.css');
  });
});
