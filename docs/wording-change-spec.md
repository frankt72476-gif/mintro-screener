# Wording change spec — screener aligned to the published RUO standards

Companion to `docs/wording-inventory.md`. Every change below is keyed to the file, line and identifier
that inventory records. Written against inventory as delivered 2026-08-26; if the repo has moved since,
match on the identifier, not the line number.

**Source of truth for all new clause text:** *Research-Use-Only Peptide Programs — Website, marketing,
fulfillment and customer-communication standards*, **v1.1**, August 2026 (the unbranded PDF, reissued
2026-08-26 with PAY-002 reworded — see below). Referred to below as **the standards**, with section marks `§1`–`§10`.

---

## What this pass is, and what it is not

The inventory turned up something that changes the shape of the job. `rules/ruleset.json` names its
source document as `Combined_Peptide_Program_Website_Guidelines_Updated_20260526.pdf`, and D-041 holds
every `clause` byte-identical to that document, rendered verbatim in the **Program requirement** column
of every finding. The screener does not paraphrase the old guidelines — it quotes them, into every
report a merchant, an agent, and IQwallet reads.

So aligning the screener to the new standards is not a copy polish. It is a re-basing of the clause
corpus onto a new source document, and it carries a version bump, a re-pointed audit baseline, and one
rule that has to change hands rather than change wording.

Three rulings follow, then the mechanical replacements.

---

## Ruling 1 — The clause corpus is re-based; D-041 is preserved, not relaxed

`rules/ruleset.json` header changes:

| Field | From | To |
|---|---|---|
| `version` | `2.15.0` | `3.0.0` |
| `effective` | `2026-05-26` | `2026-08-26` |
| source document | `Combined_Peptide_Program_Website_Guidelines_Updated_20260526.pdf` | `RUO Peptide Program Compliance Standards, v1.1 (August 2026)` |

Major version, not minor: the requirement text every finding quotes changes wholesale.

**D-041 stays exactly as written.** The clause remains byte-identical to its source document — the
source document is what changed. To keep that auditable rather than aspirational, commit the standards
text to the repo as `rules/sources/ruo-standards-v1.1.md` and have the `packages/ruleset` validator
assert that each `clause` **on a `source: programme` rule** is a byte-exact substring of that file.
Mintro-authored rules (`source: mintro` — CATG-007, and now PAY-004 under Ruling 2) are exempt by
definition and validated only for presence; the check must be scoped that way or it fails on rules that
were never meant to quote the document. Today the byte-identity guard compares
the rendered requirement to the rule's own `clause` (`apps/worker/test/requirement.test.ts`), which
proves the report faithful to the rule set but proves nothing about the rule set being faithful to the
document. The substring check closes that gap and makes a future re-basing mechanical.

**D-002 is why no back-fill is needed.** Clauses snapshot onto findings at assembly, so completed runs
keep rendering the wording they were produced under. Existing fixtures for the five real runs must
**not** be rewritten — a test asserting fixture clause text equals current ruleset text is asserting
something D-002 says is false, and should be corrected to compare against the run's own snapshot.

**The baseline must be a text original, and the PDF is not one.** Two failure modes, both
confirmed rather than theoretical. Generate `ruo-standards-v1.1.md` from this spec's clause table and
the guard becomes circular — it compares the clauses to themselves, proving the rule set and the spec
agree while proving nothing about either agreeing with the document. Generate it by extracting text
from the issued PDF instead and it fails on typography rather than wording: the embedded fonts map `”`
to U+02EE and `’` to U+02BC, and draw hyphen, parenthesis and plus as private-use code points carrying
no ToUnicode entry, so `BPC-157` extracts as `BPC157`, `-20°C` as `20°C`, `21+` as `21`. Checked
against the issued PDF, that route matches 39 of 53 clauses strictly and 48 after glyph mapping — and a
guard failing 14 times for reasons unrelated to its subject is a guard someone will weaken.

Use the curated `rules/sources/ruo-standards-v1.1.md` shipped alongside this spec. It is generated from
the document source that renders the PDF, so it is a text original rather than a reconstruction, and
its own header records that provenance and warns against regenerating it from the PDF. If the file is
ever lost, regenerate it from the document source — not from the PDF, and not from this table.

**Typography matters here.** The standards use curly quotes (`“ ”`), em dashes (`—`) and a degree sign
(`-20°C`); the old clauses used straight quotes and `-20C`. The new clause strings below carry the
document's characters exactly. Whatever generates `rules/sources/ruo-standards-v1.1.md` must preserve
them, or every substring check fails on invisible differences.

**And `ruo-standards-v1.1.md` must be plain text with emphasis stripped.** The document bolds phrases
mid-sentence — "the **current batch**", "**98% purity for all products**", "in the footer of
**every single page**" — so a markdown export carrying `**` markers breaks byte-identity on markup
rather than on characters, in exactly the clauses that matter most. With emphasis removed, all 53
replacement clauses below are exact substrings of the curated baseline; this was checked mechanically
against the document source, not by eye and not against the PDF's text layer.

**Note for the copy audit:** the new clauses contain directive language — "Never publish…", "Do not
operate…", "Keep a live ban list." That is correct and unchanged in kind. `DIRECTIVE_TERMS` governs
*observations*, never the requirement column; `requirement.test.ts` already scopes the directive check
to the observation side. No guard should start failing on clause text, and if one does, the guard is
mis-scoped rather than the clause.

## Ruling 2 — PAY-004 is reassigned to Mintro authorship, not deleted

```
PAY-004  Risk monitoring plugin installed
source   programme
clause   All merchants are required to use our plugin for additional risk monitoring purposes.
reason   Program requirement, not a regulatory one. Confirm at onboarding.
         Keep separate from FDA-derived findings in the report.
```

The requirement is real — Mintro enforces it — so the rule survives. What cannot survive is its
attribution. As written it sits among the programme-derived rules and quotes a source document that no
longer contains it, in a sentence whose "our" has no referent in a Mintro report: a merchant reads it as
Mintro's plugin, an agent reads it as the processor's, and neither reading is anchored by the text.

Flip it to Mintro authorship, exactly as CATG-007 already does. `source: mintro` makes D-138 render it
under **Mintro observation, not a published standard**, structurally separated from the FDA-derived
findings on the page. The rule's own `reason` field currently asks in prose for that separation
("Keep separate from FDA-derived findings in the report") — under `source: mintro` the layout enforces
it, so the instruction can come out of the prose.

| Field | From | To |
|---|---|---|
| `source` | `programme` | `mintro` |
| `title` | Risk monitoring plugin installed | Risk monitoring integration |
| `clause` | All merchants are required to use our plugin for additional risk monitoring purposes. | Mintro requires the merchants it boards to install and keep active the risk monitoring integration it specifies. This is a condition of the account rather than a requirement drawn from the published standards. |
| `params.reason` | Program requirement, not a regulatory one. Confirm at onboarding. Keep separate from FDA-derived findings in the report. | Not observable from a storefront crawl — installation is confirmed at boarding. Requires merchant attestation. |

Three things the new clause does deliberately. It names Mintro as the party requiring it, so "our" has
a referent. It says *the integration it specifies* rather than *its integration*, which attributes the
requirement without claiming Mintro owns the software. And it does not name the sponsor — per your
call, Mintro states this as its own requirement, which keeps the merchant correctly informed and the
processor out of a document whose whole purpose is to stop implying one.

`check: manual`, `enforcement: review_only` and severity `major` are unchanged. A commercial condition
of the account should never auto-fail a report that otherwise reports FDA-derived observations, and
`review_only` already guarantees that (hard constraint 4).

Counts are therefore unchanged: **55 rules**, `payment` category **4**, `manual` reasons **12**,
attestations **19**. The rule set gains a second `source: mintro` rule alongside CATG-007 — worth
checking that `apps/web/test/reportRequirement.test.ts`, which covers the D-138 heading, exercises both
rather than assuming a single Mintro-authored rule.

## Ruling 3 — "Programme" leaves the merchant-facing vocabulary

Merchant- and agent-facing copy says "the peptide research-use programme rule set" and labels an
authority tier "Programme". A merchant asks the obvious question: *whose* programme? Under the new
posture the answer is a published standard, not somebody's programme. Replace the word in rendered copy
while leaving the `programme` enum value in the data alone — it is an identifier, and D-060's logic
(a rule-set identifier is not something an underwriter reads) applies exactly.

Two additions to merchant-facing copy state Mintro's role plainly, which is the point of the exercise:
the invitation and the comment page both gain *"Mintro reports what it observed; it does not underwrite
the account or decide the outcome."*

Suggested decision records: **D-076** clause corpus re-based on the published standards, D-041
preserved with the baseline re-pointed and scoped to programme-sourced clauses; **D-077** PAY-004
reassigned from programme to Mintro authorship, with the sponsor unnamed; **D-078** merchant-facing
vocabulary moves from "programme" to "standards".

---

## Clause replacements — `rules/ruleset.json`

All 55 rules. `DISC-001` and `CATG-007` are unchanged and listed so the table is complete; PAY-004
carries its Ruling 2 rewrite. Titles are Mintro-authored and stay as they are, PAY-004 excepted.

### Access and identity gating

| Rule | New clause (verbatim from the standards) | § |
|---|---|---|
| GATE-001 | Every visitor must be stopped at the door and affirm they are 21 or older. This happens before products can be viewed — not at checkout. | §1 |
| GATE-002 | Before shopping for or purchasing any product, a visitor must set up an account, provide the institution they are affiliated with, and electronically acknowledge that everything sold on the site is intended for research use. | §1 |
| GATE-003 | There is no anonymous path to purchase. Guest checkout must be turned off entirely. | §1 |
| GATE-004 | The user must actively check “I Agree” against the complete Terms and Conditions. Until they do, account creation cannot proceed. | §1 |
| GATE-005 | When the account is established, the buyer must identify their research status. This is a required field — never optional. | §1 |
| GATE-006 | The selected research field must be stored with every order in your database, not just captured at signup. | §1 |
| GATE-007 | Five points, at minimum: use is restricted to research; human consumption is forbidden; the products play no part in diagnosing, treating or preventing any disease; the buyer indemnifies the seller; and the buyer confirms they are a qualified professional. | §1 |

### Site-wide disclosure

| Rule | New clause | § |
|---|---|---|
| DISC-001 | For research and laboratory use only. Not for human or animal consumption. | §2 |
| DISC-002 | It may not be hidden, shrunk past readability, or tucked inside a collapsed element. | §2 |
| DISC-003 | This sentence belongs in the footer of every single page, set in a legible size. | §2 |

**DISC-001 is unchanged and must stay unchanged.** It is the required disclaimer itself, carried
forward into the standards deliberately and matched verbatim by `textMatch.ts` at line 405. Nothing in
this pass touches it.

### Product page content

| Rule | New clause | § |
|---|---|---|
| PROD-001 | The compound’s exact CAS registry number. | §3 |
| PROD-002 | For example, C62H98N16O22 for BPC-157. | §3 |
| PROD-003 | Expressed in g/mol. | §3 |
| PROD-004 | For example, “Store at -20°C, desiccated.” | §3 |
| PROD-005 | Never publish dosing information of any kind: milligram amounts, frequency, route of administration, or injection schedules. | §5 |
| PROD-006 | Ozempic, Wegovy, Mounjaro, Zepbound and Rybelsus are off limits, as is every other brand name. | §4 |
| PROD-007 | Products cannot be labeled “injectable” or “nasal spray.” These describe how a person would take the product, which makes them administration route claims. | §4 |
| PROD-008 | Nothing on the site may state or imply that a compound treats, cures, prevents or diagnoses a disease or condition of any kind. | §5 |
| PROD-009 | Research papers may not be cited or linked, and neither may off-site material of any kind, where doing so would suggest a benefit to a person or point toward human use. | §5 |
| PROD-010 | Refer to GLP-1 products by chemical name or internal code only — “Semaglutide,” “Tirzepatide.” Never “Sema,” “Tirz,” or similar shorthand. | §4 |

### Naming and taxonomy

| Rule | New clause | § |
|---|---|---|
| NAME-001 | Products cannot be filed under categories such as “Weight Loss,” “Obesity,” “Longevity,” “Cognitive Enhancement,” “Joint Healing” or “Anti-Aging.” | §4 |
| NAME-002 | Names such as “Lean Stack,” “Mass,” “PCT,” “CagriLean,” “Wolverine Peptide” or “Healing Stack” are not permitted. | §4 |
| NAME-003 | Name each product with the compound’s precise chemical name or its formula — nothing else. | §4 |

NAME-003 previously carried the compound mapping (`BPC-157 = …`) inside the clause. In the standards
that mapping is a table, not a sentence, so the clause takes the governing sentence and the mapping
stays where it already lives — `rule.params`, which is what `mapFinding()` reads. No behaviour change;
the requirement column stops quoting a table as if it were prose.

### Catalog composition

| Rule | New clause | § |
|---|---|---|
| CATG-001 | Offering injection supplies next to peptides is itself evidence of intended injection. | §7 |
| CATG-002 | Their obvious purpose is preparing an injection site, which places the sale in a human-injection context. | §7 |
| CATG-003 | Human Chorionic Gonadotropin and Human Growth Hormone both require prescriptions. | §7 |
| CATG-004 | Oral dosage forms are not permitted. | §7 |
| CATG-005 | Bacteriostatic water is permitted when it carries the label “Reconstitution Solution for Laboratory Use.” Keep injection language off the listing, and attach no pharmaceutical brand names such as Pfizer or Hospira. | §7 |
| CATG-006 | Capsules may be sold only where they are exclusively for research use and properly labeled, listed with chemical names and CAS numbers only. Anything short of that is prohibited. | §7 |
| CATG-007 | *unchanged* — Mintro-authored (`source: mintro`), renders under the Mintro heading per D-138 | — |

CATG-004's old clause carried the capsule exception inside the tablets-and-pills rule, which meant two
rules quoted overlapping requirements. The standards separate them, and so does this table.

### Quality documentation

| Rule | New clause | § |
|---|---|---|
| COA-001 | Each product page must link to the COA for the current batch, issued by an accredited independent third-party testing laboratory. | §3 |
| COA-002 | Refresh COAs at least every 60 days. When a new batch arrives, update immediately rather than waiting for the cycle. | §3 |
| COA-003 | A minimum of 98% purity for all products, and every purity figure must be backed by a Certificate of Analysis. | §3 |
| COA-004 | The COA must identify the batch or lot number, the testing date, the compound identity, the purity percentage, and the method used (HPLC preferred). | §3 |
| COA-005 | Each product page must link to the COA for the current batch, issued by an accredited independent third-party testing laboratory. | §3 |
| COA-006 | Each product page must link to the COA for the current batch, issued by an accredited independent third-party testing laboratory. | §3 |

COA-001, COA-005 and COA-006 share one clause, as COA-001 and COA-006 already do today. Three rules
check three different things — the link exists, the lab is accredited, the link serves something
readable — against one sentence of requirement. That is honest, and the titles carry the distinction.

### Fulfillment and screening

| Rule | New clause | § |
|---|---|---|
| FULF-001 | Domestic addresses only. No PO boxes, and nothing crossing the border. | §8 |
| FULF-002 | Domestic addresses only. No PO boxes, and nothing crossing the border. | §8 |
| FULF-003 | Every first-time customer order must require an adult signature on delivery, with 21+ confirmed. | §8 |
| FULF-004 | Include the research-use-only disclaimer and the research-professional acknowledgement in the shipment itself. | §8 |
| FULF-005 | Keep a live ban list. A customer who so much as hints at human consumption is removed for good, with no appeal, and the reason is written down. | §9 |

### Off-site presence

| Rule | New clause | § |
|---|---|---|
| OFFS-001 | Do not operate an affiliate or referral program. | §6 |
| OFFS-002 | Do not post testimonials, before-and-after photos, recovery stories, or user reviews that describe health outcomes. | §5 |
| OFFS-003 | From social profiles and posts, link to the site’s home page and nowhere deeper. | §6 |
| OFFS-004 | Whatever the channel, a post lives under the product-page rules — naming, claims, categories and disclaimers all carry over. | §6 |
| OFFS-005 | Sweep every channel at least once a month, and act on any post found carrying human-use language. | §6 |
| OFFS-006 | Nothing on the site may state or imply that a compound treats, cures, prevents or diagnoses a disease or condition of any kind. | §5 |
| OFFS-007 | Do not operate an affiliate or referral program. | §6 |

OFFS-006's old clause was two sentences welded together — an off-site claim warning attached to a rule
whose `url_pattern` scope is editorial URLs on the merchant's own site. The new clause is the standard
the rule actually tests. Worth a second look separately: a rule about on-site editorial content sitting
in the `offsite` category is a taxonomy question, not a wording one, and this spec does not move it.

### Payments

| Rule | New clause | § |
|---|---|---|
| PAY-001 | To an investigator, a seller collecting through Venmo, Cash App, Zelle or PayPal Friends & Family looks like one sidestepping the fraud controls that come with a standard merchant account. | §10 |
| PAY-002 | Card payments must run through a legitimate merchant processor that performs proper KYC. How a seller collects money is read as evidence of how the business is run. | §10 |
| PAY-003 | Publish a refund and chargeback policy, clearly written and easy to find. | §10 |
| PAY-004 | *Mintro-authored under Ruling 2* — Mintro requires the merchants it boards to install and keep active the risk monitoring integration it specifies. This is a condition of the account rather than a requirement drawn from the published standards. | — |

### Customer communications

| Rule | New clause | § |
|---|---|---|
| COMM-001 | No dosing advice, no administration guidance, and nothing a reader could take as instruction for using a drug — in any channel, by any staff member. | §9 |
| COMM-002 | This standard covers every channel — your FAQ and site copy, email, live chat, phone, and social media direct messages. | §9 |
| COMM-003 | Staff must never offer to help a customer “figure out” a protocol. | §9 |

### Declared boundary — `not_checked[]`

`rules/ruleset.json:192`, `why`. Rendered verbatim in **What was not checked**.

> **From:** Mintro crawls the storefront. It does not follow or read the social media accounts a storefront links to. The programme guidelines name social media as where FDA is actively looking, so nothing in this report speaks to what those accounts contain.

> **To:** Mintro crawls the storefront. It does not follow or read the social media accounts a storefront links to. FDA actively monitors social channels for claims that contradict a seller's own disclaimers, and the standards name off-site marketing as the highest-risk area, so nothing in this report speaks to what those accounts contain.

Corrected 2026-08-26, after `apps/web/test/attestationSection.test.ts` failed on the first attempt. That
test asserts the boundary statement names FDA, and the first replacement dropped the reference — the
guard was right and the replacement was wrong. The first attempt also reintroduced "the programme,"
against Ruling 3, three sections after Ruling 3 removes it.

This string is Mintro's own explanation of a limitation, not a quotation from the standards, so it is
free to name the regulator directly even though the standards themselves say "regulators". Nothing here
touches a clause; `not_checked[].why` is the only field affected. The test's assertion string needs
updating (the wording is no longer "where FDA is actively looking", which was the old document's
phrasing and is deliberately not reused) but its intent — the boundary names the regulator — is
preserved and should stay guarded.

`subject` — "Social media accounts" — is unchanged.

---

## Copy replacements outside the rule set

### `packages/engine/src/copy.ts`

| Line | Key | From | To |
|---|---|---|---|
| 254 | `REQUIREMENT_HEADINGS.required` | Program requirement | Published standard |
| 265 | `REQUIREMENT_HEADINGS.mintroObservation` | Mintro observation, not a program requirement | Mintro observation, not a published standard |

`.observed` and `.notAssessed` are unchanged. These two headings sit beside every quoted clause in every
report, so they are the highest-frequency instance of the word this pass is removing. Because they are
constants rather than component text (the reason they were made constants), this is a two-line change
that lands everywhere — `apps/web/test/reportRequirement.test.ts` will need its expected strings updated.

### `apps/web/src/components/Attestations.tsx`

| Line | Key | From | To |
|---|---|---|---|
| 60 | `AUTHORITY_LABEL.programme` | Programme | Standards |
| 89–91 | `AttestationSection` lede | These are requirements of the programme that a crawl of a website cannot observe. | These are published standards that a crawl of a website cannot observe. |
| 263–267 | `AttestationForm` lede | Some programme requirements are about what happens away from your website — where you ship, what your support team says, who tests your batches. | Some of these standards are about what happens away from your website — where you ship, what your support team says, who tests your batches. |

The rest of both ledes is unchanged, including the sentence carrying the load — *"Nothing in this
section was observed or verified by Mintro."*

### `apps/worker/src/invite.ts`

`body[0]` and `body[1]`, lines 125–126:

> **From:**
> `Mintro screened the public pages of ${merchantDomain} against the peptide research-use`
> `programme rule set, on behalf of the underwriting team reviewing the account.`

> **To:**
> `Mintro screened the public pages of ${merchantDomain} against the research-use-only peptide`
> `standards, on behalf of the underwriting team reviewing the account. Mintro reports what it`
> `observed; it does not underwrite the account or decide the outcome.`

Two lines become three. `body` is an array joined with `\n`, so every index after this shifts by one —
`body[3]`, `body[5]`, `body[7]`, `body[8]`, `body[10]`, `body[11]`, `body[13]` and `body[15]` all move.
Renumber them, and check `apps/worker/test/inviteJob.test.ts`, which asserts on the composed body.

### `apps/web/src/components/CommentPane.tsx`

Lines 387–389, the lede a merchant reads first:

> **From:** The team reviewing your account asked Mintro to screen your public pages against the peptide research-use programme rule set. This is what was observed, with the capture behind each one.

> **To:** The team reviewing your account asked Mintro to screen your public pages against the research-use-only peptide standards. This is what was observed, with the capture behind each one. Mintro reports what it observed; it does not underwrite the account or decide the outcome.

This is the single most valuable sentence in the change set for the problem that started it. It is the
first thing a merchant reads on a page they reached from a forwarded link, and it now says what Mintro
is and is not before the findings begin.

### Everything else in the inventory stays as written

The engine's generated copy — every finding, not-evaluable reason, coverage line, participation record
and commentary state — needs no change. It describes observation and limitation in Mintro's own
vocabulary and never borrows the source document's. `describeAccess`, the four `not_evaluable` bucket
ledes, `UNANSWERED_BODY`, the `NothingObservedCallout`, the D-067 phrasing on the merchant page: all
correct as they stand.

`send.ts:283` — *"Findings state what was observed. They are not compliance determinations."* — is
already doing Ruling 3's work for the IQwallet audience and needs no companion sentence.

---

## Observations — not folded into the change set

Where the standards imply a check the screener does not make. Recorded as observations, per the
project's own rule that findings describe rather than determine; each is a separate decision.

1. **The exact sign-up field label is now published and nothing checks it.** §1 specifies the label
   verbatim — *Field of Qualified Research (required for account set up and purchase)* — and lists six
   example options. GATE-005 checks that a required field beyond the account set exists and reads its
   wording as a judgment; it does not compare the label to the published string. `textMatch.ts` already
   does verbatim comparison for DISC-001 and could do the same here.
2. **The approved support response is published verbatim and nothing compares against it.** §9 carries
   the exact acceptable answer. Attestation `support-dosing-response` asks the merchant what their
   standard response is, in free text, and records it unexamined. Comparing the two is a small check
   with an unusually clean signal.
3. **No sponsored content has no rule.** §6 prohibits paid placements describing these compounds.
   OFFS-001 and OFFS-007 cover affiliate and referral programmes; attestation `influencer-payment`
   covers paying influencers. Sponsored placement sits between them, uncovered.
4. ~~**PAY-002's clause frames card acceptance as a positive signal.**~~ **Resolved 2026-08-26.** The
   clause was reworded in the standards and reissued as v1.1, so it states the requirement rather than
   praising the arrangement: *"Card payments must run through a legitimate merchant processor that
   performs proper KYC. How a seller collects money is read as evidence of how the business is run."*
   The second sentence keeps the signal that pairs it with PAY-001 without the endorsement framing. Use
   the v1.1 PDF as the source document; a v1.0 copy will fail the substring check on this clause alone.
5. **The two facts the inventory itself surfaced** — "Merchant response" as a literal in five places, and
   `describeCommentary` having no render site — are unrelated to this pass and remain open.

---

## Order of work

1. Commit `rules/sources/ruo-standards-v1.1.md`, characters preserved.
2. Apply the clause table and the header change; apply PAY-004's Ruling 2 rewrite (`source`, `title`,
   `clause`, `params.reason`).
3. Apply the four copy changes outside the rule set; renumber `invite.ts` body indices.
4. Extend the `packages/ruleset` validator with the substring check.
5. Update expected strings in `reportRequirement.test.ts`, `requirement.test.ts` and `inviteJob.test.ts`.
   Leave the five run fixtures alone — D-002 makes their old wording correct.
6. Record D-076, D-077, D-078.
