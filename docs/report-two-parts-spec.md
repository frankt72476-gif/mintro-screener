---
purpose: The report in two parts — what needs an answer, and the record. Supersedes the brief, and settles the heading, row and spacing systems the document had never had. Read before changing any report surface.
status: agreed 2026-08-30, for build
---

# The report, in two parts

Two problems with one cause.

**The three not-met findings appear twice** — once as the brief and again as a band inside *For your
review*. A reader meets them as a summary, scrolls past four screens of other material, and meets
them again as the real thing. Neither instance is complete: the brief has a one-line gloss and no
evidence, the band has evidence and no prominence.

**Every surface was styled when it was built.** Six heading treatments across three type families,
four different row anatomies, eight spacing values with no scale between them. The document reads as
a list of things that were made at different times, because it is one.

The cause is the same: the report grew a surface at a time and nothing ever went back over the whole
of it.

---

## 1 — The division

**Part one is what needs an answer. Part two is the record.**

| | Part one | Part two |
|---|---|---|
| Sections | Stopping conditions · Not met · Eye test · Operational questions | For your review |
| Surface | Bordered cards | Flat, hairline-separated |
| Asks the reader for | a response | nothing |

The test for part one is *does this leave the package incomplete until somebody answers it*. A
stopping condition that fired, a standard not met, Mintro's own read of the storefront, a question
no crawl can answer: each of those is outstanding work sitting on a named person.

### Unclear is the borderline, and it sits in part two

*Unclear* rows say "observed, but the check cannot decide", and the section lede invites a merchant
to say where Mintro has it wrong. That is an invitation, not an obligation, and the difference is
who the work is sitting on: an unclear finding is **Mintro's** to resolve — `tier: "review_only"`
sends it to a human queue regardless of what the merchant says (D-009). A not-met finding and an
unanswered question are the merchant's.

So part two still takes comments. It simply does not ask for them.

### Why cards against flat, and not colour

Colour already carries section identity (D-201), and it is dropped in print because five hues do not
survive greyscale. **The part division must survive print**, because the PDF is the document that
reaches an underwriter and the distinction between outstanding work and the record is the first
thing they need.

A border survives greyscale, photocopying, and a printer low on one cartridge. Part one is
bordered cards on the page background; part two is flat content with hairline dividers and no
container. The difference reads at arm's length with the page upside down, which is the test.

---

## 2 — Not met becomes a section

The brief is **deleted**. Not summarised elsewhere, not reduced — deleted, and its three items become
a full section in part one, second after the stopping conditions.

Each row carries what a finding row carries anywhere else:

    NOT MET   Disclaimer on every sampled page              DISC-003
              No text resembling the required disclaimer was observed in this
              page's footer. Observed on 5 of 5 sampled product page(s).
              ▸ /shop/bpc-157-tb500-blend/
              [ evidence slip ]
              [ comment box ]

**Not met leaves *For your review* entirely**, and the section's count drops with it — 33 becomes 30
on the live comopeptides run. There is no cross-reference, no "see above", and no third place the
same finding is mentioned. One finding, one row, one place (D-166 applied to the document rather
than to the rule set).

The section is present only when something is not met. On a run where nothing is, part one is the
stopping conditions, the eye test and the questions.

---

## 3 — The eye test takes one comment box

It moves into part one, third, between *Not met* and *Operational questions*.

**One box for the whole read, never one per question.** Nine boxes would ask a merchant to rebut a
rubric line by line, which is not what the read is: the read is a paragraph about how the storefront
presents itself, and the useful response is a paragraph back. A merchant who says *"the Fire Sale
banner was a two-day promotion and is gone"* has told an underwriter something no rule and no
verdict row could.

That response is likely the most useful single thing in the package, and it is the one Mintro cannot
generate.

The box sits under the read and above the verdicts, because the read is what it answers.

**The verdicts stay uncommentable.** They are Mintro's impression and carry no evidence a merchant
could contest; a box under each would imply the verdict is a finding, which is the one thing the eye
test may never become (D-196).

---

## 4 — The coherence pass

The largest piece. Everything below was measured on the rendered document, not read out of the
stylesheet, because the cascade had made several of these invisible in the source.

### Three heading sizes

| Level | Treatment | Used for |
|---|---|---|
| Document | 24px / 500 / Space Grotesk | the merchant domain. One per report. |
| Section | 17px / 500 / Space Grotesk | every section in both parts |
| Band | 11px / 700 / mono, uppercase, `0.08em` | a group inside a section |

**Six treatments were in use and four are deleted.** What was there:

| Was | Where | Now |
|---|---|---|
| 24px / 500 / Space Grotesk | domain | kept as Document |
| 21px / 500 / Space Grotesk | *For your review* heading | → Section |
| 20px / 500 / Space Grotesk | *Operational questions* heading | → Section |
| 17px / 500 / Space Grotesk | stopping panel, brief | kept as Section |
| 15px / 600 / Inter | review band heading | → Band |
| 13.5px / 600 / Space Grotesk | category group heading | → Band |
| 12.5px / 600 / Inter | block heading | → Band |
| 9.5px / 700 / mono | eye-test label | → Band |

Two of those are worth naming. **21px and 20px were the same heading at two sizes** — *For your
review* and *Operational questions* are peers, and they differed by a pixel because one inherited a
later override the other did not. Nobody could have seen it; nobody did. And **the eye-test label at
9.5px was the smallest heading in the document**, set as a caption because it was written as a
caption, on a surface that is one of five sections.

Section headings are 17px in both parts. The parts are told apart by the border, not by the type —
two signals for one division is how a document gets a third state nobody defined.

### One row anatomy

Every row in the report, in every section, is:

    [mark]  [title]                                    [rule id]   [chevron]
            [observation sentence]
            ▸ [evidence path]

- **mark** — 11px mono uppercase in a 82px gutter, carrying the state word or the verdict word
- **title** — 13px / 500 Inter
- **observation** — 12.5px / 400, `--ink-mid`, `line-height: 1.6`
- **evidence** — 11px mono, `--slate`

Four anatomies were in use: the finding row, the brief item (a list item with a bullet and a 14.5px
title), the eye-test verdict (a two-column grid with its own gaps), and the attestation row (a
flex pair with the mark inline). **Three are deleted.** The eye-test verdict and the attestation
question are findings-shaped things and now use the findings row; the brief item goes with the
brief.

The state mark is the only per-row colour, and it stays the 3px left edge inside the card (D-201).

### One spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48`. Nothing else.

Measured, the document was using **16, 18, 20, 22, 24, 30, 40 and 46** — eight values, five of them
off any scale, each one chosen for the surface being built that day. The mapping:

| Was | Now |
|---|---|
| 16, 18 | 16 (card padding) |
| 20, 22, 24 | 24 (between cards) |
| 30 | 32 (between bands) |
| 40, 46 | 48 (between parts) |

### What conformed, and what was deleted

Deleted outright:

- **`Brief`, `brief()`, `BriefItem`, `BriefCount`, `briefLine()`** and every `.brief-*` rule. The
  component, its model, its row anatomy and its five type sizes.
- **The `fail` band** in `reviewPart`, and the band's heading, gloss and tally.
- **Four heading treatments**: 21px, 20px, 15px, 13.5px, 12.5px, 9.5px — six declarations reduced to
  the two that survive.
- **Three row anatomies**: `.brief-item`, `.eye-list li`, `.att-row`.
- **Eight ad-hoc spacing values.**

Conformed rather than deleted:

- The **stopping-conditions panel** keeps its two groups and its icon; only its type and spacing
  move.
- The **not-observed five-way split** (D-044) stays exactly as it is. It is the one place in the
  document where more structure is correct, and it is inside a band rather than beside one.
- The **evidence slip** is untouched. It is the only surface whose design was settled before the
  rest and it was settled correctly.

---

## 5 — Print

Part one prints as bordered cards; part two prints flat. Nothing about the division depends on
colour, which is dropped in print (D-201).

The comment boxes do not print. A box is a control, and a printed control is a promise the page
cannot keep — the same argument that keeps `commentBox` off the print branch today.

---

## 6 — What does not change

Copy, ordering within a section, the four states, the evidence contract, the rule set, and every
sentence a finding renders. This is a document-structure and type pass. **No observation changes its
words**, and no finding changes its state.
