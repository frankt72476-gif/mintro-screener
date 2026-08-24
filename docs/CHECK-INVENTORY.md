# Check inventory — Documents Check

**Accepted by D-102 on 2026-08-24.** §8's first two items were settled there; the
remaining three are recorded as open rather than resolved.

This is the source for the two rule files D-101 establishes, and per constraint 1 the
checks live as data — adding one never touches the engine:

- **`rules/documents.checks.json`** — the check definition shape (§1) and the checks
  themselves (§6), the document catalog with its `examined` / `collected_only` flags
  (§3), and the reason enumerations (§5).
- **`rules/documents.templates.json`** — the per-processor required slot sets with
  their counts and coverage rules (§4), and the D-081 conditionals.

`rules/documents.json`, this document's original single-file reference, is superseded
by those two and does not exist.

This document also becomes the report's transparency section. A check that exists
here can be listed in the report whether or not it ran, which is the mechanism by
which "we did not check X" is visible rather than absent.

Governing decisions: D-001 (observations, never determinations), D-009 (four states,
severity does not touch state), D-076 through D-116.

---

## 1. How a check is defined

Every check carries six properties. These become the JSON schema.

| Property | Meaning |
|---|---|
| `id` | Stable identifier, family-prefixed |
| `reads` | Document slots and fields it consumes |
| `compares` | What is set against what |
| `states` | Which of fail / review / pass it can return |
| `not_evaluable_when` | Named conditions, always enumerated |
| `release` | `v1` or `deferred` |

**There was a seventh, `evidence_tier`, and it is gone (D-116).** A finding's tier is the weaker of
the documents *actually* read (§2), and §3 marks several types `mixed` — so a check reading the
application, an EIN letter and a W-9 has no static value that is true. It was redundant where
derivable and false where not. The tier now lives on the catalog entry, where it describes a
document, which is a thing that has one; the finding's tier is computed, as §2 always specified.

### The two-source rule

**A consistency check with one source present returns `not_evaluable`, never `pass`.**

If the EIN appears on the application and nowhere else, C-03 has nothing to compare
and has established nothing. Returning `pass` because the single value it found was
well-formed is the constraint 9 failure exactly: a check that locates its subject by
matching the compliant form is blind to every non-compliant instance. Same shape,
one layer up.

This is the most load-bearing line in the document. Every check in family C is
subject to it.

### fail versus review

D-009 forbids severity from touching state, so the line cannot be importance. It is
**exactness of the comparison**:

- **`fail`** — the comparison is exact and a mismatch cannot be innocent. Digit
  strings (EIN, routing, account), dates against a threshold (expiry, recency),
  slot presence, arithmetic (ownership sums).
- **`review`** — the comparison is fuzzy and a mismatch is often innocent. Names
  ("Acme Foods LLC" / "Acme Foods, L.L.C."), addresses (suite formatting, USPS
  abbreviation), derived-versus-stated figures, which are estimates by nature.

A routing number that differs by one digit is a `fail` even though it is probably a
typo. A legal name that differs by a comma is a `review` even though it is probably
nothing. That asymmetry is intentional and it is about what the comparison can
support, not about how much the field matters.

### Normalization

Names and addresses are normalized before comparison and the normalization is shown
in the evidence. Raw differs, normalized matches → `pass`, with both forms
displayed. Normalized differs → `review`. Normalization is local; no USPS call, no
vendor.

---

## 2. Evidence tiers — consequence of D-087

D-087 requires four elements: document version, page, location within the page,
verbatim snippet. Not every extraction path can supply all four, and the report must
not present unequal evidence as equal.

| Tier | Source | Elements | Report shows |
|---|---|---|---|
| `character` | AcroForm fields (D-089), PDF text layer | All four | Field name or exact text location, verbatim snippet |
| `page` | Vision (D-093, D-095) | Version and page only | Page image plus extracted value |

Vision cannot supply location or snippet without being asked to attest to its own
provenance, which D-095 rules out. So a vision-sourced value is **structurally
incapable** of full D-087 compliance, and the honest response is to mark it rather
than to pretend otherwise.

**A check whose inputs span both tiers reports at the weaker tier.** An EIN
comparison between an AcroForm application and a photographed EIN letter is
page-tier, because the observation is only as good as its weakest side.

Practical consequence worth noting to the underwriter: the anchor document is
usually an AcroForm, so the application side of most comparisons is character-tier.
It is the merchant's supporting documents — IDs, voided checks, scanned EIN letters
— that pull observations down to page tier.

---

## 3. Document catalog and the D-082 assignment

**Needs your review.** The examined column is my judgment of what Mintro should
actually read versus merely collect, and I am guessing at current practice.

### Examined

| Document | Yields | Typical tier |
|---|---|---|
| Pre App / Existing App | ~40 fields — anchor document | character (AcroForm) |
| EIN Letter (CP-575 / 147C) | EIN, legal name, address | page (usually scanned) |
| Articles of Incorporation / Organization | Legal name, entity type, state, formation date | mixed |
| DBA / fictitious name filing | DBA, legal name, filing state | mixed |
| Voided Check | Routing, account, account holder, bank name | page (photo) |
| Bank Statement | Period, account, routing, holder, bank, deposits | character (usually text-layer) |
| Processing Statement | Period, volume, ticket, count, chargebacks, refunds, processor | character |
| Owner Photo ID | Name, DOB, expiry, address | page (photo) |
| W-9 | Legal name, DBA, EIN, tax classification | mixed |
| W-8BEN | Name, country, TIN | mixed |
| Business License | Licensee name, jurisdiction, type, expiry | mixed |
| Proof of Business Address | Address, addressee | mixed |
| Proof of domain name ownership | Registrant, domain | mixed |

### Collected only — present, not examined

Fulfillment Policy Document · Product/Service Description Document · 501(c) Letter ·
Third-Party Fulfillment Agreement (Executed) · Other Shipping/Fulfillment Agreements
(Executed) · Additional Document · COAs

Two notes. **501(c) Letter** carries an EIN and legal name and could be examined; I
have it collected-only because it is rare enough that the extraction work is hard to
justify in v1. Move it if nonprofits are more common than I assume. **COAs** are
examined by Site Check under its own rules; duplicating that here would produce two
findings on one artifact.

**Additional Document requires an analyst-supplied label at the point of adding.**
Otherwise the report line reads "Additional Document: satisfied," which tells the
agent nothing.

---

## 4. Slots — counts and coverage (D-080, D-113)

| Slot | Count | Coverage | Default |
|---|---|---|---|
| Bank Statement | 3 | 3 consecutive calendar months (D-113) | on |
| Processing Statement | 3 | 3 consecutive calendar months (D-113) | on |
| Owner Photo ID | = owners ≥ 25% on app | expiry after run date | on |
| Voided Check | 1 | — | on |
| Pre App / Existing App | 1 | — | on |
| EIN Letter | 1 | — | on |
| Articles of Incorporation | 1 | — | conditional (D-081) |
| W-9 | 1 | — | conditional — US-domiciled (D-081, D-111) |
| W-8BEN | 1 | — | conditional — not US-domiciled (D-081, D-111) |
| Proof of domain name ownership | 1 | — | on |
| Business License | 1 per named instance | expiry after run date | off, operator-added (D-112) |
| All others | 1 | — | off |

### Freshness is the last complete calendar month (D-113)

**The 45-day window this section was drafted with is superseded**, and D-102's third open item is
closed with it.

    required month = the last calendar month ending on or before (run date − grace)
    grace          = 10 days, configurable per slot

A run on 3 May asks for March; a run on 15 May asks for April. Three consecutive months work
backward from there. A day count measured from an instant unrelated to how statements are produced,
so the same merchant was compliant or not depending on which day they applied.

A statement period satisfies a required month when **a majority of the period's own days** fall in
it — cycles are not calendar months, so 12 March – 11 April is a March statement. Where no month
holds a majority, the period satisfies none: picking one would infer something the document does
not say.

**10 days is Claude's figure, not measured.** It is the first thing to move if anyone finds out
when processors actually issue.

### One clock (D-109)

Coverage measures against the **run's timestamp**, and the verdict is computed wherever it is read
rather than stored. There is no second evaluation and no check for one: **B-06 was withdrawn by
D-117.** What it protected — that a report generates from a run created at send time, never from a
stale one — is a precondition on report generation, enforced in M5. It is not a finding the engine
produces, because nothing the engine can see distinguishes a fresh run from an aged one.

### Counts

Owner Photo ID count comes from the application's ownership section. If that section cannot be
extracted, the count is unknown and the slot is `not_evaluable`, not `missing` — we do not know how
many IDs to expect, so we cannot say any are absent (D-107).

A slot is `satisfied` only when its count is met; below that it is `missing`, because one of three
is chase-this. State carries the action, count carries the numbers (D-110).

**There are no variable-count slots** (D-112). Business License is off by default and an operator
adds named instances, each with a count of 1 and the `added` origin. A `0..n` slot cannot tell "no
licence required" from "no licence supplied" — both are a satisfied row. No slot at all versus a
missing named slot says which is which.

---

## 5. Reason enumerations (D-079)

**Needs your correction.** A fixed list with a gap in it leaves an analyst no honest
way to resolve a slot, so an incomplete enumeration is worse here than elsewhere.

### Not provided — the requirement stands, the document does not exist

1. New business — no prior processing history
2. Prior processing was cash or check only
3. Prior processor will not release statements
4. Account closed — records no longer available
5. Document does not exist for this entity type
6. Issuing authority will not reissue
7. Lost or destroyed, cannot be reissued
8. Provided directly to processor outside this package
9. Merchant declines to provide

Nine is uncomfortable to look at, which is why it should exist. An analyst with no
way to record refusal will record something else.

### Waived — the requirement was removed

1. Processor confirmed not required
2. Not applicable to this entity type
3. Superseded by another document in this package
4. Provided under a prior package for this merchant

### Open question — "applied for, not yet issued"

This does not fit either list. The document will exist, so it is not `not_provided`;
the slot is still actionable, so it belongs in `missing`. But `missing` carries no
reason field, and an agent reading "missing" on a license that was filed last week
will chase something already in motion. Three ways out: a sixth slot state, a reason
field on `missing`, or accept the noise. This is a workflow question, so it is yours.

---

## 6. The checks

Release column: `v1` builds now, `def` deferred. **38 checks, 35 in v1** — A:7, B:5, C:20, D:6,
with C-20, D-05 and D-06 deferred. This line read "31 checks, 24 in v1" until M2 transcribed the
tables and counted them; the tables were right and are the content, so the header was corrected to
match rather than the other way round. It read "39 checks, 36 in v1" until D-117 withdrew B-06.
`documents.test.ts` pins the number, so the two cannot drift again in silence.

### Family A — Document integrity (per document)

| ID | Check | States | not_evaluable when | Rel |
|---|---|---|---|---|
| A-01 | Document yields readable content by at least one path | fail / pass | never — see note | v1 |
| A-02 | Declared page range complete ("page N of M") | fail / pass | no page numbering found | v1 |
| A-03 | PDF not password-protected | fail / pass | never | v1 |
| A-04 | Document carries markers of its declared type | review / pass | no marker set defined for type | v1 |
| A-05 | Required signature and date present | fail / pass | signature block not located | v1 |
| A-06 | Expiry date after run date (ID, license) | fail / pass | expiry not extracted | v1 |
| A-07 | Issue or statement date within slot window | fail / pass | date not extracted | v1 |

**A-01 is never `not_evaluable`, and this matters.** We attempted the read and the
attempt is the observation — unreadability is a fact we established, so it is `fail`
on A-01. It is then a named `not_evaluable` cause for every downstream check. Under
D-092 the file resolves to a recorded outcome either way; nothing is stamped without
a persisted result.

**A-04 is deliberately weak.** No classifier exists (survey §7) and I am not building
one for v1. This confirms that a document uploaded to the EIN Letter slot contains
IRS CP-575 or 147C markers. It catches the merchant who uploaded a W-9 into the wrong
slot. It does not catch a forgery and should never be described as if it does.

### Family B — Package completeness

| ID | Check | States | not_evaluable when | Rel |
|---|---|---|---|---|
| B-01 | Every required slot resolved (satisfied / not_provided / waived) | fail / pass | never | v1 |
| B-02 | Slot count satisfied | fail / pass | required count unknown | v1 |
| B-03 | Period documents consecutive, no gaps | fail / pass | periods not extracted | v1 |
| B-04 | Most recent period within coverage window at run | fail / pass | periods not extracted | v1 |
| B-05 | Conditional slot predicates resolved | review / pass | predicate inputs not extracted | v1 |

**B-06 was withdrawn — do not re-add it. See D-117.** It was specified to re-evaluate freshness at
report generation, which D-109 collapsed into one clock; at engine level it then reduced to B-04
asked a second way. The hazard it guarded against is real — statements fresh at upload are not
fresh eight weeks later, and the figure that matters is the one true when the report goes out — but
it is a precondition on generating a report from a stale run, enforced in M5, not an observation
about documents. The id is retired and not reused.

### Family C — Internal consistency (cross-document)

All subject to the two-source rule **except C-14** — see below. All `review` unless marked.

| ID | Check | Reads | State | Rel |
|---|---|---|---|---|
| C-01 | Legal name | App, EIN letter, Articles, bank stmt, voided check, W-9 | review | v1 |
| C-02 | DBA name | App, DBA filing, bank stmt, voided check | review | v1 |
| C-03 | EIN digits | App, EIN letter, W-9 | **fail** | v1 |
| C-04 | Business address | App, EIN letter, Articles, proof of address, bank stmt | review | v1 |
| C-05 | Entity type | App, Articles, W-9 classification box | review | v1 |
| C-06 | State of formation | App, Articles | review | v1 |
| C-07 | Formation date | App, Articles | review | v1 |
| C-08 | Routing number | App, voided check, bank stmt | **fail** | v1 |
| C-09 | Account number | App, voided check, bank stmt | **fail** | v1 |
| C-10 | Routing number resolves to a bank, name agrees | FRB directory, voided check, bank stmt | review | v1 |
| C-11 | Account holder name matches legal name or DBA | Voided check, bank stmt, app | review | v1 |
| C-12 | Owner names on IDs match app ownership section | IDs, app | review | v1 |
| C-13 | ID count matches owners ≥ 25% | IDs, app | **fail** | v1 |
| C-14 | Ownership percentages sum ≤ 100 | App | **fail** | v1 |
| C-15 | Signer appears as owner or officer | App, Articles | review | v1 |
| C-16 | Owner DOB matches ID | IDs, app | **fail** | v1 |
| C-17 | Domain registrant matches legal name or DBA | Proof of domain, app | review | v1 |
| C-18 | Stated prior processor matches statement letterhead | App, processing stmt | review | v1 |
| C-19 | Not-provided reason consistent with other evidence | Slot reason, app, bank stmt | review | v1 |
| C-20 | Owner residential address matches ID | IDs, app | review | def |

**C-14 is the one check the two-source rule does not bind (D-116).** It sums the ownership
percentages on the application and checks the total is no more than 100 — arithmetic *within one
document*. There is no second source, there never will be, and requiring one would leave the check
permanently `not_evaluable`: a rule that can never fire, which is worse than an absent rule because
it looks like coverage. It carries `ownership_section_not_extracted` instead.

The rule binds where its reasoning reaches. D-098 is about *comparison* — a check confirming a lone
value is blind to every disagreement it never saw. C-14 compares nothing across sources, so a second
copy of the application would tell it nothing.

**C-10 is the only external check in v1**, and it is free — the Federal Reserve
E-Payments routing directory is a public download. It confirms the routing number
resolves to a real institution and names it, which can then be set against the
letterhead. It confirms nothing about the account.

**C-19 is the check your startup case created.** If the reason recorded is "new
business — no prior processing history" but the application names a prior processor,
or the bank statements show card-processor deposits, that is a discrepancy worth
surfacing. Both sides are already in hand; it costs nothing.

**C-20 deferred** — people move, and the residential address on an ID is stale often
enough that the finding would be noise more often than signal.

### Family D — Derived figures

Every one of these reports the derived value, the stated value, and the derivation
with source pages. Never a judgment about the gap.

| ID | Check | States | not_evaluable when | Rel |
|---|---|---|---|---|
| D-01 | Derived monthly volume vs stated | review / pass | no processing stmts | v1 |
| D-02 | Derived average ticket vs stated | review / pass | no processing stmts | v1 |
| D-03 | Derived high ticket vs stated | review / pass | high ticket not itemized | v1 |
| D-04 | Derived chargeback rate vs stated | review / pass | chargebacks not itemized | v1 |
| D-05 | Derived refund rate | review / pass | refunds not itemized | def |
| D-06 | Bank deposits reconcile to processing net deposits | review / pass | either side unreadable | def |

Where processing statements are `not_provided`, all of these return `not_evaluable`
and **carry the recorded reason through to the report** — "not evaluated: no
processing statements, new business." That is the honest rendering and it is why
D-078 kept `not_provided` distinct from `waived`.

**No trend or seasonality analysis in any release.** Low pre-screen value, and it is
the one derived output that reads as an opinion no matter how it is phrased.

---

## 7. What is not checked, and why

This section renders in the report verbatim. It is a feature, not a disclaimer.

| Not checked | Why |
|---|---|
| EIN exists at IRS and maps to this business | No free API; TIN Matching requires 1099-filer standing. Vendor spend, out of scope (D-093) |
| Entity is in good standing with the Secretary of State | Fifty state sources; vendor spend or fifty scrapers, both refused |
| Bank account is open and belongs to the merchant | Requires Plaid or similar; declined on cost |
| Document authenticity | No mechanism exists at any price from the document alone |
| Sanctions and watchlist screening | Free list, but untuned name matching produces false positives that erode trust faster than absent checks |
| Marketing and advertising material | Collected only, per your instruction |
| Anything reached by Site Check | Handled there; duplicating produces two findings on one artifact |

---

## 8. Open for you

1. **Examined versus collected-only** (§3) — my guess at current practice.
2. **Not Provided reason list** (§5) — fixed under D-079, so gaps are costly.
3. ~~**The 45-day window** (§4)~~ — **closed by D-113**: freshness is the last complete calendar month, with a configurable grace (10 days, unmeasured).
4. **"Applied for, not yet issued"** (§5) — sixth slot state, reason on `missing`,
   or accept the noise.
5. **DBA filing** — not on your screenshot list. Without it, C-02 can only compare
   the application to itself on the DBA side.
