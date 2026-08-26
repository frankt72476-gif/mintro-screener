# Peptide programme requirements — authority, state, and severity

Two tables. The first is what a website crawl can observe. The second is what it
cannot, which is roughly two-fifths of the programme and belongs in a questionnaire
to the merchant or agent.

**Authority column** distinguishes where a requirement comes from, which determines
how much negotiating room exists:

- **Law** — statute or regulation. No discretion.
- **Network** — Mastercard BRAM or Visa Integrity Risk Program (VIRP, formerly
  GBPP). Fines land on the acquirer, are passed to the merchant, and a terminated
  merchant enters the five-year database.
- **Programme** — PWW's own requirement. Stricter than law, and the thing an
  acquirer actually enforces.

**State** is what a check can return. Binary facts can fail; judgements go to
review. **Severity** is a separate axis — how much it costs to be wrong.

---

## The controlling doctrine

**21 CFR 201.128** — a product's intended use is determined by objective evidence of
the seller's intent, drawn from labelling, advertising, website copy, product
naming, and surrounding circumstances. Not by the label alone.

That single rule explains why "For research use only" is a necessary condition and
never a sufficient one, and why most of the severe findings below are about
everything *around* the disclaimer rather than the disclaimer itself.

Downstream: a peptide intended for human use is an unapproved new drug under
**21 U.S.C. § 355(a)** and misbranded under **21 U.S.C. § 352(f)(1)**, because it
carries no adequate directions for use.

---

## Table 1 — What the crawl observes

### Gating

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| Age gate, 21+ | Programme | Establishes the buyer is not a general consumer | binary → fail | blocking |
| Catalogue unreachable before the gate | Programme | A gate that can be walked around is evidence the seller knew the rule and did not meet it | binary → fail | **disqualifying** |
| Account required before purchase | Programme | Creates a record of who bought and what they attested | binary → fail | blocking |
| Guest checkout disabled | Programme | Anonymous purchase is inconsistent with qualified-researcher sales | binary → fail | blocking |
| "I Agree" on terms before account creation | Programme | Without express assent the representations are not binding | binary → fail | blocking |
| Research-field selector present and required | Programme | Optional means unanswered; unanswered means unscreened | binary → fail | blocking |
| Selector labelled as specified | Programme | Wording is the attestation | binary → fail | housekeeping |

### Terms content

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| Research-only use restriction | Programme | The seller's stated intent — 21 CFR 201.128 | binary → fail | blocking |
| Prohibition on human consumption | Law-adjacent | Direct rebuttal of human-use intent | binary → fail | blocking |
| Not for diagnosis, treatment or prevention | Law-adjacent | Tracks the drug definition, 21 U.S.C. § 321(g)(1) | binary → fail | blocking |
| Indemnification of seller | Programme | Shifts misrepresentation risk to the buyer | binary → fail | blocking |
| Buyer is a qualified professional | Programme | The representation the whole model rests on | binary → fail | blocking |

### Footer disclaimer

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| Exact RUO text present | Programme | Baseline representation on every page | binary → fail | blocking |
| Present on every page | Programme | A page without it is a page where no claim was made | binary → fail | blocking |
| Not collapsed or hidden | Programme | A disclaimer nobody opens is treated as absent | binary → fail | blocking |
| Legible — size and contrast | Programme | Same reasoning, softer edge | interpretive → review | housekeeping |

### Product pages — required content

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| CAS number present | Programme | Identifies the compound to a chemist, not a consumer | binary → fail | housekeeping |
| CAS number correct for the compound | Programme | A wrong CAS is a labelling defect | binary → fail | blocking |
| Molecular formula | Programme | Spec-sheet content crowds out marketing copy | binary → fail | housekeeping |
| Molecular weight in g/mol | Programme | As above | binary → fail | housekeeping |
| Purity stated | Programme | Substantiated by COA — FTC Act § 5 requires substantiation | binary → fail | housekeeping |
| Storage conditions | Programme | Laboratory handling, not consumer handling | binary → fail | housekeeping |

### Product pages — prohibited content

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| No dosing information | Law | The most direct evidence of human-use intent, 21 CFR 201.128; also supplies the "directions for use" that § 352(f)(1) says an unapproved drug cannot lawfully carry | binary → fail | **disqualifying** |
| No brand names (Ozempic, Wegovy, Mounjaro, Zepbound, Rybelsus) | Law | Human-use claim plus trademark infringement, 15 U.S.C. § 1114 | binary → fail | **disqualifying** |
| No "injectable" or "nasal spray" labelling | Law | Route of administration is a drug attribute, not a chemical one | binary → fail | **disqualifying** |
| No disease claims | Law | Establishes drug status under 21 U.S.C. § 321(g)(1) | interpretive → review | **disqualifying** when clear |
| No study citations implying human benefit | Law | Citation does the work of a claim; FTC Act § 5 on substantiation | interpretive → review | disqualifying when clear |
| No consumer abbreviations ("Sema", "Tirz") | Programme | Community shorthand identifies the intended reader | binary → fail | blocking |

### Naming and categorisation

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| No therapeutic categories (Weight Loss, Longevity, Cognitive Enhancement) | Law | A menu describing outcomes describes intended use — 21 CFR 201.128 | binary → fail | **disqualifying** |
| No marketing product names ("Lean Stack", "Healing Stack") | Law | A stack is a consumer protocol concept | binary → fail | **disqualifying** |
| Proper chemical naming | Programme | The name is the primary claim on the page | binary → fail | blocking |

### Prohibited products and accessories

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| No needles or syringes | Law | Adjacency establishes injection intent no disclaimer rebuts | binary → fail | **disqualifying** |
| No alcohol wipes | Law | Injection-site preparation — same inference | binary → fail | **disqualifying** |
| No HGH | Law | Distribution for non-approved use is a criminal offence, 21 U.S.C. § 333(e) | binary → fail | **disqualifying** |
| No HCG | Law | Prescription drug, 21 U.S.C. § 353(b) | binary → fail | **disqualifying** |
| No tablets or pills | Law | A dosage form for a person | binary → fail | **disqualifying** |
| Bacteriostatic water framed as reconstitution solution | Programme | Framing is what separates a reagent from an injection supply | binary → fail | blocking |
| Capsules named chemically with CAS | Programme | As above | binary → fail | blocking |

### Certificates of analysis

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| COA linked from each product page | Programme | Substantiation for the purity claim — FTC Act § 5 | binary → fail | blocking |
| Batch-specific, not generic | Programme | A generic COA substantiates nothing about the vial sold | binary → fail | blocking |
| Required fields (batch, date, identity, purity, method) | Programme | A COA missing these is not a COA | binary → fail | housekeeping |
| Purity ≥ 98% | Programme | Programme floor | binary → fail | blocking |
| Testing date within 60 days | Programme | Staleness breaks the link to current stock | binary → fail | housekeeping |

### Payment presentation

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| No Venmo, Cash App, Zelle, PayPal F&F | Network | Alternative rails read as evasion of processor controls; transaction laundering is a named BRAM violation | binary → fail | **disqualifying** |
| Refund and chargeback policy documented | Network | Standard acceptance requirement | binary → fail | blocking |

### On-site marketing

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| No testimonials or outcome stories | Law | The seller's claim in a customer's voice, 21 CFR 201.128; endorsement rules at 16 CFR Part 255 | binary → fail | **disqualifying** |
| No before/after imagery | Law | Same, and unambiguous | binary → fail | **disqualifying** |
| Reviews free of health outcomes | Law | A review widget publishes customer claims as the seller's content | interpretive → review | disqualifying when clear |
| No affiliate programme | Programme | Paid promotion the seller cannot control | binary → fail | blocking |
| No sponsored content | Law | Material connection must be disclosed, 16 CFR Part 255 | interpretive → review | blocking |

### Published policy pages

| Requirement | Authority | Why | State | Severity |
|---|---|---|---|---|
| Shipping policy states US-only, no PO boxes | Programme | Stated policy is the seller's position; practice is table 2 | binary → fail | blocking |
| Checkout rejects international addresses | Programme | Policy the site does not enforce is policy in name | partially observable → review | blocking |
| Social links point to home page only | Programme | Deep links carry claims into contexts without disclaimers | partially observable → review | housekeeping |
| FAQ free of dosing or administration guidance | Law | The FAQ is a product page — 21 CFR 201.128 does not distinguish | interpretive → review | **disqualifying** when clear |

---

## Table 2 — What the crawl cannot see

These are real requirements the website says nothing about. Sending them to the
merchant or agent as questions is the right move — with one condition.

**An answer is an attestation, not an observation.** "Yes, we require adult
signature on delivery" is the merchant's statement; Mintro did not see it. It must
be recorded and rendered as an attestation, never as a pass alongside things the
crawl actually observed, and never with a verified badge. An unanswered question is
`not_evaluable`. A declined answer is itself informative and should be recordable as
such.

| Question | Authority | Why it matters | Severity if wrong |
|---|---|---|---|
| Do you ship only within the USA, excluding PO boxes and international addresses? | Programme | Destination is conduct evidence of intended use | **disqualifying** |
| Do you ship to gyms, med-spas, wellness clinics or weight-loss clinics? | Law | Destination type tells FDA the seller knows the end user — 21 CFR 201.128 | **disqualifying** |
| Do first-time orders require an adult signature at 21+? | Programme | The delivery-side counterpart to the age gate | blocking |
| Does the packing slip carry the RUO disclaimer and research acknowledgement? | Programme | The last surface the buyer sees, and often the only one offline | blocking |
| Do you maintain a permanent ban list for customers who indicate human use? | Programme | Continuing to sell after notice converts negligence into knowledge | **disqualifying** |
| Are bans documented and permanent, with no appeal? | Programme | An undocumented ban is unprovable | blocking |
| Do support staff ever provide dosing, administration or protocol guidance — by email, chat, phone or DM? | Law | Same doctrine as the product page; the surface does not matter | **disqualifying** |
| What is your standard support response to a dosing question? | Law | A scripted refusal is evidence of a controlled process | blocking |
| Do staff offer to help customers "figure out" protocols? | Law | Consultation is prescribing | **disqualifying** |
| Do any social accounts contain human-use claims, testimonials or outcome stories? | Law | FDA monitors social platforms; off-site claims are used against the seller regardless of on-site disclaimers | **disqualifying** |
| Do you pay or barter with influencers? | Law | Paid promotion is the seller's speech; 16 CFR Part 255 disclosure | **disqualifying** |
| How often are social channels audited, and by whom? | Programme | Monthly minimum; an unaudited channel is an uncontrolled one | blocking |
| Do you monitor third-party brand mentions and issue cease-and-desist notices? | Programme | Notice without response becomes acquiescence | housekeeping |
| Is your COA lab independent and accredited? Which accreditation? | Programme | Not observable from a certificate | blocking |
| How often do you receive new batches, and how quickly are COAs updated? | Programme | The 60-day rule is about current stock, not the page | housekeeping |
| Do you accept payment through any channel other than card processing? | Network | Alternative rails may exist without appearing on the site; transaction laundering is a named BRAM violation | **disqualifying** |
| Do you operate any other storefronts, brands or domains selling the same products? | Network | Undisclosed related sites are transaction laundering | **disqualifying** |
| Do you store the declared research field with every order? | Programme | An attestation nobody records is an attestation nobody can produce | blocking |
| Has any acquirer, processor or platform terminated you? | Network | MATCH listing and prior termination history | **disqualifying** |

---

## Two things worth noting

**The programme's own critical risk area is the least visible one.** Social media
is where the guidelines say FDA is actively looking, and a website crawl finds the
links and does not follow them. That belongs in the report's not-checked section
explicitly, not left as silence an underwriter fills in.

**Report language stays narrower than this document.** Explaining that 21 CFR
201.128 establishes intended use from surrounding content is useful to an agent
deciding what to fix. A finding says what the page shows and which requirement it
relates to — "this page displays dosing information; the programme prohibits dosing
information." Characterising the merchant's exposure is a determination and belongs
to the underwriter.
