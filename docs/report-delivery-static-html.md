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

Seven pieces. Commit them separately and stop for review between each.

### 1. Storage

New Supabase storage bucket for rendered reports. Public-read, unguessable path.

- Path: `reports/<runId>/<token>.html` where `token` is 32 bytes of CSRNG, base64url.
- Content type `text/html; charset=utf-8`.
- No expiry. Retention follows the existing run retention posture: long-term, purge only on
  operator approval after export verification.
- `<meta name="robots" content="noindex">` in the captured document itself. **This is the primary
  control and it is required unconditionally.** For an HTML document the meta tag is the mechanism,
  not a fallback for one: it travels with the bytes, so it holds if the file is ever served from
  somewhere other than where it was written — copied to another bucket, handed to an underwriter's
  own store, opened from a mirror.

  `X-Robots-Tag: noindex, nofollow` is set at the serving layer **where the serving layer can set
  it**, as defence in depth. It is not the gate of record, and the original spec was wrong to call
  it that. Supabase storage cannot attach it to an object at all: `FileOptions.headers` merges into
  the request headers of the upload, and user metadata is readable through `info()` but never
  emitted on a GET. The rewrite in step 3 is where the header is available.
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
- **Evidence captures need a ruling from you, CC.** Report back before implementing: are the
  evidence images already stored as immutable objects under the run's own retention, with stable
  URLs? If yes, reference them and note the dependency in the decision record. If they are served
  from anything that regenerates, resizes, or expires, inline them as data URIs and accept the
  file size. Do not guess. A frozen HTML file pointing at assets that can move is not frozen.
- No relative URLs of any kind in the output.

**Fail loud.** If capture fails, the job fails and the report is not delivered. Do not write a
partial file, do not fall back to a link that 404s, do not send an email pointing at nothing.
Silent failure rendering as an empty state instead of an error is a recurring pattern here
(D-036, D-200, D-213). Assert on the failure path, not just the happy one.

### 3. Netlify fronting

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
storage object and the delivered link — read back to the same run. The tripwire in step 6 fetches
through this origin, because that is the URL that was actually delivered.

The link itself is composed in the worker for the email in step 4 and stated in `netlify.toml`
here. That is a URL shape in two places, which is what D-034 is about — give `/r/` one owner in
`reportCapture.ts` when this step lands, rather than spelling it out on both sides.

### 4. Email bodies

Attachment comes out, link goes in, in every path that currently sends a report.

`apps/worker/src/invite.ts` composes `body` as an array joined with `\n`. The last pass through
this file shifted every index after the edit and had to renumber. Expect the same. Check
`apps/worker/test/inviteJob.test.ts`, which asserts on the composed body.

Copy: state that the report is a link and that the link does not expire. Do not editorialize about
the format change. Operator identity enforcement is unchanged and already correct at the payload
level (D-233) — the link and the surrounding copy carry no operator identity.

### 5. Tests

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

### 6. Storage-drift tripwire

CI, not the validator. Fetch a captured report from a completed run and assert it still parses and
still contains no external references. This is the check that catches an asset pipeline change
reaching backwards into old reports. It belongs in CI because it needs network and because a
validator that requires touching the engine to add a rule violates hard constraint 1.

### 7. Decision record

Write D-239 as above. Note the evidence-image ruling from step 2 once CC reports back — that
dependency is load-bearing and belongs in the record rather than in a code comment.

---

## Order of work

1. Bucket, path scheme, token generation. Commit, review. **Done 2026-09-03.**
2. CC reports on evidence image storage. Ruling before implementation.
3. Capture step in the worker, replacing `page.pdf()`. Commit, review.
4. Netlify fronting: the `/r/*` rewrite and the header. Commit, review.
5. Email bodies and index renumbering. Commit, review.
6. Tests and CI tripwire. Commit, review.
7. Decision record.

The fronting lands before the email change because the email is the first thing that states a URL
to anyone outside the system. An email shipped ahead of the rewrite would carry links that 404 —
and this is the one artifact whose links are meant to work in five years.

## Outside the code

When the first link goes to IQwallet, a line to Stefan: the report arrives as a URL now, and the
link does not expire. The format was never specified so this needs no approval, but he should not
have to wonder where the attachment went.
