---
purpose: Structural redesign of the screening report — the brief, the single review section, and the vocabulary. Supersedes the section architecture in docs/report-sections-spec.md.
status: agreed 2026-08-29, for build
---

# Report redesign — structure

Successor to `docs/report-sections-spec.md`, which established four sections. This changes what
a reader meets first and collapses three of those sections into one.

**Reorganisation only.** The visual pass — type scale, spacing rhythm, how state is signalled,
colour discipline — is a separate piece and comes after. Restyling a structure about to change
means designing it twice.

One implementation. `ReportView` plus `grouping.ts` reach the app and the PDF together, so every
rule below states what print does.

---

## Why this changes

Two problems the four-section version did not solve.

**Seventy-one rows for three problems.** The document opens on the same list whether a storefront
has three findings or thirty. No amount of heading weight fixes that; the reader needs a summary
that is not a list.

**"Needs a look" claims for one group what is true of all three.** Not met, needs a look and not
observed are all findings a merchant should read and may comment on. The label named the action
rather than the observation, so it implied the other two needed no action.

---

## 1 — The brief

The first screen, and page one of the PDF. Self-contained: a reader may stop here.

```
comopeptides.com                                    29 August 2026

  Three observations did not meet a standard

  │ Products are visible without an account
  │ /shop returned 200 to an anonymous visitor

  │ The required disclaimer is missing from product pages
  │ 5 of 5 sampled pages

  │ Two products are named with marketing terms
  │ both matched "blend"

  19  questions for you      10  unclear      0  stopping conditions failed

  Screened 5 of 37 product pages. 43 of 71 checks resolved from the site;
  28 could not be, mostly because they rest on records a website cannot show.
```

**Priority ordering, not fixed content.** The brief leads with whichever is most serious:

1. **Failed stopping conditions**, where any exist. These are visually distinct from everything
   else, because a failed one means the package does not proceed.
2. **Standards not met**, filling the space when no stopping condition failed.
3. Where neither exists, the brief says so plainly and the counts carry the page.

**Nothing in the brief instructs.** "Three observations did not meet a standard", never "three
things to change". A summary line is where a determination is most likely to creep in, and D-001
is not relaxed by brevity.

**The one-line summary under each item is new engine work.** The report has no plain-language line
per finding today — only the observation text, which is written to carry evidence. Either the
observation is trimmed for this position, or `rowSentence` gains a short form. Whichever is chosen
must not restate the title, and must never add a fact the finding does not carry.

Every item links to its row below.

---

## 2 — Stopping conditions

Unchanged from the current build. All nine named with state, summary line above, failed ones
linking to their row. Renders at zero. On a run predating the flag it says the run was screened
before stopping conditions were recorded rather than reporting a clean sweep (D-044).

---

## 3 — For your review

**Three sections become one.** Not met, unclear and not observed all describe what Mintro saw; the
reader's job is the same for all three, and one heading says it once:

> **For your review**
> Thirty-five observations. Read each one and tell us where we have it wrong.

Three bands inside it, each with a count and a one-line gloss of what the state means:

| Band | Gloss |
|---|---|
| **Not met** | observed, and short of the standard |
| **Unclear** | observed, but the check cannot decide |
| **Not observed** | nothing on the site to measure |

Bands are sub-headings with a rule above the rows, not gutter labels. Rows carry title, the
observation sentence and the source path; everything else expands on click. A commented row shows
a dot beside the title and a line naming the comment.

### Print

Band headings repeat across a page break. Every row expands, exactly as today (D-042 as revised by
D-166).

---

## 4 — Operational questions

Unchanged. Nineteen, with authority and severity, and the answer where one exists.

---

## 5 — Met

A count with a disclosure, at the end. Unchanged.

---

## The vocabulary

One change, in `stateLabel.ts`:

| State | From | To |
|---|---|---|
| `review` | Needs a look | **Unclear** |

`fail` stays *Not met*, `pass` stays *Met*, `not_evaluable` stays *Not observed*. The identifiers
are untouched (D-060).

*Unclear* describes the observation rather than the reader's task, which is what makes it coexist
with the other two under one heading.

---

## What this does not touch

- Finding content, requirement pairs, evidence blocks, the cascade, ordinals.
- The stopping-conditions checklist.
- The operational questions section.
- The sticky navigation, which now carries three destinations rather than four.

---

## Order of work

1. The vocabulary change. Mechanical, lands independently.
2. Merge the three sections into one with three bands. Counts from the existing `tally` derivation.
3. The brief, priority-ordered, above stopping conditions.
4. The per-finding summary line the brief needs.
5. Sticky nav follows the new section set.

---

## Known open

- **"Not observed" is 22 of the 35** and is the least likely to carry a comment. Whether that band
  should be collapsed by default was raised and not taken; revisit after the first agent package.
- **"0 stopping conditions observed"** in the current header lines is misleading — seven were
  observed and met. Fix to "0 of 9 stopping conditions failed" as part of the brief.
- **The header block and sticky bar both render at the top.** The bar should appear only once the
  block scrolls away.
