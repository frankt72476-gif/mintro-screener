# Discovery: adult AI screener vertical

Read-only discovery for `docs/adult-ai-screener-design.md` §11. No code was changed. This note records
what the code does as of `917078e` (2026-09-18), which changes no code since `cdc54ea`. It proposes no fixes.

**Method.** Items 1–3 and 5–7 were read directly. Item 4 (crawler) came from a delegated read-only
search; eight of its citations were re-read and matched (`signup.ts:552`, `discover.ts:140`,
`discover.ts:366-368`, `render.ts:404`, `extract.ts:601`, `consentGatePass.ts:34-40`,
`domAssert.ts:575`, and the absence of `llms` in source). Its other citations were not individually
re-read. Item 7 was built from a TypeScript AST scan of string literals and JSX text, so comments
are excluded by construction. Each hit was then classified by reading its context.

**Next free decision record number: D-284.** The highest heading in `docs/DECISIONS.md` is
`## D-283` (line 19099). Other `D-3xx`/`D-9xx` matches in the file are compound names such as
`LGD-4033`, not decision records. The memo's §13 proposes five records; if all five are written
they would be D-284 to D-288.

---

## Where the memo's assumptions and the code differ

These come out of the items below. They are listed together here because several §5 and §10 lines
assume them.

| Memo says | Code has |
|---|---|
| Rule IDs `AAI-GATE-001` (§5) | `RULE_ID_PATTERN = /^[A-Z]+-\d{3}$/` (`packages/ruleset/src/vocabulary.ts:227`) allows exactly one hyphen. The invariant takes the prefix as `rule.id.slice(0, rule.id.indexOf('-'))` (`invariants.ts:125`), which here would be `AAI`. `CATEGORY_PREFIX_PATTERN = /^[A-Z]+$/` (`vocabulary.ts:230`) does not allow `AAI-GATE`. |
| `source: external` / `source: mintro` (§5) | `RULE_SOURCES = ['programme', 'mintro']` (`schema.ts:51`). The corpus check counts and matches only `source === 'programme'` (`corpus.ts:109`). |
| Enforcement values `report` / `referral_policy` (§5) | `tier` is `auto_fail` \| `review_only` (`vocabulary.ts:36`). `evaluation_tier` is required and is `legality` \| `routing` \| `evidence` (`schema.ts:72`, `vocabulary.ts:54`). `weight` is required on evidence and routing rules (`invariants.ts:172-189`). |
| Outcomes "stay as they are in the engine: `observed`, `not_observed`, `not_evaluable`, `attested`, `unanswered`" (§5) | Engine states are `fail`, `review`, `pass`, `not_evaluable` (`vocabulary.ts:14`). The schema requires a rule set to declare exactly those four (`schema.ts:200-206`). Rendered labels are *Not met / Unclear / Met / Not observed* (`packages/engine/src/stateLabel.ts:41-46`), so the existing label **"Not observed" means `not_evaluable`**, not the memo's `not_observed`. Attestation outcomes are `answered` / `declined` in storage (`0044_merchant_attestations.sql:57`), with `unanswered` resolved in `packages/engine/src/attestations.ts`. |
| A4: no human in the loop; borderline observations render as `not_evaluable` | A violation of a `review_only` rule becomes `review` (`packages/engine/src/findings.ts:167-169`). `text_cooccurrence` rules are forced to `review_only` (`invariants.ts:19-25`, `:284-290`; hard constraint 4). |
| Send path "reused unchanged" (§10) | The send refuses any run without a published evaluation and a completed capture of it (item 3). |
| Attestation `authority` | The enum is `law` \| `network` \| `programme` (`schema.ts:241`). |

---

## 1. Vertical threading

### Where a key could live

| Table | What the schema says | Line |
|---|---|---|
| `organizations` | The access boundary: one host (Mintro), and every other row is a partner agency. There is no product or programme attribute. | `supabase/migrations/0060_organizations.sql:32-44` |
| `merchants` | One row per storefront domain, `domain` unique, **no `org_id`**. The worker upserts it on domain (`persist.ts:176`). | `0002_merchants.sql:6-12`; `apps/worker/src/store/persist.ts:289-300` |
| `scan_requests` | The request row: `url`, `requested_by`, `status`, `mode` and so on. No programme attribute. The worker's claim select is `id, url, status, claimed_at, mode, requested_by, analysts:requested_by (org_id)`. | `0012_scan_requests.sql:17-47`; `apps/worker/bin/worker.ts:609-610`, `:630-634` |
| `runs` | `mode`, `ruleset_version` (text, non-empty) and `report` (jsonb). Frozen by trigger once `finished_at` is set. | `0004_runs.sql:10-38`, `:52-75` |

Two facts bear on this choice.

**Adding a column to `runs` has a precedent that leaves the immutability trigger intact.**
`0060_organizations.sql:106-164` adds `runs.org_id` by DDL, using `add column ... not null default <value>`
and then dropping the default, with no `UPDATE`. The comment at `:113-115` states that this is what
kept `runs_are_immutable_once_finished` intact over existing finished runs. `org_id` reaches the run
from the request at claim time (`worker.ts:152-166`, comment at `:160-164`), and is written in
`insertRun` (`persist.ts:318-329`).

**A run does not record which rule set file produced it, only a version string.**
`runs.ruleset_version` is `ruleset.version`. The stored report holds `rulesetVersion` and
`rulesetEffective` (`packages/engine/src/report.ts:611-612`). Two rule set files with overlapping
semver values would give identical `ruleset_version` values on their runs. The schema also has a
`source_document` field (`schema.ts:287`), but it is not written to the run.

### Places that would branch on it

| Concern | Current behaviour | Location |
|---|---|---|
| **Rule set load (worker)** | One file, loaded once at process start and passed to every request. | `apps/worker/bin/worker.ts:170` → `:307` → `:701` |
| Rule set load (other entry points) | Hard-coded `'rules/ruleset.json'`. | `apps/worker/bin/scan.ts:45`; `apps/worker/src/rules.ts:10`; `packages/engine/bin/scan-layer0.ts:57`; evaluation-layer callers `evaluationRun.ts:27`, `evaluationPublishJob.ts:45`, `bin/evaluate.ts:34` |
| Rule set in the browser | Bundled import of `rules/ruleset.json`, parsed once. Used by the Rule set pane, the rail version line and the attestation resolve gate. | `apps/web/src/App.tsx:12`, `:683`, `:929`, `:1180`, `:1202`; `apps/web/src/lib/evaluationLabels.ts:13` (evaluation layer only) |
| **Attestation set** | Held in the rule set file (`attestations`, `schema.ts:229-264`, `:294`). Snapshotted into each run's report at assembly (`report.ts:637`). The merchant page and the capture read the snapshot, not the file (`report.ts:326-338`). Stored answers are checked only for slug shape (`0044_merchant_attestations.sql:50`). **A per-vertical rule set file carries its own question set, and nothing downstream reads the file again.** The merchant-facing framing copy is peptide-worded: `Attestations.tsx:503`, "Some of these standards are about what happens away from your website — where you ship, what your support team says, who tests your batches…". | as cited |
| `not_checked` boundary | The same pattern: data in the rule set (`schema.ts:273-278`), snapshotted at `report.ts:636`. | as cited |
| **Report renderer** | The only render the capture accepts is the published evaluation. See item 3. | `App.tsx:1977-2028`; `apps/worker/src/captureJob.ts:75-81`; `apps/worker/src/capture/document.ts:298-304` |
| Requirement heading | `ReportView` branches on `source` between `REQUIREMENT_HEADINGS.required` ("Published standard") and `.mintroObservation`. | `packages/engine/src/copy.ts:450-464`; `apps/web/src/components/ReportView.tsx:1876`, `:1904-1905` |
| **Send copy** | The subject is vertical-neutral: `Mintro screening report: <domain>, <date>` (`apps/worker/src/send.ts:312-328`). The body carries `evaluationPosture(domain)`, a sentence about "a view of what the business is and where it fits" (`send.ts:363`; `copy.ts:631-647`). It also says "The evaluation is a link, served by Mintro:" (`send.ts:367`). The recipient defaults to `underwriting@iqwallet.com` (`apps/web/src/components/SendModal.tsx:35`). | as cited |
| **Capture** | `assertCapturable` requires the literal `EVALUATION_POSTURE` in the bytes. | `capture/document.ts:298-304` |
| Validator | Fixed rule set default path, corpus path, angle-set path and ratified tier lists. See item 2. | `packages/ruleset/bin/validate-ruleset.ts:24`, `:62`, `:116` |
| Crawl pipeline | Stages keyed on the peptide programme run whatever the rule set holds. The COA fetch runs whenever pages were sampled (`apps/worker/src/screen.ts:619-645`). Product sampling uses `products` scope and `ruleset.sampling` (`packages/engine/src/suspicion.ts:120-125`, `:187`). | as cited |
| Rule set pane copy | "No other programme rule set exists. Gaming, adult and any other vertical would be added here as its own labelled set…" | `apps/web/src/components/RuleSetPane.tsx:155-157` |

### Minimal touch-point set, as the code stands

These are the places that currently assume one rule set, one report render or one email wording.
Changing any of them is not proposed here.

1. The request-to-run carry: `scan_requests` columns, `worker.ts:609-634`, `persist.ts:318-329`.
2. Rule set selection: `worker.ts:170`, plus the CLI entry points listed above.
3. The validator entry point: `validate-ruleset.ts`.
4. Report render and capture gate: `App.tsx` `PrintOnly`, `captureJob.ts:75-81`, `document.ts:298`.
5. Send gate and body: `sendJob.ts:96`, `:324`, `:336-400`; `send.ts:330-390`.
6. The browser's bundled rule set: `App.tsx:12`, `:683`.

These need **no** branch, because they already follow the rule set file: the attestation set,
`not_checked`, rule titles and clauses (all snapshotted into `runs.report`), and every check handler.

---

## 2. Rule set loader

### Loading a second file

`loadRulesetFile(path)` takes any path (`packages/ruleset/src/loadFile.ts:19-39`). `parseRuleset(value, source)`
validates any in-memory document (`load.ts:68-89`). Neither names a file. The package exports
only the loader; nothing inside it opens `ruleset.json`.

The limit is what the schema admits, not which file is loaded. A second file loads with no engine
change only if it fits these closed vocabularies:

- the ID and prefix patterns (see the table above);
- `source` ∈ {programme, mintro};
- the four states;
- `tier`, a required `evaluation_tier`, and `weight`;
- `CHECK_TYPES` (`vocabulary.ts:20-30`);
- `SURFACES` (`vocabulary.ts:131-154`);
- `URL_SCOPES` (`vocabulary.ts:169`);
- attestation `authority`;
- `DOM_DETECTS = ['gateway']` (`vocabulary.ts:188`);
- `FLOWS` (`vocabulary.ts:219`).

`vocabulary.ts:2-8` states that adding a member to any of these is a code change by definition.
`SURFACES` has no member for a docs host, a pricing page, a character library or a chat surface.

### The corpus

`checkAgainstCorpus(ruleset, corpusText, source)` is pure and takes the text (`corpus.ts:94`).
`checkAgainstCorpusFile(ruleset, path = CORPUS_PATH)` takes a path (`corpusFile.ts:22`). Both
functions accept a second corpus. What is fixed:

- `CORPUS_PATH = 'rules/sources/ruo-standards-v1.1.md'` (`corpusFile.ts:13`).
- `CORPUS_CLAUSE_HEADING = '## From the standards'` (`corpus.ts:57`). Clause lines are the non-blank
  lines after that heading, up to the next `## ` (`corpus.ts:76-86`). A corpus without that exact
  heading yields zero clause lines.
- The check keys on `source === 'programme'` (`corpus.ts:109`). `mintro` rules are checked only for a
  non-empty clause (`corpus.ts:243-247`).

### Assumptions the validator CLI makes (`packages/ruleset/bin/validate-ruleset.ts`)

- The rule set path defaults to `rules/ruleset.json` (`:24`). It takes a path argument (`:27`).
- The corpus is always `CORPUS_PATH`, whatever rule set is given (`:62-63`). The comment at `:58-61`
  says why: "the corpus is not a parameter of the rule set being validated … there is one of it".
- `checkRatifiedTiers` always runs (`:54`). It requires every ID in `LEGALITY_RULE_IDS` and
  `ROUTING_RULE_IDS` (`vocabulary.ts:94-111`: `CATG-003`, `PAY-001`, `GATE-002` and so on) to be
  present with that tier, and reports each missing one (`ratified.ts:77-87`). **A rule set without
  the peptide IDs fails this step.**
- The angle set at `rules/angles.json` always loads against the given rule set (`:116`). Coverage
  requires every non-legality rule to appear in some angle (`angles.ts:285-296`), and every angle
  rule ID to exist. **A rule set other than the peptide one fails this step.**

`ratified.ts:25-30` records that the ratified check was kept out of `parseRuleset` on purpose,
because "a loader refusing it would be asserting that every rule set in the world is Mintro's".
Only the CLI and `ruleset-json.test.ts` run it.

`packages/ruleset/test/ruleset-json.test.ts` pins the shipped file's counts: 62 rules at `:100`,
20 attestations at `:101`, 10 categories at `:102`, 53 corpus lines at `:150`, 52 programme rules
at `:151`, and 1 asked question at `:152`. It reads paths from `test/paths.ts`.

### Vacuous-pass guards (`corpus.ts`)

1. An empty corpus is a defect and returns immediately (`:103-106`).
2. Zero clause lines under the heading (missing heading or empty section) is a defect and returns
   (`:126-134`).
3. Count equality: programme rules plus questions carrying a `clause` must equal the number of
   clause lines (`:144-152`).
4. A clause containing a line break is a defect (`:166-175`).
5. Each clause must be a byte-exact substring of the corpus (`:177-186`) **and** equal to a clause
   line, not just contained in prose or provenance text (`:190-198`).
6. Question clauses are checked against the corpus the same way (`:215-224`).
7. Reverse direction: a corpus line no rule or question quotes is a defect (`:226-233`).
8. An unreadable corpus file is a defect, not a skip (`corpusFile.ts:24-29`).
9. Not in the validator on purpose: a pinned line count. It lives in `ruleset-json.test.ts:150` and
   covers the case where both files shrink together (`corpus.ts:22-37`).

`packages/ruleset/package.json:6` describes the package as the loader "for the RUO peptide program
rule set".

---

## 3. Findings report path after D-262 / D-263

**Status: present, and unmounted from the analyst review screen and from the capture.** Its
component is live on one browser route. Nothing has been deleted: D-262 says so ("Nothing is
deleted — removal is cluster 5's decision", `DECISIONS.md:17168-17169`).

| Piece | State | Evidence |
|---|---|---|
| `ReportView` (the checklist renderer, 2,245 lines) | Present. **Mounted** only on the browser print route `?report=<domain>&print=1` for a signed-in analyst. **Not mounted** on the review screen or in the worker capture (`PrintOnly`). | `apps/web/src/App.tsx:1104-1130` (mounted); `:1291-1300` (review screen, not mounted); `:1995-2003` (capture, not rendered) |
| Components reached only through `ReportView` | `AttestationSection`, `EyeTestPanel`, `MerchantResponse`, `Participation`. They reach an analyst only via the print route above. | `DECISIONS.md:17165-17169`; `App.tsx:1298-1300` |
| Worker capture (`PrintOnly`) | Renders only `PublishedEvaluation`. With no evaluation it renders "This run has no published evaluation, so there is nothing to capture." | `App.tsx:1977-2028`, `:2004-2014` |
| Capture payload | Still carries `attestations`, `commentary` and `eyeTest`, and "nothing reads them". | `App.tsx:1999-2002`; `apps/worker/src/captureJob.ts:101-126` |
| Capture job | Refuses a run with no published evaluation before the browser starts. | `captureJob.ts:75-81` |
| Capture assertion | Requires `EVALUATION_POSTURE` in the bytes. `ReportView` renders `REPORT_POSTURE` instead (`ReportView.tsx:371`). A capture of `ReportView` would therefore be refused. | `capture/document.ts:298-304`; `packages/engine/src/copy.ts:647`, `:649-652` |
| Capture trigger | Only from `evaluation_capture_requests` (queued at publish, `0082`). There is no capture at assembly any more. | `apps/worker/bin/worker.ts:554-584` |
| Send | `latestCapture` → `assertCaptureIsOfLatestPublished`. This refuses with no row in `evaluations` and no `done` capture request for the newest version. | `apps/worker/src/sendJob.ts:96`, `:287-324`, `:336-400` |
| Old checklist captures | Reachable via *Open report*, labelled as the checklist, and not sendable (the gate above refuses them). | `DECISIONS.md:17263-17266`; `App.tsx:1341-1361` |
| PDF path (`pdf.ts`) | Present. Called only from worker `bin/` scripts (`report-pdf.ts`, `print-check.ts`, `compose-check.ts`, `page-budget.ts`), not from the job loop. | `grep` of `renderReportPdf` callers |
| Documents Check report | A separate renderer and PDF send path, untouched by D-262/263. | `App.tsx:1974`; `DECISIONS.md:16370-16373` |

**Can it render per vertical without reviving the peptide checklist send path?** As the code stands:

- **Rendering.** `ReportView` renders from a `ScreeningReport` held in `runs.report`, which carries its
  own snapshotted titles, clauses, attestation questions and `not_checked` (`report.ts:611-637`). It
  does not read `rules/ruleset.json`. It is not peptide-keyed by file. It does carry the checklist
  vocabulary: the verdict banner, counts, *Met / Not met* labels, the stopping-conditions block and
  `REPORT_POSTURE`. Item 7 lists the relevant strings.
- **Capture and send.** Every path that produces or sends a capture now requires a published
  evaluation: `captureJob.ts:75-81`, `document.ts:298`, `sendJob.ts:336-400` and `PrintOnly`. The
  only thing that enqueues a capture is `evaluation_capture_requests`. So nothing currently lets
  `ReportView` output reach a capture or a send. Doing that would require a change to that gate
  chain, whether the target is the old checklist or a new findings component. **No existing path
  captures or sends a non-evaluation report.**

Two in-code comments disagree with the code beside them:

- `App.tsx:1298` says "The capture route still renders it". `PrintOnly` does not (`App.tsx:1995`).
- `worker.ts:546-552` says the evaluation capture is "refused, on purpose, until cluster 4". The
  code below it captures (`:565-577`).

---

## 4. Crawler

### (a) Docs subdomain, `/docs`, `llms.txt`: not supported

- **Host bound: one exact origin.** `discover.ts:160` uses `new URL(origin)`, and robots is fetched
  from that origin (`:228`). `screen.ts:372`, `:383` and `:656` all use `layer0.origin`. No
  registrable-domain logic exists. `merchantDomain.ts:58-82` only strips `www.`, and keeps
  `shop.merchant.com` distinct on purpose (`:24-26`).
- **`docs.*` is rejected by `startsWith(origin)`** in Layer 3 candidate selection:
  - `signup.ts:552`, "an entry on another origin is somebody else's site" (`:544`);
  - `signup.ts:637` and `:764`;
  - `wall.ts:85` treats a redirect to another host as not serving the page.
- **Sitemap entries are not host-filtered.** `discover.ts:366-368` (index) and `:374-383` (urlset)
  keep every `<loc>`. So a main-origin sitemap index that names a docs-host sitemap would be
  fetched, and docs URLs classified `products` could reach the Layer 2 render sample
  (`screen.ts:437`). They would still be dropped from Layer 3.
- **How sitemaps are found:** `Sitemap:` lines in robots (`robots.ts:62-67`); otherwise the fixed
  paths `/sitemap.xml`, `/sitemap_index.xml` and `/sitemap-index.xml` (`discover.ts:140`, `:262-265`).
  Caps: depth 3, 40 documents, 25,000 URLs (`discover.ts:35-40`). A document that is neither
  `<urlset>` nor `<sitemapindex>` is rejected (`sitemap.ts:76-80`), so a plain-text `llms.txt`
  cannot pass through this path.
- **`llms.txt` / `.well-known`:** no code reference. The only other fixed-path fetches are Layer 3
  surface paths (`signup.ts:51-70`) and cart APIs (`cart.ts:93`, `:104`).
- **Politeness:** one pacer per run, built from the target origin's robots.txt (`screen.ts:375-376`).
  `Crawl-delay` is capped at 5 s (`politeness.ts:19`, D-013). There is no per-host pacing.

### (b) Rendered DOM for feature detection: DOM is kept; detection surface is narrow

- **Rendering:** `apps/worker/src/render.ts:289` (`renderPage`). It navigates with
  `goto(..., { waitUntil: 'domcontentloaded' })` (`:358`), then `networkidle` with 8 s by default
  (`:154`) or 3 s for probes (`:177`). Alternatively it uses `settle: 'content'`, which waits on
  product selectors plus `load` for 4 s each (`:186`, `:206-219`, D-280). Settle failures are
  swallowed. It cannot wait for an arbitrary selector.
- **The DOM is kept.** `page.content()` is read at `render.ts:404` and put into `PageContext.html`
  (`render.ts:719`; `packages/engine/src/page.ts:228-229`). It is also stored gzipped as a `dom`
  artifact (`render.ts:594-620`). One browser identity is used for all of this (D-278,
  `render.ts:258-272`).
- **What handlers see.**
  - `domAssert` signals: a substring search over `text + html` (`domAssert.ts:575`).
  - Selector counts: precomputed in-page over the top document (`extract.ts:601`). A selector never
    evaluated returns `not_evaluable` (`domAssert.ts:372-381`).
  - Selectors are collected only from Layer 2 `dom_assert` rules (`screen.ts:958-966`) and passed
    only to product-sample renders (`screen.ts:484`). The homepage render gets none
    (`screen.ts:388-395`).
- **File inputs:** no detector. There is no `type=file` or `setInputFiles` in engine or worker source.
  A file input inside a sign-up form would be listed as a field of type `file`
  (`extract.ts:790-794`, `:812`).
- **Which URLs get rendered:** the homepage; sitemap URLs in `products` scope, scored and capped
  (`screen.ts:437-452`, D-223); and Layer 3 candidates on the same origin (fixed paths, slug-matched
  sitemap entries, up to 4 homepage links, `signup.ts:191`). There is no hook for an arbitrary URL
  such as a create-character page, unless it falls into one of those.

### (c) Public chat widget: nothing exists

| Primitive | Where | Use |
|---|---|---|
| `click` | `flow.ts:438`; `driveAdd.ts:243` | cart and checkout controls; dismiss an overlay |
| `selectOption` | `driveAdd.ts:355` | WooCommerce variations |
| `check` + one `click` | `consentGatePass.ts:128`, `:149` | consent gate (D-267) |
| `fill` + `click` | `auth/login.ts:374-383` | merchant-supplied credentials only (D-039) |
| `page.request.get` | `cart.ts:93`, `:104` | cart JSON |

- **Free text in, reply read back:** none. The only `fill` is the credential login. There is no
  `waitForResponse`, `page.on('response')`, `keyboard` or `press` in `apps/worker/src`.
- **Iframes and shadow DOM:** not traversed. There is no `frameLocator`, `contentFrame`, `frames()`
  or `shadowRoot`. `login.ts:470` filters to `mainFrame()`, and all `extract.ts` reads use the top
  `document`.
- **Written prohibitions next to the code:**
  - `consentGatePass.ts:34-40`: "There is no code path here that types … No text input", and
    "No account creation";
  - `driveAdd.ts:22-26` (D-039): nothing typed, no account created;
  - `flow.ts:8-10` and `page.ts:172`: submits nothing, fills nothing;
  - `extract.ts:562`: sign-up forms are read, not touched;
  - D-039 (`DECISIONS.md:2006`): "Mintro creating its own accounts on merchant sites remains
    blocked".
- **What would be new:** all of it. That means locating a widget, entering its frame or shadow
  root, typing, sending, and capturing and timing the reply. It would also need a rule set
  vocabulary for it: `FLOWS` has two members (`vocabulary.ts:219`) and `SURFACES` has no chat surface.

---

## 5. Lexicon matcher

**NAME-002 is not a `text_match` rule.** It is `type: "url_pattern"`, `layer: 0`,
`scope: "products"`, `patterns: [stack, lean, wolverine, …]` (`rules/ruleset.json:758-786`). Its
whole-token matching lives in the Layer 0 slug matcher, not in `textMatch.ts`. There are two matchers.

### URL slugs: `url_pattern` (NAME-002's matcher)

- `findMatches` (`packages/engine/src/checks/urlPattern.ts:129-145`) tokenises both the pattern and
  the URL with `tokenizePath` (`slug.ts:98-104`). This splits on every non-alphanumeric character
  and at letter/digit boundaries (`splitAlphaNumeric`, `:107-109`).
- It compares contiguous token runs on `inflectionKey` (`containsTokenSequence`, `:214-238`). The
  key is a regular English plural fold that keeps tokens of 3 characters or fewer, and endings in
  `ss/us/is/as/os`, unchanged (`:129-137`, D-159).
- Params are `patterns`, `scope` (one of `all`, `collections`, `products`, `pages`, `content`) and
  `expect` (`params.ts:92-99`). New term lists are data: a new rule with `patterns`.
- It reads only URL paths, never page text. The `products` scope depends on storefront path
  segments (`slug.ts:43`, `:140-185`).

### Page text: `text_match` with `terms`

- `termsFinding` (`textMatch.ts:561-654`).
  - With `expect: absent`, it scopes each hit by sentence through `scopeTerms`. A hit counts as a
    `claim`; hits in a negated sentence (negation cue before the term, `claimScope.ts:203-211`) or
    an attributed sentence are set aside. Only-attributed hits give `not_evaluable`.
  - With `expect: present`, it uses `containsTerm`, a plain `\b…\b` (`textMatch.ts:656-660`).
- `word_boundary: true` switches `termPattern` (`claimScope.ts:183-190`) to `\b…\b` with a closed
  inflection suffix list and silent-`e` elision (D-177). Without it, matching is an unanchored
  substring. Separators within a term (space or hyphen) are flexible either way.
- Params: `terms`, `word_boundary`, `expect`, `surface` and the rest (`params.ts:204-261`). New
  lexicons are data: new rules with `terms` lists.
- Surfaces are limited to those the handler renders: `homepage`, `footer`, `product`,
  `all_sampled`, `terms` and `shipping_policy` (`textMatch.ts:27-34`). Any other surface returns
  `not_evaluable` "not rendered at this layer" (`:41-44`).

### What adding a lexicon without code involves today

- **The term list itself:** a data-only edit in either matcher. A lexicon is a rule's `patterns` or
  `terms` array. Nothing else in `rules/ruleset.json` holds reusable term lists, except
  `sampling.benign_compounds` (`schema.ts:307-320`), which only the sampler reads.
- **Where the words are looked for:** fixed by the closed `SURFACES` and `URL_SCOPES` vocabularies
  and by which pages the crawl renders (item 4b). Character names and tags on a character library
  page are reachable only if that page is one of those rendered surfaces, or its URL slug is in
  scope.
- **One list for several rules:** a term list is per rule. There is no named-lexicon reference
  shared between rules.
- **State on a match:** `tier` alone decides it (`findings.ts:167-169`). `auto_fail` gives `fail`;
  `review_only` gives `review`.
- **Negation scoping:** applies to `expect: absent` page-text rules. For example, a policy sentence
  "no teen characters" is scored `negated`, not `claim`.

---

## 6. Send and retention

### What the send log records

`public.sends`: `0007_sends.sql:9-36`, plus `mailer` (`0017:24-25`) and `report_url` (`0073:16`).

| Column | Meaning |
|---|---|
| `run_id` | The run sent. |
| `to_email` | The recipient address as typed. The default in the modal is `underwriting@iqwallet.com` (`SendModal.tsx:35`). There is no recipient-organisation field. |
| `resend_id` | The provider message ID. Required when `outcome = 'accepted'` (`0007:33-35`). |
| `sent_at` | `timestamptz`, set by the worker at send (`send.ts:270`). |
| `sent_by`, `sent_by_email` | Who sent it. |
| `outcome`, `error` | `accepted` or `rejected`; rejections are recorded too. |
| `attachment_bytes` | 0 since D-255. |
| `report_url` | The captured-report link sent (D-255). |
| `mailer` | `Resend` or a dry-run description. |
| `note`, `note_flagged`, `note_warning_acknowledged` | The covering note, and the D-029 audit of it. |

- `sends` is append-only by trigger (`0007:52-54`).
- The queue row `send_requests` (`0017:34-80`) adds `transmitted` (`0018:19-23`). That records that
  the provider accepted the mail before the `sends` row was written.
- `report_captures` (`0072`) records `storage_key`, `sha256`, `bytes`, `captured_at` and `images`,
  and is append-only by trigger. The comment says this holds "including for the purge path".
- A send links to its capture only through the `sends.report_url` text. There is no foreign key
  from `sends` to `report_captures`.
- `deleteRunCaptures` exists (`reportCaptureStore.ts:159-180`) and deletes capture **objects**, not
  rows. It has no caller outside tests.

**Not recorded anywhere:**

- whether or when a delivered link was opened (the report route writes nothing: `reportRoute.ts`
  and `reportServer.ts` have no inserts);
- any boarding, approval or IQwallet-decision event;
- any vertical.

### "Report delivered to IQWallet before approval"

This cannot be evidenced from existing data. The delivery half is there: an `accepted` `sends` row
with `sent_at`, `resend_id`, `report_url` → `report_captures.sha256`, and `to_email`. The approval
half is not. Searching the migrations for `approv`, `board` and `underwriting_decision` finds only
`package_purge_approvals` (`0036_purge_gate.sql:137-152`), which is unrelated. No table or column
holds an IQwallet approval time. So there is nothing to compare `sent_at` against.

"Delivered to IQWallet" itself rests on the `to_email` string. The send capability gate
`can_submit_to_iqwallet` (`0060_organizations.sql:73-77`; enforced at claim, `worker.ts:1366-1370`) controls who may
send, not where a send went.

---

## 7. Copy audit (shared surfaces, excluding the evaluation layer)

**Scope.**

- **Included:**
  - web components except `EvaluationEditor`, `EvaluationReport` and `EvaluationEvidence`;
  - `App.tsx`;
  - web `lib/` except `evaluation*.ts`;
  - engine copy, state labels, report assembly and check handlers (their notes render verbatim);
  - the worker's send body and scan-progress lines.
- **Excluded:** rule set data (`rules/*.json`, which is per vertical) and the evaluation layer.
- **Matching:** case-insensitive **substring** match on `fail`, `pass`, `blocker`, `clean`,
  `compliant` and `recommend`.
- **Results by term:** `blocker`, `clean` and `compliant` have **no rendered occurrences** in scope.

### Rendered strings

| File:line | Audience | String | Term |
|---|---|---|---|
| `apps/web/src/components/ReportView.tsx:1028` | analyst (print route) | `'No stopping condition was observed failing'` | fail |
| `apps/web/src/components/ReportView.tsx:1029` | analyst (print route) | `` `No stopping condition was observed failing; ${…} could not be checked` `` | fail |
| `apps/web/src/components/ReportView.tsx:1291` | analyst | "This is a failure to read it, not an absence of one. Whether a read was recorded for this run is not known from this page." | fail |
| `apps/web/src/components/ReportView.tsx:1593` | analyst | `` `… reached the most it will render in one pass — not because there was nothing to look at.` `` | pass |
| `apps/web/src/lib/grouping.ts:170` | analyst, merchant (group lede in `ReportView`) | "The request for these did not complete — a timeout or a connection failure. Nothing was established either way, and in particular nothing about the merchant. A re-run may resolve them." | fail |
| `apps/web/src/components/Attestations.tsx:503` | merchant (`AttestationForm`) | "Some of these standards are about what happens away from your website — where you ship, what your support team says, who tests your batches. Mintro has no way to observe those, so they are put to you directly. Your answers are recorded exactly as you write them and passed on with the report, shown as yours." | pass |
| `apps/web/src/components/CommentPane.tsx:872` | merchant | "You can respond to any of them, or none. What you write is recorded exactly as you write it, shown as yours, and passed to the team reviewing your account with the report. Mintro does not edit it, shorten it, or reply to it." | pass |
| `apps/web/src/components/SendModal.tsx:163` | analyst | "Reads as a recommendation" | recommend |
| `packages/engine/src/copy.ts:368` (rendered at `SendModal.tsx:164`) | analyst | `` `This note contains language that reads as a recommendation: ${…}. Findings describe what was observed; the determination is IQwallet's. You can send it as written — the send record will note that this was flagged.` `` | recommend |
| `apps/web/src/components/ResponseRoundPanel.tsx:61` | analyst | "The response round for this run could not be read. This is a failure to read it, not an absence of responses." | fail |
| `apps/web/src/components/PastReports.tsx:115` | analyst | "…This is a failure to read it, not an absence of runs — nothing has been lost, and reloading may be enough." | fail |
| `apps/web/src/App.tsx:1077` | analyst | `` `The scan of ${…} failed. ${…}` `` | fail |
| `apps/web/src/App.tsx:1143` | analyst | "Nothing can be screened or reported against a rule set that failed validation." | fail |
| `apps/web/src/App.tsx:2196` | analyst | "This is a failure to read them, not an absence of them." | fail |
| `apps/web/src/components/CredentialCard.tsx:97` | analyst | `` `Stored login · ${…} · last sign-in failed ${…}` `` | fail |
| `apps/web/src/components/CredentialModal.tsx:172` | analyst | `' and its last sign-in failed'` | fail |
| `apps/worker/src/screen.ts:1030` → `:1073` (finding/escalation sentence) | analyst, capture | `'the login attempt failed'`, inside `` `A screening account is stored for this merchant and it did not sign in on this run (${…}), so it was not used` `` | fail |
| `packages/engine/src/checks/textMatch.ts:238` | finding note (report) | `` ` ${…} value(s) matched the pattern and failed its validity test: ${…}.` `` | fail |
| `packages/engine/src/checks/textCooccurrence.ts:69` | finding note (report) | `` `${…} passage(s) place a quantity term within ${…} tokens of a schedule or route term: ${…}${…}.` `` | pass (substring of *passage*) |
| `apps/worker/src/screen.ts:401` | analyst (progress line) | `` `homepage render FAILED — ${…}` `` | fail |
| `apps/worker/src/screen.ts:769` | analyst (progress line) | `` `layer 3: ${…} fail · ${…} review · ${…} pass · ${…} not evaluable` `` | fail, pass |
| `apps/worker/src/screen.ts:828` | analyst (progress line) | `` `${…} fail · ${…} review · ${…} pass · ${…} not evaluable · ${…} capture(s)` `` | fail, pass |

The two `screen.ts` progress lines are sent through `progress.say` → `progress.write`
(`worker.ts:722-727`) to `scan_requests.progress`, which the web progress line reads
(`requestRows.ts:99`).

**Documents Check** (listed separately; memo §10 lists Documents Check as "reused unchanged"):

| File:line | String | Term |
|---|---|---|
| `apps/web/src/components/DocumentsReportView.tsx:72` | `'Fail'` (finding badge label) | fail |
| `apps/web/src/components/DocumentsReportView.tsx:74` | `'Pass'` (finding badge label) | pass |
| `apps/web/src/components/DocumentsReportView.tsx:186` | `` `${…} failed, ${…} review, ${…} passed, ${…} not evaluated` `` (aria-label) | fail, pass |
| `apps/web/src/components/DocumentsReportView.tsx:196` | `{n} failed` | fail |
| `apps/web/src/components/DocumentsReportView.tsx:204` | `{n} passed` | pass |
| `apps/web/src/components/DocumentsReportView.tsx:212` | "…checks could not be evaluated. Each names why below. A check that could not run has established nothing — it is not a pass." | pass |

### Matched but not rendered (excluded, with reason)

- **State and status identifiers used in comparisons, types or keys:**
  - `'fail'` / `'pass'` / `'failed'` in `format.ts:11`, `grouping.ts:108-129` and `:1194-1486`,
    `findings.ts:167-193`, `layer2.ts:342-415`, `report.ts:798-1177`, `stateLabel.ts:65`,
    `commentary.ts:200`, `EvidenceSlip.tsx:74`, and `ReportView.tsx:950`, `:952`, `:1148`, `:1321`,
    `:1724`, `:1868`;
  - queue-status checks in `SendModal.tsx:97`, `DocumentsSendModal.tsx:76`, `InviteModal.tsx:90`,
    `CredentialCard.tsx:70`, `:98`, `:197`, `App.tsx:1075`, and the `*Queue.ts` / `requestRows.ts` /
    `packages.ts` / `retention.ts` literals.
- **CSS class names:** `ReportView.tsx:1048` and `:1055` (`stop-failed*`), `:1946-1957` (`passes*`,
  `${…}-pass`).
- **Audit vocabularies**, which are lists of forbidden terms and not copy: `copy.ts:26-43`, `:139`,
  `:190-200`, `:291-330`.
- **A thrown error:** `report.ts:852`.
- **A PostgREST select string:** `runs.ts:209` (`placement->>recommended`).
- **Worker console logs:** `worker.ts`.
- **"password" and related strings (sign-in and credential forms):** `SignIn.tsx`,
  `SetPassword.tsx`, `CredentialModal.tsx:136-143`, `DocumentsPane.tsx:79` (`'Password protected'`),
  `credentials.ts:61`, `signupForm.ts:46-174`, `analystInvite.ts:81`. These contain `pass` only as
  part of *password*. They are rendered but are not verdict vocabulary.

### Adjacent, outside the six terms

Noted because A1 and A7 name the categories, not only the words. They are not part of the audit
count.

- `STATE_LABEL`: *Met* / *Not met* / *Unclear* / *Not observed* (`stateLabel.ts:41-46`).
- `REPORT_POSTURE`: "…surface things early, while there's time to address them, before the
  underwriting team makes its boarding decision." (`copy.ts:649-652`, rendered by `ReportView`).
- `ReportView.tsx:1031-1032`: "One stopping condition applies" / `` `${…} stopping conditions apply` ``.

---

## Open items carried forward

- **Evaluation-layer jobs load the peptide rule set unconditionally (cluster 4).**
  `apps/worker/src/evaluationRun.ts`, `apps/worker/src/evaluationPublishJob.ts` and
  `apps/worker/bin/evaluate.ts` read
  `rules/ruleset.json` whatever the run's vertical. When the send and capture gates learn vertical,
  these jobs must refuse an `adult_ai` run with a reason rather than evaluate it against the peptide
  rule set. Recorded 2026-09-18, after cluster 1 commit 2. **Happened before it was closed:** run
  6571d6a9 (adult_ai, xchar.ai) was drafted through the evaluation layer on 2026-09-19 (one
  `evaluation_drafts` row, validator status `rejected`; no published evaluation, capture or send).
  **Resolved in cluster 4 commit 1:** every evaluation job refuses a non-peptide run with the reason
  "evaluation layer does not apply to vertical adult_ai (D-284)", and the web renders no evaluation UI
  for one.
- **The terms-page selection reads one page and can pick the wrong one (cluster 2).** The `terms`
  surface is chosen by the slugs `policy`, `policies` and `terms` (`SURFACE_SLUGS`,
  `apps/worker/src/evaluationPages.ts`), so a merchant linking a "Content Removal Policy" can have that
  page read as its terms, and a merchant whose rules live at `/guidelines` (xchar.ai) has them not
  read at all. Cluster 2 needs a page-type list for this vertical: terms;
  guidelines / community-guidelines / content-policy / acceptable-use; removal / complaints; pricing;
  create; generate; docs. The AIPOL rules then read terms plus guidelines, and the AITD rules read the
  footer plus the removal page. Recorded 2026-09-18, after cluster 1 commit 2a.
- **`text_match` takes one surface, and `params.note` renders nowhere (cluster 2).** AIGATE-003 stays a
  homepage stand-in, with its limits stated only in a note no reader sees, until a multi-surface
  handler exists. Recorded 2026-09-18, after cluster 1 commit 2a. **Update, cluster 2 commit 1:** the
  multi-surface handler exists (`checkTextMatchAcross`), and AIGATE-003 reads the homepage and the terms
  document. `params.note` still renders nowhere.
- **The peptide about and editorial surfaces can never be established (peptide, found in cluster 2).**
  `findDocument` in `apps/worker/src/signup.ts` builds its `SurfaceSpec` with `pathNames` taken from
  `linkHints`, and `establishDocument` refuses any page whose path contains none of them
  (`pathNamesSurface`, `packages/engine/src/surface.ts:173-181`). The about page and editorial surfaces
  declare `linkHints: []`, so `pathNames` is empty and `pathNamesSurface` returns false for every
  candidate: each is rendered and then refused with "does not name this surface in its path". Checked
  by calling `pathNamesSurface` with an empty list; not checked against a stored run. Left unchanged
  in cluster 2, which keeps peptide behaviour byte-identical; the adult page types pass their table's
  slugs as `pathNames` and are not affected. Recorded 2026-09-18.

  **Carried to the tabled peptide pass (Frank, 2026-09-18); not fixed in the adult clusters.** Blast
  radius, for that pass: the about page and editorial pages reach the rules as `alsoRead` in
  `runLayer2` (`packages/engine/src/layer2.ts:210`), so with neither ever established these rules
  have read no about or editorial page on any run:
    - designed to read them (`surface: all_sampled`, D-271, D-274): DISC-003, DISC-004, PROD-006,
      PROD-007, PROD-008, PROD-010, PROD-011, PROD-012, PROD-013, PROD-014, PROD-016, PROD-017;
    - receiving them through the same call at `layer2.ts:210` (per-page Layer 2 rules): PROD-001,
      PROD-002, PROD-003, PROD-004, PROD-005, PROD-009, NAME-003, CATG-005, CATG-006, COA-001,
      OFFS-002.
  Also affected: the eye test's about and editorial captures (`eyeTestManifest`), and the about and
  editorial pages the evaluation draft is given.
