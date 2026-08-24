/**
 * One live vision call, against the real Anthropic API.
 *
 *     node --env-file=.env.test scripts/live/vision-live.mjs
 *
 * The vision route has been exercised end to end since M0, but only ever against `fakeVision`,
 * which returns `{ text: JSON.stringify(payload) }` — exactly what the `VisionClient` port
 * declares and nothing more. That makes the port faithful and the *transport* untested: nothing in
 * the suite has ever seen a real Messages API response.
 *
 * ## The page
 *
 * A genuinely scanned page, built rather than downloaded, so the fixture is reviewable and
 * deterministic (D-106): an EIN letter is drawn as a text PDF, rasterised to a JPEG through the
 * real rasterizer, and that JPEG is embedded in a fresh PDF with no text layer at all. The result
 * is what a scan actually is — pixels of a document, zero glyphs — rather than `imageOnlyPdf()`'s
 * placeholder, which routes to vision correctly but shows the model nothing worth reading.
 *
 * ## Cost
 *
 * `VisionResponse` is `{ text }`, so token usage is invisible to the package by design. To report
 * it without widening that port, the real client is constructed with a `fetchImpl` that tees the
 * response body. The extraction path sees the ordinary client; this script also gets the raw JSON.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extract, createAnthropicVisionClient } from '@mintro/extraction';
import { openRasterizer } from '../../apps/worker/dist/src/rasterize.js';
import { banner } from './guard.mjs';

banner('Live vision call — one scanned page, real Anthropic API');

const OUT = 'scripts/live/out';
mkdirSync(OUT, { recursive: true });

// Sonnet 4.5 list price, USD per million tokens. Stated here so the arithmetic below is auditable
// rather than a number that appeared from nowhere; if the rate changes this is the line to edit.
const USD_PER_MTOK_IN = 3.0;
const USD_PER_MTOK_OUT = 15.0;

/** An EIN letter, as a text PDF. Deterministic: no dates, no randomness, no ids. */
async function einLetterTextPdf() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  const page = doc.addPage([612, 792]);

  const line = (text, y, f = font, size = 10) =>
    page.drawText(text, { x: 60, y, size, font: f, color: rgb(0.08, 0.08, 0.08) });

  line('INTERNAL REVENUE SERVICE', 730, bold, 12);
  line('DEPARTMENT OF THE TREASURY', 714);
  line('CINCINNATI OH 45999-0023', 698);

  line('Date of this notice:  03-14-2026', 656);
  line('Employer Identification Number:', 640);
  line('47-2841903', 624, bold, 12);
  line('Form: SS-4', 608);
  line('Notice CP 575 G', 592);

  line('NORTHWIND PEPTIDES LLC', 548, bold);
  line('1420 HARBOR VIEW RD STE 200', 532);
  line('WILMINGTON DE 19801', 516);

  line('WE ASSIGNED YOU AN EMPLOYER IDENTIFICATION NUMBER', 470, bold);
  const body = [
    'Thank you for applying for an Employer Identification Number (EIN).',
    'We assigned you EIN 47-2841903. This EIN will identify you, your business',
    'accounts, tax returns, and documents, even if you have no employees.',
    'Please keep this notice in your permanent records.',
    '',
    'When filing tax documents, payments, and related correspondence, it is',
    'very important that you use your EIN and complete name and address',
    'exactly as shown above.',
  ];
  body.forEach((t, i) => line(t, 448 - i * 15));

  return new Uint8Array(await doc.save());
}

/** Wrap a JPEG as a one-page PDF with no text layer — a scan, structurally. */
async function scanFromJpeg(jpeg) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const img = await doc.embedJpg(jpeg);
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  return new Uint8Array(await doc.save());
}

const rasterizer = await openRasterizer();
let raw = null;
let requestBytes = 0;

try {
  console.log('1. building the page');
  const textPdf = await einLetterTextPdf();
  const rendered = await rasterizer.pageImage(textPdf, 1);
  console.log(`   rasterised: ${rendered.width}x${rendered.height}, ${(rendered.bytes.length / 1024).toFixed(1)} KB jpeg`);

  const scan = await scanFromJpeg(rendered.bytes);
  writeFileSync(`${OUT}/scanned-ein-letter.pdf`, scan);
  console.log(`   scan pdf  : ${(scan.length / 1024).toFixed(1)} KB, no text layer`);

  // Tee the transport. The extraction path is unchanged; this only observes.
  const teeingFetch = async (url, init) => {
    requestBytes = init?.body ? Buffer.byteLength(init.body) : 0;
    const res = await fetch(url, init);
    const text = await res.text();
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { unparseable: text.slice(0, 500) };
    }
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  const vision = createAnthropicVisionClient({ fetchImpl: teeingFetch });

  console.log('2. extracting (this makes the vendor call)');
  const started = Date.now();
  const result = await extract(scan, 'scanned-ein-letter.pdf', {
    pageImage: rasterizer.pageImage,
    vision,
  });
  const elapsed = Date.now() - started;

  console.log(`\n3. result — ${elapsed} ms`);
  console.log(`   outcome     : ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`);
  console.log(`   detected    : ${result.detected_type}`);
  console.log(`   pages       : ${result.pages.map((p) => `p${p.page} route=${p.route} glyphs=${p.glyphs}`).join(', ')}`);
  console.log(`   values      : ${result.values.length}`);
  for (const v of result.values) {
    console.log(
      `     ${v.field.padEnd(24)} ${String(v.value).padEnd(34)} tier=${v.tier} ` +
        `prov={version:${v.provenance.document_version.slice(0, 8)}…, page:${v.provenance.page}}` +
        `${'location' in v.provenance ? ' HAS LOCATION' : ''}`,
    );
  }

  const tiers = new Set(result.values.map((v) => v.tier));
  console.log(`\n   every value page-tier? ${tiers.size === 1 && tiers.has('page') ? 'YES' : `NO — ${[...tiers].join(', ')}`}`);
  const anyLocation = result.values.some((v) => 'location' in v.provenance);
  console.log(`   any value claims a location? ${anyLocation ? 'YES — D-100 violated' : 'NO (correct: page tier stops at the page)'}`);

  writeFileSync(`${OUT}/vision-result.json`, JSON.stringify(result, null, 2));

  console.log('\n4. the real API response, against what the fake returns');
  if (raw) {
    console.log(`   top-level keys : ${Object.keys(raw).join(', ')}`);
    console.log(`   fake returns   : text`);
    console.log(`   model          : ${raw.model}`);
    console.log(`   stop_reason    : ${raw.stop_reason}`);
    console.log(`   content blocks : ${(raw.content ?? []).map((b) => b.type).join(', ')}`);
    const u = raw.usage ?? {};
    console.log(`   usage          : ${JSON.stringify(u)}`);
    const cost = ((u.input_tokens ?? 0) / 1e6) * USD_PER_MTOK_IN + ((u.output_tokens ?? 0) / 1e6) * USD_PER_MTOK_OUT;
    console.log(`\n   request body   : ${(requestBytes / 1024).toFixed(1)} KB (base64 image inflates the jpeg by ~4/3)`);
    console.log(`   input tokens   : ${u.input_tokens}`);
    console.log(`   output tokens  : ${u.output_tokens}`);
    console.log(`   cost           : $${cost.toFixed(5)} at $${USD_PER_MTOK_IN}/$${USD_PER_MTOK_OUT} per MTok`);
    writeFileSync(`${OUT}/vision-raw-response.json`, JSON.stringify(raw, null, 2));
  } else {
    console.log('   no raw response captured');
  }
} finally {
  await rasterizer.close();
}
