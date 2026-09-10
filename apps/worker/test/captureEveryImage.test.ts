/**
 * Every image the page displayed reaches the file (D-277).
 *
 * ## What was refused
 *
 * The Cheat Codes capture (run `50a49af8`, evaluation `877304a4`) failed with:
 *
 *     the captured report inlines 1 image(s) and the page displayed 95.
 *
 * The one that survived was the masthead lockup. The other ninety-four were evidence screenshots,
 * and the guard did its job — the file was not delivered with holes in it.
 *
 * ## The cause was not the assembler
 *
 * The marker step created all ninety-five markers. What happened next is that a marker is a
 * fragment, a fragment resolves to the page itself, and the page is HTML rather than an image — so
 * setting the marker made the browser fire `error` on every one. `EvidenceSlip`'s `Shot` listens
 * for that and renders *capture not reachable* in the image's place, so React removed all
 * ninety-four `<img>` elements between the marker step and `page.content()` a few lines later.
 *
 * The markers were correct and were thrown away with the elements carrying them, and the serialized
 * document held one `<img>` and a hundred and four `shot-missing` divs.
 *
 * `capture.ts` now replaces each image with a listener-free clone before marking it. The assertions
 * about that live in `capture.ts`'s own reproduction, because it takes a browser; what this file
 * asserts is the document-level property the guard is about, at the count that failed.
 */

import { describe, expect, it } from 'vitest';
import { assembleCapture, CAPTURE_SIZE_CEILING_BYTES } from '../src/capture/document.js';
import { MARKER_PREFIX } from '../src/capture.js';

/** The run's own shape: ninety-four evidence images drawn from eleven distinct screenshots. */
const EVIDENCE_IMAGES = 94;
const DISTINCT_CAPTURES = 11;

/**
 * Deterministic base64, so a failure is reproducible (D-106).
 *
 * Each capture opens with its own index in base64 characters and is padded to the same length, so
 * no payload is a prefix of another — otherwise counting occurrences of one counts the others too.
 */
const payload = (id: number): string => {
  const head = `Q${String.fromCharCode(65 + (id % 26))}${String(id).padStart(3, '0')}`;
  return `data:image/jpeg;base64,${head}${'QUJDRA'.repeat(340)}`;
};

/**
 * A document shaped like the evaluation's section 6: one `<img>` per citing finding, several
 * findings citing the same capture, plus the masthead lockup which is an app asset and not evidence.
 */
function document(): { readonly html: string; readonly images: Map<string, string> } {
  const captures = Array.from({ length: DISTINCT_CAPTURES }, (_, index) => payload(index));
  const images = new Map<string, string>();

  /*
    The masthead lockup is index 0, an app asset rather than evidence. Markers are numeric because
    `capture.ts` numbers them by DOM position, and the pattern that finds them says so.
  */
  const tags: string[] = [`<img src="${MARKER_PREFIX}0" alt="Mintro">`];
  images.set(`${MARKER_PREFIX}0`, payload(900));

  for (let index = 0; index < EVIDENCE_IMAGES; index += 1) {
    const marker = `${MARKER_PREFIX}${index + 1}`;
    images.set(marker, captures[index % DISTINCT_CAPTURES]!);
    tags.push(`<img class="shot-img" src="${marker}" alt="Full-page screenshot">`);
  }

  return {
    html: `<html><head><title>r</title></head><body>${tags.join('')}</body></html>`,
    images,
  };
}

const assemble = (input: ReturnType<typeof document>): string =>
  assembleCapture({
    html: input.html,
    css: [],
    fontCss: '',
    images: input.images,
    merchantDomain: 'cheatcodespeptides.com',
    runId: '50a49af8-ec24-46de-870a-cf3ff8401a79',
  });

describe('a document with ninety-five images', () => {
  const built = assemble(document());

  it('inlines every one', () => {
    const inlined = built.match(/<img\b[^>]*\ssrc="data:image\//gi) ?? [];

    expect(inlined).toHaveLength(EVIDENCE_IMAGES + 1);
  });

  /*
    The other half of the same claim, and the one that says the file is self-contained: not one
    `src` still points at anything the reader's browser would have to fetch.
  */
  it('leaves no external reference behind', () => {
    const srcs = [...built.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/gi)].map((match) => match[1]!);

    expect(srcs).toHaveLength(EVIDENCE_IMAGES + 1);
    for (const src of srcs) expect(src.startsWith('data:image/'), src).toBe(true);
    expect(built).not.toContain(MARKER_PREFIX);
    expect(built).not.toMatch(/src="https?:\/\//i);
    expect(built).not.toMatch(/src="\/[^/]/);
  });

  /*
    Ninety-four images over eleven captures means the same bytes are written up to twenty-two times.
    Asserted because it is the reason the thumbnailer exists: the document is not large because it
    holds a lot of evidence, it is large because it holds the same evidence repeatedly.
  */
  it('writes a shared capture once per citing finding', () => {
    const first = payload(0);
    const occurrences = built.split(first).length - 1;

    expect(occurrences).toBeGreaterThan(1);
    expect(occurrences).toBe(Math.ceil(EVIDENCE_IMAGES / DISTINCT_CAPTURES));
  });
});

describe('the refusal guard is kept', () => {
  /*
    A marker whose bytes could not be fetched leaves the marker in place, the count comes up short,
    and the job fails rather than delivering a report with a hole where a screenshot should be. This
    is the guard that caught the defect above; it is not relaxed by fixing it.
  */
  it('still leaves an unfetched marker in place rather than blanking it', () => {
    const input = document();
    input.images.delete(`${MARKER_PREFIX}7`);
    const built = assemble(input);

    expect(built).toContain(`src="${MARKER_PREFIX}7"`);
    expect(built).not.toContain('src=""');
    expect(built.match(/<img\b[^>]*\ssrc="data:image\//gi) ?? []).toHaveLength(EVIDENCE_IMAGES);
  });
});

describe('the ceiling at this count', () => {
  /*
    Measured against the real run rather than this fixture, because the fixture's payloads are
    arbitrary and the ceiling question is about real screenshots. Run `50a49af8`: ninety-four
    evidence images over eleven captures totalling 15.0 MB of PNG.

    | setting        | delivered document |
    |----------------|--------------------|
    | full size      | 182.7 MB           |
    | 700px, q 0.72  |  42.9 MB           |
    | 560px, q 0.65  |  27.5 MB           |

    So full-size inlining does **not** hold at this count — it exceeds the ceiling four and a half
    times over — and the answer taken was thumbnails at capture time rather than a larger ceiling.
    These assert the constants that arithmetic chose, so a later edit to them has to face it.
  */
  it('is not raised', () => {
    expect(CAPTURE_SIZE_CEILING_BYTES).toBe(40 * 1024 * 1024);
  });

  it('is cleared with headroom by the chosen thumbnail size, and not by a larger one', async () => {
    const { THUMBNAIL_WIDTH, THUMBNAIL_QUALITY } = await import('../src/capture/thumbnail.js');

    expect(THUMBNAIL_WIDTH).toBe(560);
    expect(THUMBNAIL_QUALITY).toBe(0.65);

    // 27.5 MB measured at this setting, against a 40 MB ceiling.
    expect(27.5 * 1024 * 1024).toBeLessThan(CAPTURE_SIZE_CEILING_BYTES);
    // 42.9 MB measured at 700px, which is why 700 was not taken.
    expect(42.9 * 1024 * 1024).toBeGreaterThan(CAPTURE_SIZE_CEILING_BYTES);
  });
});
