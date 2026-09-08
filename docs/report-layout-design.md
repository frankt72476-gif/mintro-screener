# Report layout and operator review — design memo

Follows D-256 and docs/angle-set-design.md. For ratification before architecture.

## Principle

The reader should know Mintro's view in the first ten seconds and be able to check every sentence
of it against a capture in the next ten minutes. Conclusion first, evidence underneath, checklist
last.

## Masthead

Domain, screened date, published date, rule set version, angle set version, operator name.

Replacement for the approved masthead sentence (the current one says Mintro only records; that is
now false):

> Mintro reviewed the public pages of this site and formed a view of what the business is and
> where it fits. This is Mintro's assessment. The underwriting decision belongs to the team
> reviewing the account.

No counts anywhere on the masthead. The "4 of 16" line goes.

## Sections, in order

### 1. Placement

One line, then one paragraph.

The line is the recommended placement today: **Referred out** / **International** / **Domestic**.

The paragraph is the spectrum placement and the two or three angles that drove it. Spectrum is
stated in words, five positions:

Consumer retail · Consumer-leaning · Mixed · Research-leaning · Research supplier

No bar, no number, no percentage. Words are what an underwriter repeats in a meeting.

### 2. Legality

If clean: one line, "No legality items observed," with the five items listed as checked.

If not: the failing item, its capture, and one sentence. Placement above is fixed at Referred
out and says so. No further remediation language; the memo ends here for practical purposes and
the reader knows it.

### 3. Routing conditions

A five-row table. Condition · Status · Evidence. (Corrected from six by D-260: D-256 named four
conditions and one to be added, and there is no sixth.)

Status is one of **Met** / **Not met** / **Not observable**. Evidence is the capture or the
reason it could not be observed. Order minimum and volume will usually be Not observable from a
crawl; the table says so rather than guessing.

For a research-side merchant, the Not met rows are the domestic path, stated as conditions.
For a consumer-side merchant, the same table appears as fact, with no path language.

### 4. Angles

Seven blocks, in the order of the angle memo. Each block: angle title, lean (**Research** /
**Neutral** / **Consumer**), the paragraph, then the cited evidence as a short list linking to
captures. Heavy evidence carries a marker the reader can see.

An angle with nothing observed says "Nothing observed for this angle" and states why, if the
reason is crawl scope.

### 5. Shore-ups

Present only for merchants placed Research-leaning or Research supplier. Short list, each item
one line with the capture it refers to. Absent entirely for everyone else; the section does not
render as "None."

### 6. Evidence

The existing findings rendering, demoted. Every rule finding with its capture and its published
standard clause (D-041 unchanged). Grouped by category as today. This is the appendix the angles
cite into.

### 7. What was not checked

Unchanged from today. Crawl scope, social accounts, anything declared rather than attested.

## What leaves the report

- Attestation section and the merchant's answers.
- Merchant comment pane and its "Merchant response" states.
- Invitation flow and tokenized merchant links.
- The auto_fail / review_only distinction as a visible label. Rules keep the field in data for
  the validator; the report stops showing it because the reader no longer needs it to interpret
  a finding.

None of this is deleted in code by this design. It stops rendering and stops being offered.
Removal is its own decision.

## Operator review

The AI produces a draft, not a report. The draft has five editable regions matching sections 1
to 5. Sections 6 and 7 are generated and not editable, since they are evidence.

Operator flow:

1. Run completes. Engine produces findings and unbound observations as today, plus the draft.
2. Operator opens the draft. Every AI sentence that cites evidence shows the citation inline;
   clicking it opens the capture. Sentences without a citation are shown with an explicit
   "inference" label the AI must have set, or the validator rejected the draft.
3. Operator edits any of the five regions. The operator can change placement, change a lean,
   rewrite a paragraph, delete a shore-up. Nothing the operator edits can add a citation to a
   capture that does not exist in the run.
4. Operator publishes. Publishing freezes the text as the report for that run. D-002 holds:
   the run is immutable, the published evaluation is immutable, and a re-review produces a new
   published version with its own date and operator name. Earlier versions remain readable.
5. Send path unchanged: same dialog, same subject line convention, same hosted link, IQwallet or
   agent as recipient.

The draft is never sent. Only a published version has a link.

## Audience

One report, one rendering. The agent decides what the merchant sees. IQwallet sees the same
document. No merchant-specific rendering exists under this design.

## Open for ratification

- The masthead sentence.
- Five-position spectrum vocabulary.
- Shore-ups absent, not "None," for consumer-side merchants.
- Auto_fail / review_only label leaving the report.
- Draft is never sendable; only published versions carry links.

Architecture follows: engine changes for unbound observations, the draft generator, the
validator for citations and inference labels, operator UI, and the published-version store.
