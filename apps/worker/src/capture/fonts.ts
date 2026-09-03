/**
 * The report's typefaces, read from disk and inlined.
 *
 * **Nothing here reaches the network.** The faces are vendored into `apps/worker/fonts` by
 * `scripts/vendor-fonts.mjs` and committed; this reads them and builds `@font-face` rules whose
 * `src` is a data URI.
 *
 * That is deliberate and it is the whole reason the files are in the repository. Capture is
 * fail-loud: if it cannot produce a complete document the job fails and no report is delivered. A
 * fail-loud job that a font CDN can fail is a job whose guard gets weakened the first time it
 * costs somebody an afternoon — and the guard is what stops a half-built report going to an
 * underwriter. So the dependency is removed rather than retried, cached, or made optional.
 *
 * The web app keeps its Google Fonts link. That is a separate question about the live app and it
 * is not answered here; the two are allowed to differ, and the difference is visible in
 * `scripts/vendor-fonts.mjs`, which restates the request rather than deriving it.
 *
 * ## The fallback still matters
 *
 * 36 faces, latin and latin-ext. A character outside those slices falls back to the stack already
 * declared in the app's CSS (`Inter, system-ui, sans-serif` and friends) rather than failing, so a
 * missing slice costs a glyph rather than a document. That is what makes it reasonable to stop at
 * 1.1 MB instead of taking all 96 faces.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One vendored face, as `manifest.json` declares it. */
export interface VendoredFace {
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

export interface FontManifest {
  readonly faces: readonly VendoredFace[];
}

/**
 * Where the faces live.
 *
 * Resolved from the working directory rather than from `import.meta.url`, matching how the worker
 * already locates `apps/web/dist` — one convention for "a path into the repository", not two.
 */
export const FONT_DIR = 'apps/worker/fonts';

export function readFontManifest(dir: string = FONT_DIR): FontManifest {
  const path = join(dir, 'manifest.json');
  let raw: string;

  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // Loud, and it names the fix. A worker that could not find its fonts used to be a report that
    // silently lost its typeface, which is the failure this whole arrangement exists to prevent.
    throw new Error(
      `could not read the font manifest at ${path}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `node scripts/vendor-fonts.mjs --write` to vendor the faces.',
    );
  }

  const manifest = JSON.parse(raw) as FontManifest;
  if (!Array.isArray(manifest.faces) || manifest.faces.length === 0) {
    throw new Error(`${path} declares no faces`);
  }
  return manifest;
}

/**
 * `@font-face` rules for every vendored face, with the woff2 bytes inline.
 *
 * Each file is verified against the digest the manifest recorded. A face that does not match is
 * not inlined with a warning — it throws. The manifest is the only thing making these opaque files
 * reviewable, and a document built from bytes the manifest does not describe is a document nobody
 * reviewed.
 */
export function fontFaceCss(dir: string = FONT_DIR, manifest?: FontManifest): string {
  const declared = manifest ?? readFontManifest(dir);
  const rules: string[] = [];

  for (const face of declared.faces) {
    const path = join(dir, face.file);
    let bytes: Buffer;

    try {
      bytes = readFileSync(path);
    } catch (error) {
      throw new Error(
        `the font manifest declares ${face.file} and it could not be read: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (bytes.length !== face.bytes) {
      throw new Error(
        `${face.file} is ${bytes.length} bytes and the manifest says ${face.bytes} — ` +
          'the vendored fonts and the manifest disagree, and neither is authoritative on its own',
      );
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== face.sha256) {
      throw new Error(
        `${face.file} hashes to ${digest} and the manifest says ${face.sha256}. The manifest is ` +
          'what makes an opaque file reviewable; bytes it does not describe are bytes nobody read.',
      );
    }

    rules.push(
      `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};` +
        `font-display:swap;` +
        `src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');` +
        `unicode-range:${face.unicodeRange}}`,
    );
  }

  return rules.join('\n');
}
