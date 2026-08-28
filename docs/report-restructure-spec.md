---
purpose: How the screening report is organized and rendered. Structure and layout only — no rule changes, no finding changes, no engine changes.
status: spec — approved by Frank 2026-08-28, not yet built
---

# Report restructure

Two reference runs, both current: `c268f8d7` (sportstechnologylabs, 36 pages) and the comopeptides
run at rule set 3.1.0 (38 pages). Read them before starting. Every problem this spec addresses is
visible in those two documents.

**This is a render-time change.** Findings, states, evidence and the run record are untouched. D-002
holds: a run is written once and never rewritten. Nothing here alters what was observed — only how it
is grouped, ordered and presented.

---

## The problem, stated concretely

From run `c268f8d7`:

- **PROD-001 appears five times. PROD-003 five times. NAME-003 four times.** One finding per sampled
  page, each with a full evidence block. That is most of the document.
- **States interleave.** Section 03 runs REVIEW, REVIEW, N/A, N/A, PASS, PASS, PASS, PASS, PASS. Nobody
  can scan that.
- **Cascades render as unrelated findings.** One fact — the certificate link does not serve a PDF —
  produces COA-006 REVIEW plus COA-002, COA-003, COA-004 all N/A, each repeating the same sentence and
  the same five-URL evidence block. Four times. Same shape in disclosure: DISC-003 FAIL, DISC-001
  REVIEW, DISC-002 N/A all descend from "no disclaimer located in the footer."
- **The merchant's own work starts on page 33 of 36.** Nineteen attestations, the only items they can
  act on, after thirty-two pages they cannot.
- **The summary reports 26 passed** without saying that 5 of 64 product pages were sampled, or that 4
  of 27 requests did not answer.

---

## Two documents, not one

### A — Decline notice

Produced when one or more `blocking: true` rules are in a failing state. Goes to the **agent only**.
Not sent to IQwallet. Carries no comment link.

**It must be printable.** The current blocking panel is print-excluded, which was correct when it was
an internal operator aid. It is now a document that gets forwarded, so it needs a PDF form.

Contents, and nothing else:

1. Domain, date and time, run id, rule set version
2. Each stopping condition observed: the rule's title, what was observed, the evidence
3. What happens next — the merchant addresses these and the storefront is screened again

No findings list. No attestations. No eye test. No coverage panel. One page where possible.

**Wording.** These are intake criteria IQwallet stated, applied — not Mintro's assessment of the
merchant. The notice says which conditions were observed and that they are IQwallet's stated
conditions, with the `blocking_source` authority and date. It does not characterise the merchant, and
it does not predict what IQwallet would do. Never use "rejected". "Decline" appears only in reference
to IQwallet's stated criteria, never as something Mintro concluded.

**The gate remains operator-visible.** Nothing auto-sends. The operator sees which stopping conditions
fired, reviews the evidence, and decides. This spec builds the document; it does not turn the gate on.

### B — Full report

Produced when no blocking rule is failing. Two audiences, same findings, different first screen.

---

## Structure of the full report

### Header — identity and coverage

The agent's only mechanism for telling two reports apart is the date, so it has to be unmissable:
domain and screening date at the top, in the largest type after the domain itself. Run id and rule set
version present but subordinate. Filename already carries domain and date — keep that.

Then coverage, in one line, before anything else:

> Screened 5 of 64 product pages, plus the homepage, terms, FAQ and sign-up form.
> 4 of 27 page requests did not answer; 22 rules could not be evaluated as a result.

Determine what the engine can currently report here — sampled count, catalogue size, distinct pages
rendered, failed requests, truncated sitemaps. Some of this exists (`sampling 5 of 64` is logged;
`report.truncations` exists post-D-156). Report what is available and what is not before designing
around it. **Do not compute anything new in the crawl for this without saying so** — if a number
isn't available, the line says less rather than estimating.

Sample basis is the honest treatment of the pass count. A summary that says "26 passed" without
saying "over 8% of the catalogue" is misleading in aggregate even where every individual finding is
candid. Passes and sample basis appear together or not at all.

### Section 1 — What needs your attention

Explicit heading, exactly that wording, on the merchant and agent view. This is the section they act
on. Ordering within the full report differs by audience:

**Merchant / agent order:**
1. Operational questions (the attestations) — only they can answer these
2. Failures
3. Reviews
4. Not observed
5. Passes — attached, collapsed, not part of the attention set

**IQwallet order:**
1. Failures
2. Reviews
3. What the merchant stated (answered attestations) and what they did not answer
4. Not observed
5. Passes — attached, collapsed

The operational questions lead for the merchant because they are the merchant's work. They do not lead
for IQwallet because unanswered questions are a gap, not a finding.

### Section 2 — Compliance findings

Ordered by state, not by category. Category becomes a label on the finding rather than the container.
This is the change that stops the interleaving.

**One finding per rule.** Not per rule-page pair. A rule that held across five sampled pages renders
once:

> **CAS number listed** · PROD-001 · pass
> Observed on all 5 sampled product pages.
> Evidence: 5 captures ▸

Page-level detail and per-page evidence sit behind the disclosure, not inline. Where a rule's outcome
differs by page, that difference is the finding — say so, and list the pages that differed.

**Cascades render as one item.** Where several findings descend from a single failed observation, the
consequences nest under the observation rather than repeating alongside it:

> **Certificate links serve a readable certificate** · COA-006 · review
> A certificate link on the sampled product pages returned something that is not a PDF.
> Because nothing readable was served, three further rules could not be evaluated:
> COA-002 (test date), COA-003 (purity), COA-004 (required fields).
> Evidence ▸

Determine a **structural** way to identify these — a shared upstream observation, a shared failed
retrieval — not by comparing note strings. String matching to detect a cascade is constraint 9 in a
new place: it recognises the cascades whose wording happens to match and misses the rest. If no
structural signal exists, say so and leave cascades flat rather than approximating.

**Evidence is compact and secondary.** Source, hash, one thumbnail. Not a full-width panel per
finding. In the web view it collapses by default. The reader needs to know *what* before *where*.

### Section 3 — Operational questions

The existing attestations, unchanged in content. Currently rendered as "Stated by the merchant" on
page 33; it moves to the front of the merchant view and keeps its position in the IQwallet view.

The existing lede stays, including the sentence carrying the load: *"Nothing in this section was
observed or verified by Mintro."* Authority and severity labels stay.

### Section 4 — Eye test

**Reserved, not built.** Leave the slot: a fourth section after the operational questions, with its
own heading and its own response model. Do not stub it, do not render an empty heading. The point of
reserving it is that the layout will not need rebuilding when it lands.

### Section 5 — What was not checked

Unchanged. Stays at the end.

---

## Design direction

The current report is boxes inside boxes. Nearly every element carries a border, a fill, or both, so
nothing is emphasised because everything is.

- **No cards, no filled panels.** Hierarchy comes from type size, weight and whitespace.
- **State is a word, not a pill.** Set in the margin beside the rule title, in a single ink weight.
  Colour may distinguish the four states, but the layout must remain legible in one colour — these are
  printed and photocopied.
- **One accent, used once.** The attention section. Nowhere else.
- **Findings are lines, not blocks.** Rule title, state, one-sentence observation, evidence
  disclosure. The standard's clause stays — it is why the finding exists — but set as a quotation
  rather than a bordered panel.
- **Target: the current 36 pages become roughly 12** with nothing removed. If it does not compress
  substantially, the dedup and cascade work has not landed.

The same structure serves the web view and the PDF. The web view may collapse by default what the PDF
prints inline; it may not show or hide different findings.

---

## Constraints

1. **No rule changes, no finding changes, no engine changes.** If the layout appears to need one, stop
   and report rather than making it.
2. **Runs are immutable.** Every existing run must render under the new layout without modification.
   Where a run predates a field, say so — the D-044 pattern, as with the blocking flag — never infer a
   claim about the merchant from the age of the record.
3. **A finding's own honesty must survive the compression.** Notes like *"Text not rendered on the page
   was not examined"* and *"Co-occurrences further apart than that window were not examined"* are the
   scope of the observation. If grouping five findings into one loses those qualifications, the
   grouping is wrong.
4. **Findings describe observations, never determinations** (D-001). This applies to summary and
   heading copy as much as to finding text. "What needs your attention" is an ordering, not a verdict.
5. **The merchant view and the IQwallet view differ in order and in what is collapsed, never in what
   exists.** No finding appears in one and not the other, except the eye test on a blocked package,
   which does not arise here.

---

## Order of work

1. Report on what coverage data is currently available, and on whether a structural cascade signal
   exists. Both shape the design. **Stop and report before building.**
2. Decline notice, including its printable form.
3. Dedup — one finding per rule.
4. Cascade collapse, if step 1 found an honest signal.
5. State ordering and the two audience orderings.
6. Header, coverage line, sample basis alongside the pass count.
7. Visual pass.
8. Re-render both reference runs. Compare against the current PDFs and account for every finding —
   nothing may disappear, and every qualification must survive.

Record decisions for the restructure, the dedup rule, and the two audience orderings. Confirm the next
free number rather than assuming.
