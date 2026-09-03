---
purpose: Decision record and implementation spec for replacing the report PDF with an immutable static HTML capture delivered as a link. Read before touching report delivery, the worker's render step, or outbound email bodies.
status: specced 2026-09-03; step 1 (bucket, path scheme, token) landed 2026-09-03
---

# Report delivery — static HTML replaces the PDF

## Decision record

**D-255 — the report handoff artifact is an immutable HTML capture, delivered as a link.**

Confirmed against `docs/DECISIONS.md` on 2026-09-03. This was specced as D-239, which is taken —
it is the access-log record. The highest record is D-254, so D-255 is the number. Do not cite it
in code until the record exists.

### Decision

The report is rendered once at assembly, captured as a self-contained HTML file, written to
storage as an immutable object, and delivered as a URL. No PDF is generated. No file is attached
to any outbound email.

### Why the PDF goes

The artifact format was never specified by IQwallet. Mintro has no contractual relationship with
the sponsoring bank and is not responsible for producing anything a bank consumes. IQwallet does
its own underwriting and produces its own documents. The screener's obligation ends at showing
IQwallet that the screening was performed and what it observed. A link discharges that as well as
an attachment does, and delivers better: no attachment size, no deliverability drag, no version
of the file sitting in an inbox detached from the run that produced it.

### Why a captured file and not a live route

This is the part that matters and it is not obvious.

Run data is immutable (D-002) and clauses snapshot onto findings at assembly, so the report's
*content* is already frozen. The *render* is not. Section headings live in `packages/engine/src/copy.ts`
as constants, report components change, and the ruleset has already been re-based once (D-139).
A live route at `/report/:token` serves whatever bundle is deployed the day it is opened. A run
from today, reopened next spring, is a different document at the same URL, and nothing in the
system announces that it changed.

The report is a dated record of a commercially reasonable effort. Its whole value is that it says
the same thing later that it said when it was sent. Frozen bytes preserve that; a live route does
not. The capture costs one extra step in a pipeline that is already rendering the page.

### Scope

- Capture happens at **report assembly**, not at IQwallet send. Blocked packages go to the agent
  only with no IQwallet send and no comment link; that path gets a link to the same captured
  report. Delivery differs by path, the artifact does not.
- The merchant **comment pane stays a live route**. It takes input. It cannot be a static capture
  and this decision does not touch it.
- **No back-fill.** Runs that already produced a PDF keep it. Append-only, per D-002. Nothing is
  regenerated.

---

## Implementation spec

Eight pieces. Commit them separately and stop for review between each.

### 1. Storage

New Supabase storage bucket for rendered reports. Public-read, unguessable path.

- Path: `reports/<runId>/<token>.html` where `token` is 32 bytes of CSRNG, base64url.
- Content type `text/html; charset=utf-8`.
- No expiry, and nothing sets a lifecycle rule on the bucket.

  This was specced as *"retention follows the existing run retention posture"*. **There is no run
  retention posture.** D-130's clock, approval gate and purge are package-scoped, over the documents
  bucket; nothing in the repository deletes from the evidence bucket, and D-130 rules explicitly that
  run history stays in the database indefinitely. Captured reports therefore inherit what runs
  already have, which is indefinite retention — the same position the emailed PDF was always in.
  Step 3 records what that does and does not oblige.
- `<meta name="robots" content="noindex">` in the captured document itself. **This is the primary
  control and it is required unconditionally.** For an HTML document the meta tag is the mechanism,
  not a fallback for one: it travels with the bytes, so it holds if the file is ever served from
  somewhere other than where it was written — copied to another bucket, handed to an underwriter's
  own store, opened from a mirror.

  `X-Robots-Tag: noindex, nofollow` is set at the serving layer **where the serving layer can set
  it**, as defence in depth. It is not the gate of record, and the original spec was wrong to call
  it that. Supabase storage cannot attach it to an object at all: `FileOptions.headers` merges into
  the request headers of the upload, and user metadata is readable through `info()` but never
  emitted on a GET. The rewrite in step 4 is where the header is available.
- Bucket is not listable.
- **`allowed_mime_types` and `file_size_limit` are deliberately not set on the bucket yet.**
  Constraining a public bucket to `text/html` is worth having — it is what stops anything else
  being served from a Mintro-controlled public origin. It is omitted here because the upload writes
  `text/html; charset=utf-8` and whether Supabase matches that against a base type or the full
  header could not be checked without a live project. Guessing wrong fails every capture upload.
  Both are added during the capture step (step 2), where a real upload can prove the behaviour.

#### The delivered URL

The link that goes out is **`https://screener.gomintro.com/r/<runId>/<token>`**, fronted by a
Netlify 200-rewrite to the bucket's public storage URL. The storage URL is where the object lives;
it is not what anyone is sent.

The reason is indirection, not the header. Two things follow from it and both are the point:

- **The storage backend can change without invalidating a link already issued.** A link with no
  expiry is a promise measured in years, and it is the only promise this decision rests on. A URL
  naming the storage vendor makes moving vendors — or buckets, or regions — an act that breaks
  every report already in an underwriter's inbox.
- **An underwriting partner is not sent a URL exposing the Supabase project ref.** The project ref
  is the public identifier of the whole database, and there is no reason for it to travel in a
  document handed to a third party.

The header falls out of this for free, which is how it should be read: a consequence of the
indirection, not the justification for it.

**The report token is not the comment token.** Different audiences, different surfaces. The
comment link goes to the merchant; the report link goes to IQwallet and the agent. Deriving one
from the other, or reusing one for both, puts the IQwallet-facing report one guess away from a
merchant who has a comment link. Generate them independently and assert in test that a run's two
tokens are unequal.

### 2. Capture in the worker

Replace the `page.pdf()` call at report assembly with an HTML capture from the same Playwright
page at the same moment. Nothing about when the page is rendered changes.

The captured file must be **self-contained**. It renders correctly with no network access, forever.
Concretely:

- CSS inlined into a `<style>` block. No `<link rel="stylesheet">`.
- No `<script>` tags. Strip them. A report that executes anything is a report whose output depends
  on the day it is opened, which is the thing this decision exists to prevent.
- Fonts: either inlined as data URIs or dropped to a system font stack. Decide by file size and
  report which you chose. A report that silently loses its typeface in 2029 because a CDN moved is
  the same failure in a smaller costume.
- **Evidence captures: inlined as data URIs, full fidelity, no re-encoding.** Ruled 2026-09-03.

  The objects themselves are as stable as they could be — keys are `<run_id>/<layer>/<sha256>`, so
  the key is the hash of the bytes; they are append-only; nothing anywhere passes Supabase's
  `transform` option, so nothing resizes or regenerates on read. What disqualifies referencing them
  is **delivery**: the report reaches its captures through `signEvidenceUrl(…, 300)`, a
  five-minute signed URL minted per render. A frozen file holding those is dead in five minutes,
  and the only way to a stable URL would be a public evidence bucket, which 0008 refuses by raised
  exception.

  Inlining happens **in Node, against the fetched bytes** — never inside the Playwright page, which
  would hold the whole document in browser memory during capture.

  Measured on the five stored storefront reports: 1–9 cited captures each, 0.1–10.5 MB raw,
  0.2–14.4 MB once base64 inflates them by a third. Across all 83 stored runs, mean 9.7 captures at
  7.9 MB, largest single capture 3.8 MB.

  Rejected: copying the cited captures into the reports bucket and referencing those. It is cheaper
  on every axis and it trades away the self-contained property this decision exists to create.
- **A 40 MB ceiling on the captured file, asserted at capture.** Exceeding it **fails the job**. It
  does not warn and proceed, and it does not write a truncated file. The measurements above put a
  realistic report at 8–15 MB, so this is headroom rather than a routine bound — but the 25-page
  render cap does not by itself hold the file under 30 MB, and a report that grows without a
  ceiling is one that eventually cannot be opened on a phone by the person it was sent to. A
  ceiling that is only logged is not a ceiling.
- **No footer.** Ruled 2026-09-03. The PDF stamped *"Mintro screening report · domain · Page N of
  M"* through Chromium's paged-media footer; a document with no pages has no equivalent, and
  nothing replaces it. The masthead already carries the domain and the date, and a footer repeating
  them is redundant.
- **The masthead states what the report is.** `REPORT_POSTURE`, rendered in `.rhead` under the
  domain, and `assertCapturable` refuses any document that does not contain it.

  This is here rather than in the covering email because **a link is forwardable**. The PDF arrived
  attached to an email that framed it; a URL passed from IQwallet to someone at the sponsoring bank
  arrives with nothing. Anything that lives only in `send.ts` does not travel with the document,
  and this sentence is the only thing in the report that tells a stranger who Mintro is.

  It is not `POSTURE` in `apps/web/src/lib/homeShape.ts`, and the two are **not consolidated**.
  That one is a signed-in screen for a partner with no runs yet; this one leaves the building. Two
  audiences, two strings.
- No relative URLs of any kind in the output.
- **The 23 `@media print` blocks are hoisted to unconditional CSS, in place.** They are not
  decoration — they hide the analyst rail and the nav cards, expand the category bodies and show
  the masthead — and they do not apply when a saved file is opened on screen. In place rather than
  appended, because a media query adds no specificity and the cascade decides ties by document
  order: moving them would hand each print rule a win over an equal-specificity screen rule it
  currently loses to, silently, in a document nobody re-renders to compare.

#### Open observation — an unresolved capture is omitted, not declared

`@media print{.shot:has(.shot-missing){display:none}}` hides a slip whose capture could not be
read. Hoisted, the captured document does the same. **This is unchanged behaviour** — it is what
the PDF has always done — so preserving it is not a decision and changing it would be.

Recorded because it sits against the principle that runs the rest of this system: an unrendered
page is *declared* rather than passed over, and a `not_evaluable` finding has to evidence why. An
omission is not a synthesis, so hard constraint 3 is not breached — nothing asserts a capture that
does not exist. But a reader cannot tell the difference between a finding that cited no capture and
one whose capture went missing, and that is a distinction this system makes everywhere else.

Ruled separately. It is a report-copy and report-rendering question, not a capture question, and
the capture step is the wrong place to change what the document says.

**Fail loud.** If capture fails, the job fails and the report is not delivered. Do not write a
partial file, do not fall back to a link that 404s, do not send an email pointing at nothing.
Silent failure rendering as an empty state instead of an error is a recurring pattern here
(D-036, D-200, D-213). Assert on the failure path, not just the happy one.

### 3. Purge coverage — the half that is a task, and the half that is not

**The rule, ruled 2026-09-03: any purge that destroys a run's evidence must also destroy that run's
captured reports, and an operator approving it must see both buckets and both counts stated rather
than infer them.** Inlined captures are full-resolution merchant screenshots living in a
**public-read** bucket. A purge that reports a run's evidence destroyed while complete copies of it
sit behind a link that never expires would make the retention posture false.

The obligation splits cleanly, and the two halves are not the same kind of work.

#### The correction this step rests on

An earlier session reported that the existing purge removes a run's evidence, and that inlining
would therefore falsify a working mechanism. **That was wrong.** Checked against the code:

- `purgePlanJob` is wired to `DOCUMENTS_BUCKET`, not to evidence (`apps/worker/bin/worker.ts`).
- `purgeExecutor` reconciles a **package** prefix, derived from a `package_purge_approvals` row.
  `packages` references `merchants` and carries no run id. Nothing in the chain is run-scoped.
- The only storage deletions in the repository are that purge, over the documents bucket, and the
  export job and its sweep, over export staging. **Nothing anywhere deletes from the evidence
  bucket**, which is what 0008 says in as many words and what hard constraint 5 requires.
- D-130 is package retention, 180 days from `retention_started_at`. It rules that *run history stays
  in the database indefinitely*. It does not create a run purge and does not gesture at one.

So nothing is falsified today, because there is no run purge to falsify. There was an ordering
ruling here — purge coverage before inlining — and it was made on the assumption that a mechanism
existed to extend. It is withdrawn. **The capture step does not block on any of this.**

#### The reports half: a task, and it ships with the capture step

Everything under `reports/<runId>/` belongs to that run **by construction** — the path scheme says
so, and nothing else may write there. So this half needs no reconciliation model, no approval gate
and no intent ledger: it is a prefix delete. That is unlike the documents bucket, where the whole
point of reconciling is that staged copies appear in no column and a purge driven from the columns
would leave them.

A run-scoped delete for captured reports is built **alongside the capture step**, not before it.
Building it with the thing it deletes is what keeps the two in step; building it first would be
writing a delete for a path shape nothing has written to yet.

It is not wired to any queue and it deletes nothing on its own — same posture as `executePurge`,
which exists and runs when a person decides it does. The point is that the reports half is
**correct and in place on the day a run purge is built**, so whoever builds the hard half finds this
one already done rather than discovering it as a gap.

#### The evidence half: an open question, not in scope here

Run-scoped evidence purge **does not exist**. Building it needs an approval model, a retention clock
over runs and a reconciliation model, and it needs rulings this document has no business inventing:
who may approve a run purge, what starts the clock, and whether export-before-purge applies to runs
as it does to packages.

That question predates this work and is not created by it. **It is Frank's to rule on separately,
and this document does not block on it.**

#### What is true today, stated plainly

**A captured report is retained indefinitely. No mechanism in this system destroys it.** Neither
does one destroy a run's evidence, and neither did one destroy the emailed PDF — a report that has
been sent has always been a permanent artifact here, and D-130 says run history stays indefinitely
in as many words. This decision does not change that position. It changes the artifact's format and
where it is addressed from.

### 4. Netlify fronting

The delivered link is on a Mintro origin. Nothing outside this repo is sent a storage URL.

A 200-rewrite in `netlify.toml`, from `/r/*` to the bucket's public object URL, plus a `[[headers]]`
block setting `X-Robots-Tag: noindex, nofollow` on the same path. `/r/` sits above the SPA catch-all
rewrite — the existing `from = "/*" to = "/index.html"` would otherwise swallow it and serve the
analyst app in its place.

**This is an indirection layer, not a header hack.** The header is a by-product; the reason the
layer exists is that a link with no expiry has to outlive decisions about where bytes are kept, and
that a third party should not be handed the Supabase project ref. Read `#### The delivered URL` in
step 1 before changing anything here — a later edit that "simplifies" this into a direct storage
link would break both properties silently, because the link would still work on the day it was
changed.

Two things this must not become:

- **Not a redirect.** A 301 or 302 hands the storage URL to the browser, which puts it in the
  address bar and in the reader's history — the project ref is disclosed anyway and the
  indirection buys nothing. Status 200, proxied.
- **Not a rendering path.** Netlify serves the captured bytes and does not touch them. Nothing
  here injects, rewrites or templates anything into a document whose whole value is that it has
  not changed since it was written.

`reportCaptureRefFrom` in `packages/engine/src/reportCapture.ts` matches on the path tail rather
than on a hostname and treats the `.html` as optional, so both spellings of one capture — the
storage object and the delivered link — read back to the same run. The tripwire in step 7 fetches
through this origin, because that is the URL that was actually delivered.

#### `/r/` has one owner, and `netlify.toml` is not it

`REPORT_LINK_PATH` in `packages/engine/src/reportCapture.ts`. Nothing else spells it.

`apps/web/netlifyReportProxy.ts` is a Vite plugin that emits `_redirects` and `_headers` into the
build from that constant, so the config is *generated* rather than kept in agreement by a test.
`netlify.toml` declares no redirects at all, and a test asserts it never names the report path.

This also solves a problem the original plan did not see: the Supabase project ref is not in this
repository — every reference in `docs/DEPLOY.md` and `.env.example` is a `<project>` placeholder.
Generating from the build environment means the ref is never committed and a branch deploy does not
proxy production storage. A Netlify build with no `VITE_SUPABASE_URL` **fails**; a local build
omits the rule without failing, because there is no Netlify layer to configure and
`bundledControls.test.ts` runs a real `vite build` with no environment.

The SPA fallback moved into the same generated file. See the catch-all trap in step 6 — this is
not tidiness, it is the only way the order between the two rules is visible and testable.

#### Verify once, against the deployed site

Whether Netlify applies `_headers` to **proxied** 200-rewrite responses is not something a local
build can answer, and it is not worth asserting from memory. It does not block: the ruling makes
the `<meta name="robots">` in the captured document the primary control, so the noindex
requirement is met by the bytes whether or not the header applies.

Check it once, after the first deploy, against a real captured report:

```
curl -I https://screener.gomintro.com/r/<runId>/<token>
```

Expected: `200`, `content-type: text/html; charset=utf-8`, and — if proxied responses carry them —
`x-robots-tag: noindex, nofollow`. A `404` means the rewrite is not live or the object key does not
match; anything that returns the analyst app means a redirect rule is matching first.

**Do not land the step-3 download change until this returns a real report.** Until the rewrite is
deployed, every `/r/` link in the app is dead, and an analyst clicking a dead link is a dead link.

### 5. Email bodies

Attachment comes out, link goes in, in every path that currently sends a report.

`apps/worker/src/invite.ts` composes `body` as an array joined with `\n`. The last pass through
this file shifted every index after the edit and had to renumber. Expect the same. Check
`apps/worker/test/inviteJob.test.ts`, which asserts on the composed body.

Copy: state that the report is a link and that the link does not expire. Do not editorialize about
the format change. Operator identity enforcement is unchanged and already correct at the payload
level (D-233) — the link and the surrounding copy carry no operator identity.

### 6. Tests

The useful assertions here are about the captured bytes, not the render path.

- Captured file contains no `<script>`, no `<link rel="stylesheet">`, no relative URL.
- Captured file contains the `noindex` meta tag.
- Report token and comment token for the same run are unequal.
- Capture failure fails the job. Make it fail in the specific way it exists to catch: force the
  capture to return empty and assert the job errors and no email is sent. A capture guard that
  has never been made to fire is not a guard.
- Email body contains the report URL and no attachment.
- No test asserts the captured HTML equals a current render. That is the D-002 trap the fixture
  work already hit: comparing a snapshot to live output asserts something the system says is false.

#### Five findings from building this, all worth keeping

**A guard can pass for the wrong reason, and then it guards nothing.** The count assertion — the
file inlines as many images as the page displayed — was first tested by leaving a marker
unsubstituted. It went green. It was never running: an unsubstituted marker is `src="#mintro-capture-1"`,
which the *reference* check rejects first, because a `src` that is not a `data:` URI is a request
the file would make. The count guard had never once executed, and it would have stayed green
forever while asserting nothing, because the case that reaches it — every image properly inline
and one simply absent — is not the case anyone naturally reaches for.

It now has its own test: a document that is perfect in every other respect and one capture short.
Both cases are kept, because both are real failures and they fail differently.

This is the whole of the verification discipline in one example. The pass was not evidence; the
question *which assertion actually fired* was. A test made to fail before it is trusted is the only
kind that has been checked, and it applies to the guards in this document as much as to the checks
in the engine — `not_evaluable` exists because a check that cannot see must not report as one that
looked.

**A fixture written from the code's own model inherits the code's blind spot.** The capture step
inlined only images that appeared in the injected evidence map. The masthead's Mintro lockup is not
in that map — it is an app asset — so it serialized as `src="/brand/mintro-lockup-full.png"`, a
relative URL in a document served from a storage bucket. The assertions refused it on two counts,
which means **every capture would have failed**, on every run, from the first one.

Nothing in the suite caught it, and the reason is the part worth keeping. The test documents were
written by hand from the same understanding of the page that produced the bug: I knew the report
displayed evidence images, so the fixtures contained evidence images. The lockup was invisible in
both places at once. A guard can therefore fire on **everything in production and nothing in the
suite** — the exact inverse of the count guard above, and the same root cause, which is that the
test and the code share an author and therefore share a model.

The general form: **a fixture derived from your own reading of the code tests your reading, not the
code.** The correction is to take the fixture from the artifact rather than from the model —
`apps/worker/test/fixtures/print-dom.html` is now the print route's real shape, brand lockup and
`<noscript>` and module script and all, and the lockup case has a test that fails without the fix.
This is the same discipline as saved storefront HTML in the check fixtures, applied one layer up.

**The browser entry caught the import.** `browserEntry.test.ts` and `bundledControls.test.ts`
failed the moment the app imported `reportLinkForKey`: `@mintro/engine` resolves to `browser.ts` in
the browser, and the symbol had only been exported from `index.ts`. Typecheck and every worker test
passed. Nothing else in the suite would have found it before the bundle broke at build time.

**A build that depended on a build step nobody declared.** `vite.config.ts` imports
`netlifyReportProxy.ts`, which imports `@mintro/engine`. Vite pre-bundles its own config with
esbuild **before** any of the config's settings apply, so `resolve.alias` — which points the engine
at `src/browser.ts` for the app bundle — does not govern that line. It falls through to ordinary
package resolution, and the engine's `exports` names one entry, `./dist/src/index.js`. On a clean
checkout there is no dist, and the build dies with *"Failed to resolve entry for package
@mintro/engine"* before `VITE_SUPABASE_URL` is ever read.

Every check that could have caught it ran somewhere the prerequisite was already satisfied. My
local build had a dist from an earlier `tsc --build`. **And so did CI, by accident**:
`bundledControls.test.ts` shells out to `vite build`, and it passed only because `npm run check`
typechecks before it tests, and `tsc --build` leaves the engine compiled as a side effect. Nothing
declared the dependency; two independent environments inherited it and both reported success.
Netlify starts clean, and the first real deploy failed.

The fix declares it in both places, because the two invoke the build differently:
`apps/web`'s script is now `tsc --build ../../packages/engine && vite build`, and the test runs the
same `tsc --build` before shelling out — it calls the binary rather than the script, deliberately,
so the script's line does not reach it. Verified by deleting every `dist/` and running each from
that state, rather than by a build in a tree that already worked.

**And then the same finding again, one layer down.** The fix above was `tsc --build
../../packages/engine && vite build`, and Netlify failed on it with `exit 127 — tsc: command not
found`. The reasoning had been *"typescript is a root devDependency and workspaces hoist it, the
way vite and react resolve"* — true of **module resolution**, and silent about **shell PATH**. They
are different mechanisms and the second was never checked.

`typescript` was declared only at the repository root. Netlify installs what `apps/web` declares:
`vite` is its devDependency and resolved; `tsc` was not and did not. The fix is to declare
`typescript` in `apps/web`, where the binary is invoked. That also covers the pre-existing
`typecheck` script, which has called bare `tsc` since it was written and had the same latent defect
— it simply never ran anywhere that would expose it.

Note what made this hard to see twice: `node_modules/.bin` in this repository holds `tsc` and
`vite` side by side, both hoisted, so a local `npm run build` cannot distinguish a root
devDependency from a declared one. **The tree could not answer the question, and it returned a
confident answer anyway.**

The guard is `apps/web/test/buildPrerequisites.test.ts`, and it deliberately reads `package.json`
and nothing else: for every script, the command it invokes must be a `bin` exported by a package
`apps/web` itself declares. No environment can answer that favourably by accident, which is the
whole requirement. It was made to fail before it was trusted — removing the declaration fails three
of its six assertions with a message naming the fix.

The verification of the fix itself was built the same way. A harness derives the binaries an
apps/web-scoped install would provide from that manifest, puts only those on PATH, and runs the
real build script: without the declaration, `exit 127, tsc: command not found`, Netlify's error
exactly; with it, the build succeeds. The harness needed two corrections of its own on the way —
it first passed a Windows-style `C:\...` PATH that `sh` reads none of, so *every* binary was
missing and it "reproduced" the failure for the wrong reason. A harness can have the defect it is
testing for.

The general form, and it is the widest of the five: **the fixture problem is not limited to
fixtures. An environment can be a fixture.** When the thing under test is a build, the environment
it runs in is an input — and an input inherited from previous work is one nobody chose. A tree that
already satisfies a prerequisite cannot tell you whether the prerequisite is met; it can only tell
you that it was met this time. State the prerequisite in the command, and verify from the state a
stranger would start in.

**A catch-all above the report rule would have served the wrong document, successfully.** Netlify
evaluates `netlify.toml` redirects **before** `_redirects`, and first match wins. The existing SPA
fallback — `/*  →  /index.html`, status 200 — sat in `netlify.toml`, so a `/r/*` proxy added to
`_redirects` would never have fired. Every delivered report link would have matched the catch-all
and served the analyst application.

The reason this one is worth remembering is the shape of the failure, not the mechanics. **It would
have resolved.** 200, a page renders, no error anywhere — an underwriter opening a screening report
gets a sign-in screen or an empty app shell, and nothing in Mintro records that the link did
anything other than work. It is the same class as a `pass` from a check that could not see: the
output is indistinguishable from success, so nothing downstream can catch it.

Both rules therefore live in one generated file, in one order, with a test asserting the report
rule precedes the fallback. The general form: **when adding a route, ask what already matches it**
— a catch-all is not a default, it is a rule that matches everything, and where it sits decides
whether anything below it exists.

### 7. Storage-drift tripwire

CI, not the validator. Fetch a captured report from a completed run and assert it still parses and
still contains no external references. This is the check that catches an asset pipeline change
reaching backwards into old reports. It belongs in CI because it needs network and because a
validator that requires touching the engine to add a rule violates hard constraint 1.

### 8. Decision record

Write D-255 as above. Three things belong in the record rather than in a code comment, because each
is a dependency someone reading the code six months out would otherwise have to rediscover:

- **The evidence-image ruling** (step 2): inlined, because the captures are reached by five-minute
  signed URLs and the only stable-URL alternative is a public evidence bucket.
- **What retention actually is** (steps 1 and 3): a captured report is retained indefinitely and no
  mechanism destroys it — the same position the emailed PDF was in. Run-scoped evidence purge is an
  open question ruled elsewhere, and this decision neither creates it nor waits on it.
- **Why the delivered URL is not the storage URL** (step 1): indirection, so storage can move
  without invalidating issued links and no partner is handed the project ref.

---

## Order of work

1. Bucket, path scheme, token generation. Commit, review. **Done 2026-09-03.**
2. CC reports on evidence image storage. Ruling before implementation. **Done 2026-09-03: inline.**
3. Capture step in the worker, replacing `page.pdf()` — **with the run-scoped delete for captured
   reports (step 3's reports half) in the same commit.** Commit, review.
4. Netlify fronting: the `/r/*` rewrite and the header. Commit, review.
5. Email bodies and index renumbering. Commit, review.
6. Tests and CI tripwire. Commit, review.
7. Decision record.

Run-scoped **evidence** purge is not on this list. It does not exist, it is not created by this
work, and it is ruled separately — see step 3.

One ordering here is load-bearing. **The fronting precedes the email change**, because the email is
the first thing that states a URL to anyone outside the system. An email shipped ahead of the
rewrite would carry links that 404 — and this is the one artifact whose links are meant to work in
five years.

## Outside the code

When the first link goes to IQwallet, a line to Stefan: the report arrives as a URL now, and the
link does not expire. The format was never specified so this needs no approval, but he should not
have to wonder where the attachment went.
