/**
 * Vendors the report's typefaces into the worker.
 *
 * The captured report inlines its fonts as data URIs, so the capture job needs the woff2 bytes.
 * It reads them **from disk**. It does not fetch them from Google.
 *
 * That is the whole point of this script. Capture is a fail-loud job: if it cannot produce a
 * complete file it fails and the report is not delivered. A fail-loud job that can be failed by
 * someone else's CDN having a bad minute is a job whose guard gets weakened the first time it
 * costs somebody an afternoon — and the guard is the thing protecting the report from shipping
 * half-built. So the dependency is removed rather than made resilient.
 *
 * ## Why a script and not just the files
 *
 * The woff2 files are opaque: a reviewer cannot read one and see what it is. Where the artifact is
 * opaque, the generator is the reviewable thing (D-106). This is that generator, and it is
 * deterministic in the way that matters — it verifies what it downloaded against
 * `manifest.json`, so a re-run that would change a byte fails instead of quietly re-vendoring.
 *
 * ## What it takes, and what it leaves
 *
 * The **latin** and **latin-ext** slices of the five families `apps/web/index.html` requests.
 * 36 faces, about 1.1 MB. Measured against the alternatives:
 *
 *     latin only          18 faces    588 KB      accented characters fall back mid-word
 *     latin + latin-ext   36 faces   1.14 MB      this
 *     every slice         96 faces   1.96 MB      adds cyrillic, greek, vietnamese
 *
 * The report quotes merchant commentary verbatim and prints merchant domains and product names, so
 * latin-only would drop to a system glyph inside a word someone actually wrote. The remaining
 * slices cover scripts these storefronts are unlikely to use, and a missing slice degrades to a
 * fallback glyph rather than failing — so the 820 KB is not bought.
 *
 * ## Usage
 *
 *     node scripts/vendor-fonts.mjs           verify the vendored files against the manifest
 *     node scripts/vendor-fonts.mjs --write   re-download and rewrite both
 *
 * The default is the verifying mode on purpose: the common reason to run this is to check that
 * what is committed is what the manifest says, which is a question a reviewer may want answered
 * without changing anything.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'apps/worker/fonts';
const MANIFEST = join(OUT, 'manifest.json');

/**
 * The request `apps/web/index.html` makes, copied exactly.
 *
 * Copied rather than parsed out of the HTML: the app's link is a live dependency of the *app*, and
 * this vendoring is a dependency of the *capture*. Deriving one from the other would couple them,
 * and the ruling is that the web app keeps its Google Fonts link while the capture stops using it.
 * They are allowed to diverge; a divergence should be visible here as a diff, not silently
 * followed.
 */
const GOOGLE_CSS =
  'https://fonts.googleapis.com/css2' +
  '?family=Space+Grotesk:wght@400;500;600;700' +
  '&family=Inter:wght@400;500;600' +
  '&family=JetBrains+Mono:wght@400;500;700' +
  '&family=IBM+Plex+Sans:wght@400;450;500;600;700' +
  '&family=IBM+Plex+Mono:wght@400;500;600' +
  '&display=swap';

/**
 * A browser User-Agent, because the response depends on it.
 *
 * Google serves woff2 to browsers that support it and older formats to those that do not. A
 * default Node UA gets truetype, which is several times the size and is not what the capture
 * wants.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

/** The two slices taken, identified by the first codepoint range Google emits for each. */
const SLICES = {
  latin: 'U+0000-00FF',
  'latin-ext': 'U+0100-02BA',
};

const write = process.argv.includes('--write');

/** Every `@font-face` in the stylesheet, as fields rather than text. */
function parseFaces(css) {
  const faces = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const field = (name) => block.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim() ?? '';
    const url = block.match(/url\((https:\/\/[^)]+)\)\s*format\('woff2'\)/)?.[1];
    if (url === undefined) continue;

    const range = field('unicode-range');
    const slice = Object.entries(SLICES).find(([, prefix]) => range.startsWith(prefix))?.[0];
    if (slice === undefined) continue;

    faces.push({
      family: field('font-family').replace(/^['"]|['"]$/g, ''),
      weight: field('font-weight'),
      style: field('font-style') || 'normal',
      slice,
      unicodeRange: range,
      sourceUrl: url,
    });
  }
  return faces;
}

/** A stable file name. Nothing in it comes from a URL, so a re-vendor does not rename the world. */
function fileNameFor(face) {
  const family = face.family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${family}-${face.weight}-${face.style}-${face.slice}.woff2`;
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (!write) {
    if (!existsSync(MANIFEST)) {
      throw new Error(`${MANIFEST} does not exist. Run with --write to vendor the fonts.`);
    }

    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const problems = [];

    for (const face of manifest.faces) {
      const path = join(OUT, face.file);
      if (!existsSync(path)) {
        problems.push(`${face.file} is in the manifest and not on disk`);
        continue;
      }
      const actual = sha256(readFileSync(path));
      if (actual !== face.sha256) {
        problems.push(`${face.file} does not match the manifest: ${actual} != ${face.sha256}`);
      }
    }

    // The other direction. A file nobody declared is a file nobody reviewed, and the capture
    // inlines what the manifest names — so an undeclared one is dead weight at best.
    const declared = new Set(manifest.faces.map((face) => face.file));
    for (const name of readdirSync(OUT).filter((n) => n.endsWith('.woff2'))) {
      if (!declared.has(name)) problems.push(`${name} is on disk and in no manifest entry`);
    }

    if (problems.length > 0) {
      console.error(`the vendored fonts do not match the manifest:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }

    const bytes = manifest.faces.reduce((sum, face) => sum + face.bytes, 0);
    console.log(`${manifest.faces.length} faces, ${(bytes / 1024).toFixed(1)} KB — all match`);
    return;
  }

  mkdirSync(OUT, { recursive: true });

  const css = await (await fetch(GOOGLE_CSS, { headers: { 'user-agent': UA } })).text();
  const faces = parseFaces(css);
  if (faces.length === 0) throw new Error('no woff2 faces parsed — the stylesheet format changed');

  // Sorted so the manifest is stable across runs regardless of what order Google emits.
  faces.sort((a, b) =>
    `${a.family}${a.weight}${a.style}${a.slice}`.localeCompare(`${b.family}${b.weight}${b.style}${b.slice}`),
  );

  const written = [];
  for (const face of faces) {
    const bytes = await fetchBytes(face.sourceUrl);
    const file = fileNameFor(face);
    writeFileSync(join(OUT, file), bytes);
    written.push({
      family: face.family,
      weight: face.weight,
      style: face.style,
      slice: face.slice,
      unicodeRange: face.unicodeRange,
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      sourceUrl: face.sourceUrl,
    });
    console.log(`  ${file}  ${(bytes.length / 1024).toFixed(1)} KB`);
  }

  const keep = new Set(written.map((face) => face.file));
  for (const name of readdirSync(OUT).filter((n) => n.endsWith('.woff2'))) {
    if (!keep.has(name)) {
      unlinkSync(join(OUT, name));
      console.log(`  removed ${name}`);
    }
  }

  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        note:
          'Generated by scripts/vendor-fonts.mjs. The capture step inlines these as data URIs and ' +
          'never fetches a font at capture time. Re-vendor with --write; verify with no argument.',
        request: GOOGLE_CSS,
        vendoredAt: new Date().toISOString(),
        faces: written,
      },
      null,
      2,
    )}\n`,
  );

  const total = written.reduce((sum, face) => sum + face.bytes, 0);
  console.log(`\n${written.length} faces, ${(total / 1024).toFixed(1)} KB into ${OUT}`);
}

await main();
