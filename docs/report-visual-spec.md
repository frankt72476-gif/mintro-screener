---
purpose: The agreed visual system and top-of-document order for the screening report. Build this in one pass. Supersedes the layout in docs/report-redesign-spec.md §1.
status: agreed 2026-08-30, for build
---

# Report visual system

One pass. The structure below was iterated against rendered mockups and is settled; this document
is the whole change.

`ReportView` plus `grouping.ts` serve both the app and the PDF, so every rule states what print
does.

---

## 1 — Document order

**Top of document, in this order. Nothing above stopping conditions.**

1. **Header** — domain, one line of context, date
2. **Stopping conditions** — the panel, all nine named
3. **The brief** — observations that did not meet a standard
4. **Eye test** — reserved, arriving next; nothing here forecloses it
5. **Navigation** — two count cards
6. **Coverage** — one sentence

Then the sections:

7. **For your review** — three bands: not met, unclear, not observed
8. **Operational questions**
9. **Met** — count with a disclosure

**Stopping conditions come first and are not a separate section further down.** They were rendered
as a count card three times during design and each time the reader lost the thing that matters most.
There is no "0" card standing in for the list.

---

## 2 — Stopping conditions panel

A bordered surface at the top of the document, above the brief.

**When none applies:**

```
  ✓  Nothing here stops the application
     Seven of nine stopping conditions were checked and none applies. Two
     could not be checked — tell us if we have those wrong.

     COULD NOT BE CHECKED · 2
       Guest checkout disabled  GATE-003
       Could not verify whether guest checkout is disabled. The add-to-cart
       control was clicked but the cart remained empty.
       [expands, takes a comment]

     CHECKED AND CLEAR · 7
       Pharmaceutical brand names · Route-of-administration labels · …
       [one line of secondary text, no state labels, does not expand]
```

Two groups, not a nine-row grid. The group heading carries the state word and the count once, so the
rows beneath carry none.

**"Applies", never "met".** *Met* meant **fired** in the heading and **passed** in the rows — two
senses of one word in one panel, with nothing to tell a reader which was which. A condition applies
or it does not; a row that was checked and clear says so in its own words.

**When one or more applies:** the panel turns. Danger icon, the heading names the count
("One stopping condition applies", "Three stopping conditions apply"), each one gets its title and
its observation sentence, the could-not-be-checked group still renders — the sub-line names its
count, so hiding it would leave a reader told there are open questions and given no way to answer
them — and the clear ones collapse to a single line ("seven others checked and clear"). Same slot,
same position, different weight.

**A run predating the flag** says it was screened before stopping conditions were recorded, rather
than reporting a clean sweep (D-044). Unchanged.

### Rows are commentable

A stopping condition that applies is the highest-stakes claim in the document, and a condition that
could not be checked is exactly where a merchant can supply what the crawl could not reach. Both
expand, carry their evidence, and take a comment on the merchant and agent surfaces — the same
affordance a finding row has.

The seven clear ones do not expand. They are a list, not findings.

---

## 2a — Not-observed findings say what could not be verified

The current not-observed copy states the mechanism and never the question. *"No region labelled
'molecular weight' was observed, so there was nothing to examine"* does not tell a reader what is
unknown, and paired with a title asserting the compliant state — *"Guest checkout disabled ·
not observed"* — it is genuinely ambiguous between "we could not tell" and "it is not disabled".

**Every `not_evaluable` finding opens with the question it could not answer:**

> Could not verify whether guest checkout is disabled.
> The add-to-cart control was clicked but the cart stayed empty, so the flow never began.

The mechanism, where one exists, follows as a second sentence. Where there is none, the first
sentence stands alone.

### The subject clause

Each rule gains a `subject` field: one clause completing *"Could not verify whether ___"*.

| Rule | `subject` |
|---|---|
| GATE-003 | guest checkout is disabled |
| NAME-001 | products are filed under therapeutic categories |
| PROD-003 | molecular weight is listed |
| FULF-001 | the shipping policy states USA only |

Data, not code. Titles are unchanged — the ambiguity was in the observation sentence, not the title.

### Two forms, and the difference matters

| Case | Opens with |
|---|---|
| Could not be checked on this run | **Could not verify whether** … |
| Cannot be checked from a website at all | **Cannot be verified from a website:** … |

The attestation-shaped rules take the second form. A merchant reading "could not" on something no
crawl could ever establish would reasonably ask why we did not try harder.

### Scope

`not_evaluable` only. Not-met and unclear findings already state what was observed and read
correctly against their titles.


---

## 3 — The brief

A bordered surface below the panel.

```
  Three observations did not meet a standard

  Products hidden until an account exists — anonymous visitors see /shop
  Disclaimer on every sampled page — missing on 5 of 5
  No marketing terms in product names — 2 of 37 matched
```

Title at full weight, the selected summary line following in secondary text on the same line. The
selection rule from D-190 is unchanged — the line is chosen from what the finding already carries
and omitted when nothing qualifies.

**When a stopping condition failed**, the brief still renders its not-met items; the stopping panel
above carries the failure. The two do not compete because they are in different surfaces and the
panel is louder.

**Nothing in the brief instructs.** "Three observations did not meet a standard", never "three
things to change".

---

## 4 — Navigation

Two count cards, in a row: **for your review**, **questions for you**. Each a link to its section,
with a down arrow, in accent text so it reads as interactive.

There is no stopping-conditions card — the panel above is the stopping conditions.

The sticky bar on scroll carries the same two destinations plus a link back to the top. It appears
only once the header block has scrolled away.

**Delete the header-lines block entirely.** The brief and these cards replace it. After this change
the distribution must appear exactly **once** at the top of the document; assert that on all three
reference runs.

---

## 5 — Coverage

One sentence in secondary text under the cards. Unchanged wording, including `not_retrieved` kept
separate from `not_exposed` (D-136, D-158).

---

## 6 — The visual system

Applies to every surface in the document.

### Type

| Element | Size | Weight |
|---|---|---|
| Domain | 24px | 500 |
| Section heading | 21px | 500 |
| Panel / brief heading | 17px | 500 |
| Finding title | 15px | 500 |
| Observation sentence | 13px | 400 |
| Rule id, path, state label | 12px / 11px mono | 400 |

Observation text at 13px with `line-height: 1.6`. The current 11px at tight leading is the single
biggest readability problem and it is not a spacing issue.

### Surfaces

Bordered panels, `0.5px solid var(--border)`, `12px` radius, white on the page background. Content
sits in surfaces; the page does not.

Finding rows live inside a bordered container, divided by `0.5px` hairlines, with **no radius on the
rows themselves** — the container carries the corners.

### State

State is a **3px coloured left edge** on the row, not a badge column:

| State | Edge |
|---|---|
| Not met | danger |
| Unclear | warning |
| Met | none |
| Not observed | none |

The band heading above each group carries the state name in mono small caps with its count, so the
word is stated once per group rather than once per row.

Inside the stopping-conditions panel, state stays a text label — those rows are a checklist, not
findings, and have no left edge.

### Interaction

Every finding row: pointer cursor, full-row click target, a chevron at the right edge, and a hover
that changes the row background to `var(--surface-1)`. A row must be visibly interactive before it
is hovered — the chevron is always present, never revealed on hover.

Focus ring on keyboard focus.

### Colour

Colour does one job: marking state. Titles, body text and headings are never coloured. Accent is
reserved for links and interactive affordances. No colour is added to the palette.

### Print

- No hover, no chevrons, no sticky bar, no cards
- Every row expanded (D-042 as revised by D-166)
- The 3px left edge is retained — it survives greyscale as a tonal band
- Panels keep their borders but lose fills
- Section and band headings repeat across page breaks

---

## 7 — Not in this change

- The eye test, which arrives next as item 4 in the order above
- Finding content, requirement pairs, evidence blocks, the cascade
- The operational questions section, beyond the type scale
- Rule-level coverage recompute

---

## Order of work

1. Delete the header-lines block. Assert the distribution appears once.
2. Stopping conditions panel, both states, at the top.
3. The brief below it.
4. Two navigation cards; sticky bar follows.
5. The type scale and surfaces across all sections.
6. Row state as a left edge; delete the badge column.
7. Row interaction — cursor, hover, chevron, focus.
8. The `subject` clause on every rule, and the not-observed sentence composed from it (§2a).
9. Stopping-condition rows expand and take a comment.
10. Print rules.

Render all three reference runs plus the constructed stopping-failure fixture, screen and print,
with page counts. Build the bundle first — `report-pdf` refuses a stale one (D-187).
