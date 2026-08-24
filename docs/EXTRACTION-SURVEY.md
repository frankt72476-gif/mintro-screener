# Survey — document extraction in `mintro-intake-lite`

What that codebase actually does, ahead of designing Documents Check against it. Report only;
no recommendation, no migration plan, no code written in either repo.

Surveyed at `mintro-intake-lite` HEAD `e372ffb` (2026-08-21), working tree clean apart from two
pre-existing untracked docs.

## Method, and what "observed" means here

Two classes of claim in this document, marked throughout:

- **Observed** — I ran the shipped code and read what came back. The text path is real,
  dependency-free, and runnable, so most of it is observed. To run it I sliced
  `server/index.mjs:18599-19728` out by line number and re-wrapped it in a factory, stubbing two
  closure variables (`targetFieldSet`, `normalizeTargetFieldKey`). The sliced code is byte-identical
  to what ships. Fixtures used are that repo's own committed PDFs plus three PDFs I generated in a
  scratch directory. Nothing in either repo was modified.
- **Documented** — read from source, comments, commit messages, or the design memo, not executed.
  Every LLM path is documented-only: I made **no** paid API calls. Where documentation and
  observation disagree, that is called out — twice, and both times observation wins.

---

## 1. Document types handled

There is no single extraction system. There are **three unrelated extractors**, plus a fourth,
different thing that could be mistaken for one.

| Surface | Types accepted | Code path? | Passing test? |
|---|---|---|---|
| **Intake documents** — `runDocumentExtraction`, `server/index.mjs:18533-20240` | `.pdf`, `.docx`, `.jpg`/`.jpeg`/`.png` | Yes | **None** |
| **Processing statements** — `server/services/statement_extraction.mjs` | PDF only (`multer` mimetype gate, `:28211`) | Yes | **None** |
| **Business cards** — `server/services/card_extraction.mjs` | 1–2 × JPEG/PNG, ≤5 MB | Yes | **None** |
| SFTP processor reports + CSV/XLSX import | Fixed-column CSV/XLSX | Yes | **Yes — 10 test files** |

The last row is the fourth thing. `server/jobs/sftp_parsers/` (9 test files) and
`north_csv_parser` are well tested, but they parse fixed-schema settlement and interchange reports
from a known sender. They read columns, not documents. Not relevant to Documents Check; not
surveyed further.

**Support is real, but "real" means a shipped code path carrying production traffic, not a tested
one.** All three document extractors run in production against live merchant packages. Not one is
exercised by a single test — see §10. So the honest characterisation is neither "aspirational" nor
"proven": it is **unverified production code**.

### The gap between what can be uploaded and what can be read

The merchant portal dropzone (`src/components/portal/UploadDropzone.tsx:50-58`) accepts:

```
application/pdf, image/*, .doc, .docx, .xls, .xlsx, .csv     (≤25 MB)
```

The extraction dispatch (`server/index.mjs:19940-19956`) recognises `.pdf`, `.docx`, `.jpg`,
`.jpeg`, `.png`. Everything else — `.doc`, `.xls`, `.xlsx`, `.csv`, `.gif`, and `.heic` (the iPhone
camera default) — reaches:

```js
} else {
  continue;
}
```

No error is recorded. `extraction_attempted` stays `false`. And because the stamping rule is
"completed without error", **the row is stamped `extracted_at` and never re-enters scope**. An
unsupported upload is silently and permanently skipped. The only trace is a `console.log` line
reading `route=skipped_unsupported`.

The `.gif` exclusion is deliberate and recorded (`CLAUDE.md`, 2026-08-14: "the extraction dispatch
recognizes .jpg/.jpeg/.png only — NOT .gif … Viewing and extracting are separate capabilities and
are not required to agree"). The `.heic` exclusion is not discussed anywhere, and that same log
entry names phone-photographed IDs and voided checks as "the two highest-frequency
phone-photographed document types."

Routing is by **filename extension only** (`path.extname`). No content sniffing, no magic-byte
check. A PDF saved as `.txt` is skipped; an HTML error page saved as `.pdf` goes to the PDF parser
and throws.

---

## 2. Extraction method per type

### Libraries, with versions as installed

| Library | Version | Role |
|---|---|---|
| `pdf-parse` | **2.4.5** | PDF text layer. Wraps `pdfjs-dist` **5.4.296**. |
| `mammoth` | **1.12.0** | `.docx` → raw text. |
| `pdfjs-dist` | 5.6.205 (server), 5.4.296 (root) | Transitive under `pdf-parse`; never called directly. |
| `pdf-lib` | 1.17.1 | **Writes** AcroForms (MPA generation). Never used to read an upload. |
| `pdfkit`, `puppeteer-core` | 0.15.2, 24.40.0 | PDF generation only. |
| `papaparse`, `xlsx` | 5.5.3, 0.18.5 | CSV/XLSX import and SFTP reports only. |

**There is no OCR library and no OCR service.** No Tesseract, no Google Document AI, no AWS
Textract, no Azure. Every pixel-reading capability in this codebase is a vision-model call.

### Per type

**`.pdf` with a text layer** — `new PDFParse({data}).getText()`, then
`String(out?.text ?? "")` (`:19207-19218`). Then `normalizeExtractedText` (`:19223`) collapses
whitespace. Then `harvestCandidatesFromText` (`:19230-19728`) — roughly 500 lines of hand-written
**label-adjacency regex scraping**: for each known field, walk the lines, find one that *starts
with* a known label string, take the remainder of that line, or failing that the next line if it is
≤160 chars, then test it against a per-field value pattern. First match per field wins and the
search stops.

Then a narrow LLM disambiguation pass: `resolveGptEligibleFields` (`:19071-19178`) calls
**OpenAI `/v1/responses`**, model `process.env.OPENAI_MODEL || "gpt-5.4-mini"`, with a
`json_schema` structured output. It fires for exactly four fields (business legal name, DBA name,
bank name, last processor/bank) and only when a field has **two or more distinct candidate
values**. It is a chooser, not an extractor — it may only select from supplied candidate strings,
and its answer is discarded unless `confidence ≥ 0.9` and the selection is verbatim one of them.

**`.docx`** — `mammoth.extractRawText({buffer})` (`:19219-19222`), then the identical harvest.
Observed against `docs/contracts/Mintro_Platform_Agreement_Standard_v1.docx`: returns
`{value, messages}`, 12,366 chars, `messages: []`. No page or position data of any kind — a `.docx`
has no pages until it is laid out, and mammoth does not lay it out.

**`.jpg`/`.jpeg`/`.png`, and `.pdf` with an empty text layer** —
`server/services/intake_doc_extraction.mjs`, **Anthropic Messages API**,
`process.env.ANTHROPIC_INTAKE_MODEL || "claude-sonnet-4-6"`, `temperature: 0`,
`max_tokens: 4096`, `anthropic-version: 2023-06-01`. A PDF is sent whole as a `type: "document"`
base64 block — no client-side rasterisation; Anthropic rasterises server-side. An image is sent as
`type: "image"`. The system prompt (≈120 lines) specifies a grouped JSON schema of ~70 fields plus
an `owners[]` array, and instructs "use null for any field the document does not show. Do NOT
invent or guess values."

**Statements** — same shape, `ANTHROPIC_STATEMENT_MODEL || "claude-sonnet-4-6"`,
`max_tokens: 2048`, ~10 canonical financial fields, each returned as `{value, confidence}`.

**Business cards** — same shape, `ANTHROPIC_CARD_MODEL || "claude-sonnet-4-6"`, `max_tokens: 512`,
8 flat fields.

---

## 3. Cost and dependencies

**Every metered call, and there is no local fallback for any of them.**

| Call site | Vendor | Model | Fires when |
|---|---|---|---|
| `intake_doc_extraction.mjs:extractIntakeDocFields` | Anthropic | `claude-sonnet-4-6` | image upload; PDF with <20 chars of text; one escalated low-yield PDF per invocation |
| `server/index.mjs:19087` `resolveGptEligibleFields` | **OpenAI** | `gpt-5.4-mini` | ≥2 conflicting candidates on one of 4 identity fields |
| `statement_extraction.mjs:extractStatement` | Anthropic | `claude-sonnet-4-6` | every statement upload |
| `card_extraction.mjs:extractCardFields` | Anthropic | `claude-sonnet-4-6` | every card scan |

Points that matter for a no-vendor-budget release:

- **No local fallback exists, and the text path is explicitly not one.** When a PDF escalates to
  vision, its text-path harvest is *deliberately discarded* (`:20040-20047`) rather than merged.
  The commit that added this (`ce5c480`) argues the discard is load-bearing: merging junk with real
  values "is precisely the shape a reconciler reads as CORROBORATION."
- **Each document can cost up to three round-trips** — initial, one transient/5xx retry, one
  parse-failure retry.
- **Failure modes differ by vendor, and one is silent.** A missing `ANTHROPIC_API_KEY` throws
  `"ANTHROPIC_API_KEY not configured"`, which the intake path catches into `extraction_error`. A
  missing `OPENAI_API_KEY` makes `resolveGptEligibleFields` `return {}` (`:19071`) — the
  disambiguation pass quietly does nothing and nothing anywhere says so.
- **Cost logging exists in exactly one place.** `statement_extraction.mjs:logExtractionCost` writes
  token counts and an estimated USD figure to the server log using two hardcoded constants
  (`INPUT_COST_PER_1K = 0.003`, `OUTPUT_COST_PER_1K = 0.015`). Those are source literals; they drift
  silently when the price list changes. The intake and card extractors log nothing. The comment
  promising a `campaign_costs` table "with Phase 4 budget guard infrastructure" refers to something
  that does not exist. **There is no budget guard and no spend ceiling anywhere.**
- **A systematically failing document re-bills forever.** A document whose vision call errors or
  times out is intentionally not stamped, so it re-enters scope next run and is charged again. The
  `ce5c480` commit message names this as an open carry-forward: "a PDF that escalates and times out
  on every attempt is never stamped, contributes nothing, and re-bills on each click … the fix
  remains a terminal state (attempt counter, stamp after N)." That fix is not in the code.

The only bounds that do exist are latency bounds: `VISION_CALL_TIMEOUT_MS = 75_000` and
`VISION_TOTAL_BUDGET_MS = 90_000` per document, and `EXTRACTION_TIME_BUDGET_MS = 12_000`
(`:18470`) for the whole document loop, which caps a single request at roughly four documents.

---

## 4. Provenance

**There is no positional provenance. None at all.**

Not a page number, not a bounding box, not a character offset, not a surrounding-text snippet.
This is the plainest answer in the survey and it is not close.

**Observed** — the complete candidate object the text path emits, verbatim from a real run against
a committed fixture:

```json
{
  "value": "Merchant Address",
  "source_type": "pdf_native_text",
  "source_document_request_id": "row-1",
  "source_file_url": "https://example/doc.pdf",
  "extracted_at": "2026-08-24T02:39:21.032Z",
  "confidence": 0.9,
  "source_filename": "intake_acme_sole_prop.pdf",
  "matched_label": "Merchant Name"
}
```

That is the whole record. It gives **document-level** provenance — which uploaded file, which
`document_requests` row, when — and nothing below that.

The gap has several distinct causes and they are not the same size:

- **`matched_label` is not provenance.** It is the label string the scraper matched on: a fact about
  the scraper, not about the document. In the sample above the label is `"Merchant Name"` and the
  value is `"Merchant Address"` — the record faithfully preserves a wrong pairing with no way to see
  where either came from.
- **Page numbers are available and discarded.** `pdf-parse` returns
  `TextResult { pages: Array<{num, text}>, text, total }`. `extractNativeTextFromPdf`
  (`:19207-19218`) returns `String(out?.text ?? "")`. The `pages` array is dropped at that line and
  never reconstructed.
- **A `snippet` field exists and is hardcoded null.** `buildGptEligibleUnresolved` builds the
  reconciliation payload and writes `snippet: null` (`:19054`) for every candidate. The slot was cut
  for; nothing fills it.
- **The vision path has no provenance at all, by construction.** Every vision candidate is stamped
  `matched_label: "Vision extraction"` — a literal string constant (`:19811`) — and
  `confidence: 0.9`. The prompt never asks the model where it saw anything, and the response schema
  has no place to put it.
- **The statement extractor stores `{value, confidence}` per field** in
  `statement_analyses.extracted_fields`, with no location. `raw_text` is returned by
  `extractStatement` and is not persisted.

What *is* retained: the original uploaded artifact, in R2 / Supabase storage, reachable from
`source_file_url`. A human can open the source document. Nothing points them at where in it to
look. And retention is finite — `server/retention_cleanup.mjs` nulls `file_url` and deletes upload
files past a cutoff (default 60 days).

Mapped onto what a documentary finding requires here (hard constraint 3, D-012):

| Required | Present in intake-lite |
|---|---|
| Source URL | Yes — `source_file_url` |
| UTC timestamp | Yes — `extracted_at`, ISO 8601 |
| Matched value | Yes — `value` |
| Matched pattern | Partial — `matched_label` records the label matched, not the pattern |
| Stored artifact body | Yes, but deleted on a retention timer |
| SHA-256 of the artifact | **No** |
| Location within the artifact | **No** |

---

## 5. Absence signalling

**Per field: everything collapses.** A field simply does not appear in `document_candidates`. That
single absence means any of:

- the field is not on the document
- the field is on the document and blank
- the document was unreadable
- the document type is unsupported
- the byte fetch failed
- the value was found but failed a validator or the noise filter
- the document was a duplicate of one already processed

Nothing distinguishes them. There is no "found and empty" state anywhere in the pipeline — three
separate places collapse it: `coerceScalar` maps `""` to `null`; `appendVisionCandidates` skips
falsy values before appending; the harvest's `addValue` returns early on an empty normalized value.

**Per document: considerably better, but ephemeral.** `debugDocuments` carries a real per-document
record:

```
document_request_id, title, filename, extension,
byte_fetch_attempted, byte_fetch_error,
extraction_attempted, extracted_text_length, extraction_error,
harvested_field_count, text_path_yield_discarded, source_type
```

with `source_type` distinguishing `pdf_native_text`, `docx_native_text`, `vision_pdf`,
`vision_image`, `vision_pdf_escalated`, and `skipped_duplicate_object`. That is a genuine signal and
it does separate "could not read" from "read and found nothing."

**It is never persisted.** It is returned in the HTTP response body of
`POST /api/packages/:id/extract-document-candidates` and nowhere else. It lives for one click. And
`skipped_unsupported` is not one of its values — it is inferred in a `console.log` at `:20018`.

**The statement analyzer is the exception, and it is the good example in this codebase.**
`statement_analyses.extraction_status` is a persisted enum — `pending_upload`, `uploaded`,
`extracting`, `extracted`, `review_required` — alongside `review_reason` with ten distinct persisted
values (`low_overall_confidence`, `processor_not_identified`, `processor_not_in_allowlist`,
`effective_rate_out_of_band`, `extraction_json_parse_failure`, `extraction_schema_mismatch:…`, and
others). That is the one place where "we could not establish this" is a first-class, durable,
distinguishable outcome rather than an absent key.

---

## 6. Confidence

Three mechanisms. One is arithmetic on nothing, one is a constant, one is self-reported and
unvalidated.

**1. Text path — arithmetic, not measurement.** `computeCandidateConfidence` (`:19004-19011`) in
full:

```js
let confidence = usedNextLine ? 0.84 : 0.92;
if (genericLabelSet.has(labelNorm)) confidence -= 0.04;
if (sourceType === "pdf_native_text") confidence += 0.02;
else if (sourceType === "docx_native_text") confidence += 0.01;
return Math.max(0.55, Math.min(0.99, Number(confidence.toFixed(2))));
```

It is a function of *how* the match was shaped — same line or next line, generic label or specific,
PDF or DOCX. It never looks at the value. Nothing in it derives from any measurement of whether
extractions are correct. **Observed**: the three candidates produced from a real filled merchant
application (§8) scored **0.90, 0.94 and 0.94**, and all three are wrong.

**2. Vision path — hardcoded.** `VISION_CANDIDATE_CONFIDENCE = 0.9` (`:19740`), applied to every
field of every vision extraction. The model is never asked for a confidence and could not report one
through the schema if it wanted to. The comment states the reason plainly: the value was chosen to
clear the auto-apply threshold, not to describe anything — "Vision has no per-field confidence; use
the existing auto-apply threshold (0.9) so NON-exact-value vision fields auto-apply like text fields
do."

**3. Statement path — self-reported, unvalidated.** The model returns a `confidence` per field and
an `overall_confidence`; `evaluateReviewTriggers` gates on `CONFIDENCE_FLOOR = 0.85` plus sanity
bands (effective rate must land between 1.5% and 6%). This is the only confidence in the codebase
that varies with anything real. Whether it is *calibrated* has never been measured — no test, no
labelled corpus, no recorded accuracy figure anywhere in the repo.

**The numbers are load-bearing.** `0.9` is the auto-apply threshold in `getTrustedDocAutoApply`
(`src/pages/PackageDetail.tsx:1712-1868`): a single candidate at `confidence >= 0.9`, on a
registered field strategy, into an empty field, is written without a human seeing it. Both the
fabricated `0.9` and the arithmetic `0.92`/`0.94` clear that bar by construction.

---

## 7. Document classification

**It must be told, and it is told by a human before the document exists.**

Each upload attaches to a `document_requests` row whose `title` was chosen by staff from a
requirements catalog ("Voided Check", "Owner 1 Photo ID", "Processing Statement"). The extractor
reads `row.title` only to populate the debug row and the log line. **It never branches on it.**
Dispatch is by filename extension alone.

The one thing resembling classification is in the statement extractor, and it classifies the
*processor*, not the document: the model is asked to name the processor, and told that "if the
document is not a processing statement, set `processor_name.value` to null and
`overall_confidence` to 0.0, with notes explaining." That output is gated against
`STATEMENT_PROCESSOR_ALLOWLIST` — 41 hardcoded strings, case-insensitive **prefix** match. Anything
outside the list routes to human review.

How well does it work? **Unmeasured.** No test, no labelled set, no accuracy figure in the repo or
its history. And the prefix match is loose in a specific direction: the allowlist contains
`"North"`, so a `processor_name` of `"Northern Trust"` passes.

The intake vision prompt does enumerate document kinds — "a merchant processing application, a
scanned/photographed form, a bank letter, a voided check, etc." — but purely as framing. It returns
the same flat ~70-field schema whatever it was given, and never reports which kind it saw.

---

## 8. Hard cases

### The headline result: filled PDF forms are invisible to the text path

**Observed**, against `test-fixtures/north_mpa/out/intake_acme_sole_prop.pdf` — a committed fixture,
a real 4-page North merchant processing application, generated by that app's own MPA writer:

- The PDF carries **238 AcroForm fields, 67 of them filled**, including
  `Merchant Name = "Acme Foods LLC"`, `DBA = "Acme Donuts"`, `Address = "123 Main St"`,
  `City = "Springfield"`, `Zip = "62701"` (read out with `pdf-lib`).
- `pdf-parse` `getText()` returns **17,409 characters** — the blank form template. The string
  `"Acme Foods LLC"` **does not appear in the extracted text at all.**
- The harvest produced **three candidates, all wrong**:

| Field | Value harvested | Matched label | Confidence |
|---|---|---|---|
| business legal name | `"Merchant Address"` | `Merchant Name` | 0.90 |
| dba name | `"(Doing Business As) Name"` | `DBA` | 0.94 |
| bank name | `", Fresno, CA."` | `Bank` | 0.94 |

The third is a fragment of North's ISO disclosure boilerplate ("…and FFB Bank, Fresno, CA.").

`pdf-parse` reads the page content stream; AcroForm widget values live in the form dictionary, and
nothing in this pipeline reads them. `pdf-lib` is already a dependency and can read them — it is
used to *write* the same field set in `north_mpa_pdf.mjs` — but it is never pointed at an upload.

Strong yield here is 0, so this document would be nominated for vision escalation and, if it won
that contest (below), the junk would be discarded and replaced by a vision read. If it lost, the
junk commits. **Observed** by transcribing the client gate `isNoisyTrustedValue`
(`PackageDetail.tsx:1812-1827`) and running the three values through it: **none of the three is
caught**. Of the three, only `dba name` sits on an auto-applying strategy (`trusted_identity_text`),
so `"(Doing Business As) Name"` at 0.94 satisfies every condition for silent auto-apply into an
empty DBA field. The other two remain unapplied candidates in the store.

### The four named cases

| Case | Status | Evidence |
|---|---|---|
| **Multi-document PDF** (four documents in one scan) | **Not handled** | Observed |
| **Password-protected PDF** | **Not handled** | Observed |
| **Phone photos, skew and glare** | Routed to vision; quality unknown | Documented |
| **Pure-image scan, no text layer** | **Partially — and the documented mechanism does not hold** | Observed |

**Multi-document PDF.** Observed: two 4-page applications concatenated into one 8-page PDF yields
one flat 35,090-character string. `pdf-parse` does expose `pages[]`, which is discarded (§4).
`extractLabeledValue` **returns on the first match** for each field and stops searching, so only the
first embedded document's values can ever be found — the second, third and fourth are unreachable by
construction, not merely unlabelled. Every candidate carries the same `source_document_request_id`.
Nothing anywhere detects a document boundary. Observed harvest on the concatenated file was
identical to the single file: the same three junk candidates.

**Password-protected PDF.** Observed: `PDFParse#getText()` rejects with
`PasswordException: No password given`. The loop catches it at `:19957-19959`, writes
`extraction_error`, and `continue`s — so it **never reaches the vision arm**, and because the row
errored it is never stamped, meaning every subsequent run re-downloads the file and fails
identically. `pdf-parse` accepts a `password` option; nothing passes one, and there is nowhere in
the schema to store one.

**Phone photos.** These go to the vision arm as an `image` block, which is the right instrument for
skew and glare, and the working log confirms phone-photographed IDs and voided checks are the
highest-frequency real inputs. I did not test quality — that requires a paid call. Two adjacent
facts: `.heic` (iPhone default) and `.gif` are accepted by the uploader and silently skipped by the
extractor (§1); and the client compresses card images before upload (commit `8dcb4bf`) but there is
no equivalent for intake document images.

**Pure-image scans — a documented claim that observation contradicts.**

The escalation commit `ce5c480` states: *"11 pages of an image-only PDF already route to vision today
via `INTAKE_TEXT_MIN_CHARS`."* The dispatch it refers to is:

```js
if (!visionMediaType && ext === ".pdf" && normalizedText.trim().length < INTAKE_TEXT_MIN_CHARS) {
  visionMediaType = "application/pdf";   // INTAKE_TEXT_MIN_CHARS = 20
}
```

**Observed**, generating image-only PDFs at several page counts and running the shipped
`extractNativeTextFromPdf` + `normalizeExtractedText`:

| Pages | `normalizedText.trim().length` | `< 20`? |
|---|---|---|
| 1 | 12 | **yes** → vision |
| 2 | 26 | no |
| 3 | 40 | no |
| 5 | 68 | no |
| 10 | 149 | no |

`pdf-parse` 2.4.5's default `pageJoiner` appends `-- N of M --` after each page's text
(`PDFParse.js:135-142`). A pure-image PDF therefore has a non-empty "text layer" consisting entirely
of the parser's own page separators — 12 chars at one page, growing linearly. **Only a single-page
image-only PDF routes to vision by the empty-text rule.** The claim in the commit message is wrong
for every multi-page scan, which is most of them.

Multi-page scans are not lost outright, because they land in the text path with a strong yield of 0
and become *escalation nominees*. But escalation is capped at **one document per invocation**
(`:20032-20038`), selected by lowest strong yield, tie-broken by **largest** text length. Two
consequences follow, both visible in the code:

- A 2-page scan (26 chars) loses that tie-break to any longer zero-yield document — including
  exactly the flattened-AcroForm PDFs the escalation was built for (36,664 chars in the live case
  the commit cites).
- **A losing nominee is stamped.** It committed an empty harvest, recorded no error, and so appears
  in `processedRowIds`; `extracted_at` is set and it is filtered out of scope on every subsequent
  run. It never gets another chance at vision without a `force` re-scan.

Net effect: an unreadable multi-page scan can be permanently marked as processed, having contributed
nothing, with no persisted record saying so. That is the same shape as **D-026** — a verdict resting
on a surface that was never established, in the direction where nobody notices. Flagged because that
pattern is precisely what this survey exists to avoid repeating.

---

## 9. Structure and portability

**Split verdict. The three vision services are clean. The text path is not separable.**

### Portable as-is

| File | Lines | Imports | Shape |
|---|---|---|---|
| `services/intake_doc_extraction.mjs` | 508 | **none** | `(bytes, media_type, filename) → {ok, fields} \| {ok:false, error}` |
| `services/card_extraction.mjs` | 208 | **none** | `({images}) → {ok, fields} \| {ok:false, error}` |
| `services/statement_extraction.mjs` | 332 | one local (`statement_processor_allowlist.mjs`) | `(pdfBuffer) → {parsed, canonical, review, usage, model}` |

All three are pure functions over bytes. No database, no Express, no React, no storage layer. Their
only environment coupling is `process.env.ANTHROPIC_*`. These would move into a workspace package
the way `packages/ruleset` works here essentially unchanged.

### Not separable

`runDocumentExtraction` is **~1,700 lines** (`server/index.mjs:18533-20240`) inside a **44,908-line,
2.25 MB** single file. Everything a Documents Check design would care about —
`normalizeCandidateValue`, `isObviousNoiseValue`, `isFieldValueValid`, `computeCandidateConfidence`,
`harvestCandidatesFromText`, the ~70-field strategy registry — is declared as `const` arrow
functions **inside that function's body**, closing over `targetFieldSet`, `extractedAt` and
Supabase-shaped `row` objects. Nothing is exported. There is no module boundary to lift.

A concrete measure of the entanglement, and of its limit: to run any of it for this survey I had to
slice lines out by number and re-wrap them, stubbing two closure variables. That worked on the first
attempt, which says the *logic* is close to pure. It is just not code anything can import.

Two coupling problems are worse than the file layout and would survive a move:

- **`deriveStrictValidatedFieldKeys` (`:18513`) reads its own source text.** It calls
  `Function.prototype.toString()` on `isFieldValueValid` and regex-matches `field === "..."` out of
  the result to build the strict-validation key set. **Observed**: it currently derives **29 keys**
  and reports `sane = true`. Any bundler, minifier, transpiler, or refactor to a lookup table in a
  new home changes that source text — and the failure is designed to be silent but conservative
  (`sane = false` disables vision escalation entirely rather than escalating everything).
- **The field vocabulary is `document_requests.title` strings.** Candidate keys are human-readable
  catalog titles like `"who was your last processor/bank?"` and `"owner 1 ownership %"`, matched by
  a normalizer that lowercases and collapses underscores. Anything consuming this extractor inherits
  that vocabulary, and that app's requirements catalog with it.

---

## 10. Tests and known failure modes

### Coverage: zero

93 test files in the repository. **Not one** imports or exercises `intake_doc_extraction.mjs`,
`statement_extraction.mjs`, `card_extraction.mjs`, `runDocumentExtraction`, or
`harvestCandidatesFromText`. Verified by grep across every `*.test.mjs` in the repo.

There is no document fixture for the extraction path either. The PDFs under
`test-fixtures/north_mpa/out/` are *outputs* of the MPA writer; the two in `smoke-output/` are
generated estimate PDFs. No sample scan, no sample statement, no sample voided check, no `.docx`
intake form. (I used the MPA writer's outputs as inputs anyway — that is how §8's AcroForm result was
obtained.)

Where file-parsing tests do exist — 9 under `server/jobs/sftp_parsers/__tests__/`, plus
`north_csv_parser.test.mjs` and the XLSX importer — they cover fixed-schema CSV reports, not
documents.

The verification method of record is **production smoke on live merchant packages**, named in the
working log (`CLAUDE.md`): the Riverside Liquor Warehouse application.

### What the code and its history say about where it breaks

Quoted or paraphrased from source comments and commit messages, all in that repo:

1. **Flattened AcroForms defeat label-adjacency.** From `ce5c480`: for a DocuSign-flattened form,
   "pdf-parse emits the static page text first and the filled values in a separate block, so a label
   and its value land thousands of characters apart." Live measurement quoted there: four PDFs
   produced 3 candidates between them, two of which were label fragments (`"DISCLOSURE"`,
   `"(Doing Business As)"`); four images produced 28.
2. **Timeouts re-bill indefinitely.** Named as an open carry-forward in `ce5c480`; the stated fix
   (a terminal state after N attempts) is not implemented.
3. **A failed escalation now yields nothing.** Accepted explicitly: "Zero plus a visible retry is
   honest."
4. **The multi-page escalated PDF has never run.** The 75s per-call bound is sized against an
   *estimate*: "A 10-page PDF is ESTIMATED at 27-44s and has never actually run in production, so the
   estimate could be materially low." The only measured vision latency in the codebase is a single
   `.jpg` at 11–14s.
5. **The 12s loop budget is derived from a platform cap.** `EXTRACTION_TIME_BUDGET_MS` is reasoned
   from Netlify's ~26s proxy cap and a measured ~3.5s/document, admitting roughly four documents per
   click. An 8-document package needs two clicks by design.
6. **Escalation is capped at one document per invocation** — deliberate, to bound cost and latency.
7. **`.gif` divergence is intentional and recorded** (`CLAUDE.md` 2026-08-14).
8. **The design memo's own risk statement**: the merchant attestation review was retired 2026-04-11,
   so "there is NO reliable downstream catch for a confident vision misread of an exact-value field."
   The mitigation shipped — vision-sourced candidates for the ~9 exact-value fields (tax ID, routing,
   account, volumes, SSN, DOB, ownership %) are blocked from auto-apply and routed to reconciliation
   (`PackageDetail.tsx:65-141`, `:1847-1849`). It covers vision only; text-path values for the same
   fields still auto-apply.

### Two failure modes the code does not know about

Both observed in this survey, neither documented anywhere in that repo:

- **Filled AcroForm values are unreadable by the text path** (§8). The known problem was *flattened*
  forms where label and value drift apart. The measured problem is broader: an unflattened filled
  form yields the blank template, and the values are not in the extracted text at any distance.
- **The empty-text-layer rule does not fire for multi-page scans** (§8). `pdf-parse`'s own page
  separators exceed the 20-character threshold from two pages onward, so the documented "image-only
  PDFs route to vision" mechanism applies only to single-page files.

---

## Summary for the design conversation

- The **vision services are lift-and-shift**; the **text harvester is not**.
- **Provenance below document level does not exist** — the answer that most constrains a design
  bound by hard constraint 3.
- **Confidence is largely fabricated**: two of three mechanisms produce numbers with no relationship
  to correctness, and those numbers gate silent auto-apply at 0.9.
- **Absence collapses per field.** The one durable, distinguishable "could not establish this"
  signal in the whole codebase is `statement_analyses.extraction_status` + `review_reason`.
- **Classification does not exist** — documents are identified by a title a human assigned in
  advance.
- **Every extraction capability worth having is a metered LLM call**, with no local fallback and no
  budget guard.
- **Nothing is tested.** The extraction path has zero automated coverage and is verified by smoking
  live merchant data.
