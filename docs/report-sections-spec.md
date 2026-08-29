---
purpose: Section architecture and label set for the screening report — the top-level structure the restructure did not deliver, and the vocabulary it renders in. Specified against ReportView + grouping.ts, which both surfaces share.
status: draft v2 for review, 2026-08-29 — supersedes v1
---

# Report section architecture

Successor to `docs/report-restructure-spec.md`, which ordered findings by state and stopped there.
This gives the document its top-level structure, replaces page one, and softens the vocabulary.

**One change, not two.** The PDF is `page.pdf()` against the same React route, so `ReportView` and
`grouping.ts` reach the app and the export together. Every rule below states what the print branch
does, because that branch currently drops the group header entirely and that is how two surfaces
built from one component diverge.

---

## The problem, stated once

Frank, on the rendered output: *"it still doesn't jump out at me the categories we discussed... it
still feels like a long list."* And on the top band: the boxed numbers are not meaningful, the
coloured blocks are not doing much, the space is not earning itself.

Four defects produce that:

1. **No section boundaries.** Findings and attestations run together.
2. **Page one states the distribution four times** — verdict sentence, tick-strip legend, coverage
   columns, coverage line — and none of the four says what to do.
3. **The five coverage boxes are a taxonomy of non-observation.** "Does not apply", "not checked",
   "not reachable", "not exposed" is bookkeeping about the crawl, not information about the
   merchant, and it sits in the most valuable space on the page.
4. **The vocabulary is harsher than the posture.** "FAILED" in a red badge is a verdict. Mintro
   reports observations and does not decide the outcome.

**The space is not refilled.** The complaint is density, so the answer is fewer things and more
air — not a better widget in the same rectangle.

---

## 1 — Four sections, named

Every item belongs to exactly one.

| # | Heading | Contains | The question it answers |
|---|---|---|---|
| 1 | **Stopping conditions** | The 8 blocker-tier rules, and which were observed failing | Does this stop here? |
| 2 | **Questions only you can answer** | The 19 attestations — free text | What do you need from me? |
| 3 | **What we observed** | Everything else in `fail` and `review` | What did you see? |
| 4 | **Not observed from the site** | `not_evaluable`, plus the coverage account | What couldn't you see? |

Passing findings are **not a section**. They are a count in section 4's furniture with a disclosure
that expands them in place. Twenty-six passes above the fold is what makes the document read as a
list.

### Section 1 renders even at zero

*"None of the 8 stopping conditions was observed failing"* is worth saying. Note the structural
consequence, so nobody later wonders why the section looks empty: **blocked packages go to the agent
only** — no IQwallet send, no merchant comment link — so on the merchant and IQwallet surfaces this
section reads zero by construction. It carries content only on an agent package. That is correct,
not a bug, and the spec records it here rather than leaving it to be rediscovered.

### Ordering flips by audience, and nothing else does

- Merchant and agent: **1, 2, 3, 4**
- IQwallet PDF: **1, 3, 4, 2**

One parameter on the render, not two component trees. The existing merchant/IQwallet ordering
distinction becomes visible for the first time — today it is not distinguishable.

Section 3 is one heading on the app surfaces and splits into *not met* then *needs a look* on the
IQwallet PDF. A merchant fixing their storefront works a single list; an underwriter reads them as
different categories. Grouping is a parameter.

### Print

Sections are `<section>` with the heading inside, repeating on page break via `break-inside` and a
running header. A section heading appearing once on page 4 of 24 is a heading the reader has already
lost. The print branch must carry the section header **and** the group header — today it has
neither, so the group title exists only on the instances, N times.

---

## 2 — The label set

The state names in the data are unchanged: `fail`, `review`, `pass`, `not_evaluable`. They are
identifiers, and D-060 already ruled that an identifier is not something an underwriter reads. What
changes is every rendered string.

| State | Was | Is |
|---|---|---|
| `fail` | Failed / FAIL | **Not met** |
| `review` | Needs review / FOR REVIEW | **Needs a look** |
| `pass` | Passed | **Met** |
| `not_evaluable` | Not evaluable from the site | **Not observed** |

*Not met* describes the standard, not the merchant, and instructs nothing — which is the whole
posture (D-001). *Needs fixing* was rejected: it is warmer but it tells the merchant what to do,
which is a step past observing.

**The red `FAILED` badge goes with the word.** Colour weight follows the new vocabulary: not met is
distinguishable, not alarming.

---

## 3 — The header, and what replaces the top band

Above the fold on both surfaces:

```
[merchant domain]                         Screened 28 August 2026

   0  stopping conditions observed                     → jump
  19  questions only you can answer                    → jump
   3  standards not met                                → jump
  11  need a look                                      → jump
```

Rules:

- **One line per section**, each linking to it. Counts are section counts, derived once, so the
  lines and the headings can never disagree.
- **The date sits with the domain.** D-042's no-delta ruling makes the date load-bearing — agents
  tell reports apart by date and nothing else. Revision 6 made it the second-most prominent element
  in the header; this keeps it there and puts it beside the thing it dates.
- **Numerals, not prose.** "3" is scannable; the verdict sentence is three lines a reader must
  parse.
- **No colour strip.** The 66-square tick strip is deleted.
- **A zero section renders its line with 0 and no link.** An absent line reads as an absent section,
  which is an absent value shown as an answer (D-044).

### What the four restatements become

| Today | Becomes |
|---|---|
| Verdict sentence | Deleted. The lines say it, in numerals. |
| Tick-strip legend | Deleted with the strip. |
| Five coverage boxes | One sentence inside section 4. |
| Coverage line under the chips | Deleted. Section 4's lede carries it. |

This closes revision 3 and most of revision 5 — the page-one furniture that kept its borders, fills
and radii (`.cov-col`, `.obstruction`) is deleted or moves into a section body, where the
box-stripping layer from `f61f102` already applies.

`.card.blocking` is deleted as a floating panel; it becomes section 1.

---

## 4 — Coverage becomes a sentence

The six columns are replaced, inside section 4, by one line in Mintro's own vocabulary:

> Of 66 findings, 38 were resolved from the crawled surface. 28 were not: 11 needed a surface no
> crawl reaches, 14 were looked for and not found on the site, and 3 are checks Mintro has not built
> yet.

Same facts, one sentence, inside the section it explains.

**Deferred, deliberately: the rule-level recompute.** Coverage counts findings; D-170 made the
header name both nouns rather than change the measure. Whether an underwriter should read
"32 of 54 rules evaluated" rather than "38 of 66 findings" is a question about what the report
claims, not how it is spelled, and it is a separate decision. This spec moves the numbers and
rewrites the sentence around them; it does not change what they count.

---

## 5 — What this does not touch

- Finding content, requirement pairs, evidence slips, `rowSentence`.
- The cascade, the group model, ordinals.
- `grouping.ts` beyond section assignment.
- Restructure revisions 1, 2 and 4. They live inside a section body and land independently.

---

## Order of work

1. **Close the commentary payload gap first.** `report-pdf.ts` injects no commentary while
   `pdfJob.ts` does, so a CLI-rendered PDF omits merchant responses — the half of D-167's asymmetry
   left open. Not part of this spec, but it must land before the spec's output is reviewed, or the
   two PDFs differ for reasons unrelated to sections.
2. The label set. Mechanical, touches every surface, and lands independently of structure.
3. Section assignment in `grouping.ts` — four sections, counts derived once.
4. The header lines, replacing the top band.
5. Section shells with headings, print rules included.
6. Passes collapsed to a count with a disclosure.
7. Coverage sentence into section 4.
8. Ordering parameter by audience.
9. Delete the tick strip, the verdict sentence, the coverage columns and the coverage line.

Steps 3 and 4 share one derivation of the counts. If they end up with two, that is the defect.

---

## Open

- **The comment page.** Structurally similar and visual similarity is wanted, so the same four
  sections should apply. Needs a look at what a merchant lands on above the fold.
- **The eye test** is a fifth section, reserved. Nothing here forecloses it.
