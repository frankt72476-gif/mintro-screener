---
purpose: The eye test — a judgment layer over what a storefront looks like, written by the model from the captures the crawl already takes. Read before building or calibrating it.
status: agreed 2026-08-30, for build
---

# The eye test

Eleven dimensions of soft judgment about how a storefront presents itself, produced on every run,
rendered above the findings and below the stopping conditions.

**It is not a rule and it is not a finding.** The 59 rules describe what was observed. The eye test
describes how the storefront reads. It is labelled as Mintro's impression everywhere it appears,
and it never changes a state, a count, or a stopping condition.

IQwallet has nothing published — their intake judgment is "mostly art". The rubric is Mintro-authored
and calibrates against real packages.

---

## 1 — It reads the captures, not the text

The rules already parse rendered text exhaustively. The eye test is what a person does by looking, so
it gets what a person would see:

- The homepage full-page capture
- The sampled product page captures
- The sign-up form capture, where one was reached

These are already taken and stored; the eye test adds no crawling and no new requests.

Page text is supplied only as context alongside the images, never in place of them. A dimension that
could be answered from text alone belongs in a rule, not here.

---

## 2 — The nine questions

Nine, not eleven. Padding to a round number would mean inventing questions the captures cannot
answer.

| # | Question | Why no rule covers it |
|---|---|---|
| 1 | Does the homepage read as a research supplier or a consumer storefront? | no rule reads layout |
| 2 | Do product pages lead with chemical data or with benefit language? | rules check for prohibited terms, not emphasis |
| 3 | Do photographs show the product, or people and bodies? | no rule reads images |
| 4 | Do any images show needles, syringes, measurement or dosing? | CATG-001 checks catalogue URLs, not pictures |
| 5 | Are there badges or marks implying medical endorsement? | uncovered |
| 6 | Does the design imitate a pharmacy or telehealth service? | uncovered |
| 7 | **Does anything undercut the research framing?** | the composition, which nothing can match on |
| 8 | Does checkout read consumer — discounts, bundles, subscriptions? | uncovered |
| 9 | Does the entry gate read as a control or a formality? | GATE-001 checks it exists, not how it reads |

### Nothing here re-answers a rule

A report that says the same thing twice in different words is worse than saying it once, and the
second saying carries less authority than the first — a judgment restating a finding invites the
reader to weigh them against each other.

Deliberately excluded, with what already answers them:

| Excluded | Covered by |
|---|---|
| Certificate depth and currency | COA-001 … COA-006 |
| Disclaimer presence and legibility | DISC-002, DISC-003 |
| Testimonials and outcome stories | OFFS-002 |
| Sign-up form fields | GATE-004, GATE-005 |
| Product naming | NAME-002, NAME-003 |
| Off-site trail, whole-site coherence | not answerable from captures |

### Question 7 is the one that earns the layer

It is not any single element. A storefront states "for research use only" in the footer, and around
it: a discount code, a bundle named for an outcome, subscribe-and-save, free shipping over $99, a
chat widget offering to help you choose. Every element is individually defensible; together the site
is selling to people, and an experienced reviewer sees it in seconds.

No rule catches it because there is nothing to match on — it is the composition. The compliance
vendors call this wink-and-nod and spend more words on it than on anything else, precisely because
mechanical checks miss it.

## 3 — What it produces

Two things, and no others.

**A read.** Two to four sentences in Mintro's voice, describing how the storefront presents itself.
This is the part a reader actually reads.

**A verdict per question.** One of three: **CLEAR**, **CONCERN**, **CANNOT TELL**. Never a number,
never a grade, never a rating.

**Only CONCERN and CANNOT TELL carry evidence.** A clear row is the question and the word, nothing
more. A clean storefront's eye test is nine short lines and a paragraph; a problematic one grows
only where it should. Wordiness is the failure mode this layer is most prone to.

**An unparsed verdict becomes CANNOT TELL, never CLEAR.** Coercing a parse failure into reassurance
is the one direction that matters.

**Every question gets a row**, even where the model returned nothing for it. A dropped row reads as
a question never asked.

**No score, ever.** The compliance vendors publish 0–100 scales; Mintro does not. A number invites
arithmetic, and eleven numbers invite an average, which is a determination (D-001). It is also the
exact failure the progress model refused: a figure whose denominator nobody can defend.

---

## 4 — The rubric is data

The question list and the instruction the model receives live in
`rules/eyetest.json`, versioned independently of the rule set.

Revising the rubric must never be a code change — the same constraint the rule set has carried since
hard constraint 1.

**The rubric version is stored with every result**, alongside `rulesetVersion`. A reader six months
from now must be able to tell which rubric produced a given read; without it, calibration compares
answers to different questions.

---

## 5 — Immutability and failure

**The eye test is written once and stored beside the run.** Never recomputed at render time. D-002
applies exactly as it does to findings: a run says what it said.

**It is written after the run, not at assembly** (D-198, resolving §9's first open question). A
typical call measured 22 seconds — 18.6, 22.7 and 26.4 across three real calls — against a 26-33s
run, so running it inline roughly doubled the crawl for a layer that by design changes nothing. It
became a job, enqueued automatically when a run completes.

That has one consequence worth stating: **the result cannot live in `runs.report`**, which is sealed
the moment the run finishes. What the report carries instead is the *manifest* — which page was the
homepage, which were sampled products, which was the sign-up form — because that is knowledge the
crawl has and a later job cannot recover without guessing at URL shapes. Assembly decides what to
look at; the job does the looking.

**When the model call fails, the eye test is absent** and the report says so plainly — "no eye test
was recorded for this run". It is never partially rendered, never retried at render time, and its
absence never blocks the run. A crawl that produced 71 findings is not wasted because a judgment
layer timed out.

**"Not recorded yet" is a fourth state and never renders as failure.** Because the read arrives after
the run, a report is routinely on screen before its read exists. Showing a pending job in the absence
treatment tells a reader the layer broke, half a minute before it succeeds.

**A run predating the rubric** says it was screened before the eye test existed, rather than
rendering an empty panel (D-044). Never backfilled: a read taken today, under today's rubric, filed
against a run that predates it is a read nothing could attribute — and attribution is the whole of
what `rubricVersion` is for.

**Nothing gates on it.** Not the send, not the PDF. The send modal states whether the read is on the
report and leaves the button enabled; an operator who wants to wait can. Mintro does not block on
Mintro's own judgment layer — the blocker-tier ruling of §7, one level over.

---

## 6 — Where it renders

Between the stopping-conditions panel and the brief, per `docs/report-visual-spec.md`.

Visually distinct from every other surface — dashed border, and the label
**EYE TEST · MINTRO'S IMPRESSION, NOT AN OBSERVATION** above it. Nothing else in the document is
dashed, so a reader learns the signal once.

The read is prose at full size; the nine verdicts sit beneath it, secondary text. Because clear rows
carry no evidence line, all nine fit without a disclosure.

**It goes to all three audiences.** Merchant, agent and IQwallet see the same read. A judgment Mintro
would not show the merchant is one it should not be making.

---

## 7 — It runs on every package, including blocked ones

Per the blocker-tier design. On a blocked package nobody reads it — it is calibration data only, and
throwing it away would mean the rubric never sees the storefronts that most need judging.

---

## 8 — Calibration

`docs/eyetest-calibration.md` **must exist before the first agent package.**

For each package: the domain, the run id, and IQwallet's feedback **verbatim**. Each of their
comments classified hit / miss / noise.

**Do not revise the rubric below five packages.** A rubric tuned on two is tuned on noise.

The reason for verbatim: a paraphrase of feedback is Mintro deciding what IQwallet meant, which is
the same error as a summary line that characterises an observation.

---

## 9 — Open

- ~~**Cost and latency per run.**~~ **Settled — see §5 and D-198.** Measured at 22s typical against a
  26-33s run, so it moved out of the crawl into a post-run job. Cost was never the constraint: about
  $0.10 a run at 24.5k input tokens.
- **Whether the read should name the storefront's strengths.** The current draft does — "reads as a
  working laboratory supplier" — which is fair and useful, but it is also the closest the document
  comes to endorsement. Watch it in calibration.
