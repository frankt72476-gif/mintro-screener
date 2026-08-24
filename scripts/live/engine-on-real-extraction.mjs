/**
 * Family A over a real, vision-read document.
 *
 *     node --env-file=.env.test scripts/live/vision-live.mjs      # produces the extraction
 *     node --env-file=.env.test scripts/live/engine-on-real-extraction.mjs
 *
 * Every engine test so far has run on hand-built `ExtractionResult` literals or on fake vision
 * payloads. This runs the checks over what the model actually returned for a scanned EIN letter,
 * which is the one input shape no fixture reproduces: page-tier values, no snippets, and only the
 * closed vocabulary — because the prompt tells the model to report nothing else.
 *
 * It is not the full M3 live verification. There is no persistence layer yet, so this reads a
 * saved extraction rather than a package assembled in the database.
 */

import { readFileSync } from 'node:fs';
import { loadDocumentsRules } from '@mintro/ruleset';
import { documents } from '@mintro/engine';
import { banner } from './guard.mjs';

banner('Family A over a real vision extraction');

const extraction = JSON.parse(readFileSync('scripts/live/out/vision-result.json', 'utf8'));
const rules = loadDocumentsRules();

const document = {
  documentId: 'doc-live',
  versionId: 'ver-live',
  version: 1,
  slotId: 'slot-ein',
  slotKey: 'ein_letter',
  supersedes: null,
  supersededBy: null,
  detectedType: extraction.detected_type,
  originalFilename: 'scanned-ein-letter.pdf',
  outcome: extraction.outcome,
  outcomeReason: extraction.reason,
  extraction,
};

const snapshot = {
  packageId: 'pkg-live',
  runAt: new Date('2026-08-24T00:00:00Z'),
  facts: { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true },
  slots: [
    {
      id: 'slot-ein',
      slotKey: 'ein_letter',
      instanceLabel: null,
      requiredCount: 1,
      monthly: false,
      graceDays: 10,
      expiryAfterRun: false,
      examined: true,
      origin: 'required',
      state: 'satisfied',
      reason: null,
    },
  ],
  documents: [document],
};

console.log(`values read from the page (${extraction.values.length}):`);
for (const v of extraction.values) {
  console.log(`  ${v.field.padEnd(20)} tier=${v.tier}  snippet=${'snippet' in v.provenance ? 'yes' : 'NO'}`);
}

const { findings } = documents.runDocumentChecks(snapshot, rules, { runId: 'live-1', families: ['A'] });

console.log('\nfamily A:');
for (const f of findings) {
  const reason = f.notEvaluableReason ? ` [${f.notEvaluableReason}]` : '';
  console.log(`  ${f.checkId}  ${String(f.state).padEnd(14)}${reason}  tier=${f.tier}`);
  console.log(`         ${f.note}`);
}

// The point of the exercise, stated as a check rather than left for a reader to notice.
const a04 = findings.find((f) => f.checkId === 'A-04');
const markerText = 'internal revenue service';
const onThePage = true; // the rasterised page plainly shows it; that is what was sent to the model
const inTheValues = extraction.values.some((v) => String(v.value ?? '').toLowerCase().includes(markerText));
console.log(`\n"Internal Revenue Service" is printed on the page : ${onThePage}`);
console.log(`  ...and present in an extracted value            : ${inTheValues}`);
console.log(`  A-04 therefore returned                         : ${a04?.state}`);
