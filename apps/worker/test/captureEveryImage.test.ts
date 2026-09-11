/**
 * Every image the page displayed reaches the file, and each capture is written once (D-277).
 *
 * ## What was refused
 *
 * The Cheat Codes capture (run `50a49af8`, evaluation `877304a4`) failed with:
 *
 *     the captured report inlines 1 image(s) and the page displayed 95.
 *
 * The marker step had created all ninety-five markers and they were thrown away with the elements
 * carrying them: a marker is a fragment, a fragment resolves to the page itself, the page is HTML
 * rather than an image, so setting it fired `error` on every image — and `EvidenceSlip`'s `Shot`
 * answers `error` by rendering *capture not reachable* in the image's place. `capture.ts` replaces
 * each image with a listener-free clone before marking it now, and `captureMarkers.test.ts` is the
 * regression for that half.
 *
 * ## And then the document was 182.7 MB
 *
 * Ninety-four of those images are **eleven distinct screenshots**, one of them cited twenty-two
 * times. Writing the bytes into each `src` turned 15.0 MB of PNG into a 182.7 MB document against a
 * 40 MB ceiling. Each capture is written once now and pointed at by class: 20.0 MB, at full
 * resolution, with the ceiling untouched.
 */

import { describe, expect, it } from 'vitest';
import { EVALUATION_POSTURE } from '@mintro/engine';
import { assembleCapture, assertCapturable, CAPTURE_SIZE_CEILING_BYTES } from '../src/capture/document.js';
import { CAPTURE_CLASS, PLACEHOLDER_PIXEL, pngSize } from '../src/capture/images.js';
import { MARKER_PREFIX } from '../src/capture.js';

/** The run's own shape: ninety-four evidence images drawn from eleven distinct screenshots. */
const EVIDENCE_IMAGES = 94;
const DISTINCT_CAPTURES = 11;

/**
 * A real PNG of the given dimensions, so `pngSize` reads what the fixture claims.
 *
 * The header is built rather than the whole file: IHDR is the first twenty-four bytes and is all
 * the assembler reads. The tail is deterministic filler of a fixed length, so no payload is a
 * prefix of another and counting occurrences of one does not count the rest (D-106).
 */
function png(width: number, height: number, id: number): string {
  const head = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);

  const tail = Buffer.alloc(1_200, id % 251);
  return `data:image/png;base64,${Buffer.concat([head, tail]).toString('base64')}`;
}

/**
 * A document shaped like the evaluation's section 6: one `<img>` per citing finding, several
 * findings showing the same capture, plus the masthead lockup, which is an app asset.
 */
function document(): { readonly html: string; readonly images: Map<string, string> } {
  const captures = Array.from({ length: DISTINCT_CAPTURES }, (_, index) =>
    png(1280, 2000 + index * 100, index + 1),
  );
  const images = new Map<string, string>();

  const tags: string[] = [`<img src="${MARKER_PREFIX}0" alt="Mintro">`];
  images.set(`${MARKER_PREFIX}0`, png(240, 60, 200));

  for (let index = 0; index < EVIDENCE_IMAGES; index += 1) {
    const marker = `${MARKER_PREFIX}${index + 1}`;
    images.set(marker, captures[index % DISTINCT_CAPTURES]!);
    tags.push(`<img class="shot-img" src="${marker}" alt="Full-page screenshot">`);
  }

  return { html: page(tags), images };
}

/**
 * The wrapper every fixture needs to reach the assertions.
 *
 * `assertCapturable` refuses a document that does not carry the posture statement, the run id and
 * the published version — so a fixture without them fails on the first of those rather than on the
 * thing under test.
 */
function page(tags: readonly string[]): string {
  return (
    `<html><head><title>r</title></head><body>` +
    `<p>${EVALUATION_POSTURE}</p><p>Version 1</p><p>50a49af8-ec24-46de-870a-cf3ff8401a79</p>` +
    `${tags.join('')}</body></html>`
  );
}

const assemble = (input: ReturnType<typeof document>): string =>
  assembleCapture({
    html: input.html,
    css: ['.shot-img{width:100%;height:auto;object-fit:cover;background:#fff}'],
    fontCss: '',
    images: input.images,
    merchantDomain: 'cheatcodespeptides.com',
    runId: '50a49af8-ec24-46de-870a-cf3ff8401a79',
  });

const references = (html: string): string[] =>
  [...html.matchAll(new RegExp(`class="[^"]*?(${CAPTURE_CLASS}\\d+)`, 'g'))].map((m) => m[1]!);

describe('a document with ninety-five images', () => {
  const built = assemble(document());

  it('shows every one', () => {
    expect(references(built)).toHaveLength(EVIDENCE_IMAGES + 1);
  });

  it('defines each distinct capture exactly once', () => {
    const defined = built.match(
      new RegExp(`\\.${CAPTURE_CLASS}\\d+\\{background-image:url\\("data:image/`, 'g'),
    );

    // Eleven screenshots and the lockup.
    expect(defined).toHaveLength(DISTINCT_CAPTURES + 1);
    expect(new Set(references(built)).size).toBe(DISTINCT_CAPTURES + 1);
  });

  /*
    The other half of the same claim, and the one that says the file is self-contained: not one
    `src` still points at anything the reader's browser would have to fetch, and no marker survives.
  */
  it('leaves no external reference behind', () => {
    const srcs = [...built.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/gi)].map((match) => match[1]!);

    expect(srcs).toHaveLength(EVIDENCE_IMAGES + 1);
    for (const src of srcs) expect(src, src).toBe(PLACEHOLDER_PIXEL);
    expect(built).not.toContain(MARKER_PREFIX);
    expect(built).not.toMatch(/url\("https?:\/\//i);
    expect(built).not.toMatch(/src="\/[^/]/);
  });

  /*
    The element stays an image. `.shot-img` sizes and crops off the intrinsic ratio — `height:auto`,
    three different `max-height`s, `object-fit:cover` — so a capture with no dimensions on it would
    lay out at zero height in the delivered file.
  */
  it('carries each capture’s own dimensions', () => {
    const first = /<img\b[^>]*class="shot-img[^"]*"[^>]*>/i.exec(built)?.[0] ?? '';

    expect(first).toContain('width="1280"');
    expect(first).toMatch(/height="\d{4}"/);
    expect(first).toContain('alt="Full-page screenshot"');
  });

  /*
    And the rules go after the app's stylesheet. `.shot-img` sets `background:#fff` — the shorthand,
    which resets `background-image` to none — so at equal specificity the later rule has to be ours
    or every screenshot is a white box.
  */
  it('puts the capture rules after the sheet that would blank them', () => {
    expect(built.indexOf('background:#fff')).toBeLessThan(built.indexOf(`.${CAPTURE_CLASS}0{`));
    expect(built).toContain('print-color-adjust:exact');
  });
});

describe('one screenshot cited twenty-two times', () => {
  /*
    The worst case on the run, on its own: `CATG-003`'s capture backs twenty-two findings. Before
    this, that was twenty-two copies of the same megabyte.
  */
  const CITATIONS = 22;
  const capture = png(1280, 8400, 7);

  const shared = (): { html: string; images: Map<string, string> } => {
    const images = new Map<string, string>();
    const tags: string[] = [];
    for (let index = 0; index < CITATIONS; index += 1) {
      const marker = `${MARKER_PREFIX}${index}`;
      images.set(marker, capture);
      tags.push(`<img class="shot-img" src="${marker}" alt="Full-page screenshot">`);
    }
    return { html: page(tags), images };
  };

  const built = assemble(shared());

  it('produces one data URI', () => {
    const uris = built.match(/url\("data:image\/png;base64,/g) ?? [];

    expect(uris).toHaveLength(1);
    expect(built.split(capture.slice(capture.indexOf(',') + 1))).toHaveLength(2);
  });

  it('still shows it twenty-two times', () => {
    expect(references(built)).toHaveLength(CITATIONS);
    expect(new Set(references(built)).size).toBe(1);
  });

  /*
    The size, which is the whole point. Twenty-two copies of an 8400px capture is what pushed the
    real document to 182.7 MB; one copy plus twenty-two class references is a rounding error above
    the capture itself.
  */
  it('weighs one capture rather than twenty-two', () => {
    const ifRepeated = capture.length * CITATIONS;

    expect(built.length).toBeLessThan(ifRepeated / 2);
  });
});

describe('the refusal guard is kept', () => {
  const expected = {
    runId: '50a49af8-ec24-46de-870a-cf3ff8401a79',
    images: EVIDENCE_IMAGES + 1,
    published: { version: 1, publishedAt: '2026-09-10T20:46:30.299Z' },
  };

  /*
    A marker whose bytes could not be fetched is left exactly as it is, so the count comes up short
    and the job fails rather than delivering a report with a hole where a screenshot should be. This
    is the guard that caught the defect above; it is not relaxed by fixing it.
  */
  it('refuses a document that is missing one capture', () => {
    const input = document();
    input.images.delete(`${MARKER_PREFIX}7`);
    const built = assemble(input);

    expect(built).toContain(`src="${MARKER_PREFIX}7"`);
    expect(built).not.toContain('src=""');
    expect(references(built)).toHaveLength(EVIDENCE_IMAGES);
    expect(() => assertCapturable(built, expected)).toThrow(/94 capture\(s\).*displayed 95/s);
  });

  /*
    And the half the old count could not ask at all: a reference whose rule is not in the document.
    Ninety-four placeholders over no definitions would have satisfied *"every src is a data URI"*.
  */
  it('refuses a reference with no definition behind it', () => {
    const built = assemble(document()).replace(`.${CAPTURE_CLASS}1{background-image:url("data:image/`, '.unused{x:url("data:image/');

    expect(() => assertCapturable(built, expected)).toThrow(/defines it 0 time\(s\)/);
  });

  it('refuses a document with a marker left in it', () => {
    const built = `${assemble(document())}<!-- ${MARKER_PREFIX}404 -->`;

    expect(() => assertCapturable(built, expected)).toThrow(/still contains a capture marker/);
  });
});

describe('the ceiling', () => {
  /*
    Measured against the real run, before and after.

    | | delivered document |
    |---|---|
    | before — bytes in every `src` | 182.7 MB |
    | after — each capture written once | 20.0 MB |

    Ninety-four evidence images over eleven distinct screenshots, 15.0 MB of PNG. The ceiling is
    unchanged and the captures are at full resolution; the downscaling that briefly shipped between
    these two measurements is gone, because it was buying nothing.
  */
  it('is not raised', () => {
    expect(CAPTURE_SIZE_CEILING_BYTES).toBe(40 * 1024 * 1024);
  });

  it('is cleared by the measured document, and would not have been before', () => {
    expect(20.0 * 1048576).toBeLessThan(CAPTURE_SIZE_CEILING_BYTES);
    expect(182.7 * 1048576).toBeGreaterThan(CAPTURE_SIZE_CEILING_BYTES);
  });
});

describe('reading a capture’s dimensions', () => {
  it('reads the PNG header', () => {
    expect(pngSize(png(1280, 8400, 1))).toEqual({ width: 1280, height: 8400 });
  });

  /*
    Refused rather than guessed. An image whose ratio cannot be read is one this would lay out
    wrongly in a document nobody can correct afterwards.
  */
  it('refuses anything that is not a PNG', () => {
    expect(() => pngSize('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD')).toThrow(
      /not a PNG/,
    );
    expect(() => pngSize('not-a-data-uri')).toThrow(/no payload/);
  });
});
