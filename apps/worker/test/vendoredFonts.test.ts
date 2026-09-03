/**
 * The vendored typefaces are the ones the manifest declares.
 *
 * The capture step inlines these into every delivered report and **never fetches a font**. That is
 * a deliberate removal of a dependency: capture is fail-loud, and a fail-loud job that a CDN can
 * fail is a job whose guard gets weakened the first time it costs somebody an afternoon.
 *
 * Having removed the dependency, the files become something nobody looks at again. A woff2 is
 * opaque — a reviewer cannot open one and see what it is — so the manifest and
 * `scripts/vendor-fonts.mjs` are the reviewable artifacts (D-106), and this asserts they still
 * describe what is on disk. Both directions: a declared face that is missing, and a file on disk
 * that no entry declares.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/worker/fonts';

interface Face {
  readonly family: string;
  readonly weight: string;
  readonly style: string;
  readonly slice: string;
  readonly unicodeRange: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceUrl: string;
}

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  readonly faces: readonly Face[];
};

describe('the vendored fonts', () => {
  it('declares the faces the report needs', () => {
    // The five families `apps/web/index.html` asks Google for, in the two slices taken.
    const families = new Set(manifest.faces.map((face) => face.family));

    expect([...families].sort()).toEqual([
      'IBM Plex Mono',
      'IBM Plex Sans',
      'Inter',
      'JetBrains Mono',
      'Space Grotesk',
    ]);
    expect(new Set(manifest.faces.map((face) => face.slice))).toEqual(
      new Set(['latin', 'latin-ext']),
    );
  });

  it('matches on disk, byte for byte', () => {
    const problems: string[] = [];

    for (const face of manifest.faces) {
      const path = join(DIR, face.file);
      if (!existsSync(path)) {
        problems.push(`${face.file} is declared and not on disk`);
        continue;
      }
      const bytes = readFileSync(path);
      const digest = createHash('sha256').update(bytes).digest('hex');

      if (digest !== face.sha256) problems.push(`${face.file}: sha256 ${digest} != ${face.sha256}`);
      if (bytes.length !== face.bytes) {
        problems.push(`${face.file}: ${bytes.length} bytes != ${face.bytes}`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('has nothing on disk that the manifest does not declare', () => {
    // A file nobody declared is a file nobody reviewed. It would also never be inlined, because
    // the capture reads the manifest — so it is dead weight in the image at best.
    const declared = new Set(manifest.faces.map((face) => face.file));
    const found = readdirSync(DIR).filter((name) => name.endsWith('.woff2'));

    expect(found.filter((name) => !declared.has(name))).toEqual([]);
    expect(found).toHaveLength(manifest.faces.length);
  });

  it('is small enough to inline into every report', () => {
    /*
      1.14 MB against reports measured at 8–15 MB, under a 40 MB ceiling. Asserted rather than
      assumed, because the next person to add a family or a slice will not be thinking about the
      ceiling, and the failure mode is a report that is rejected at capture rather than one that
      looks slightly heavier.
    */
    const bytes = manifest.faces.reduce((sum, face) => sum + face.bytes, 0);

    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('records where every face came from', () => {
    // The provenance is the only thing making these auditable after the fact.
    for (const face of manifest.faces) {
      expect(face.sourceUrl, face.file).toMatch(/^https:\/\/fonts\.gstatic\.com\//);
      expect(face.unicodeRange, face.file).toMatch(/^U\+/);
    }
  });
});
