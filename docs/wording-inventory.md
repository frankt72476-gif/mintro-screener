# Wording inventory — peptide / RUO screening path

Every string in the peptide/RUO screening path that a **merchant**, their **agent**, or **IQwallet**
can read. Grouped by source file, in the order the text is produced: the rule set first, then the
engine that writes findings from it, then the worker that mails them, then the surfaces that render
them.

This is an inventory. Nothing here is a proposal and no copy or code was changed to produce it.

## Why this exists

The copy in this path carries the project's legal posture, and that posture lives in wording rather
than in structure. Hard constraint 7 and D-001 say findings describe and never instruct; D-041 says
the requirement column is verbatim; D-044 says an unevaluated rule states *whose* limitation it is;
D-063 says a merchant's words are always attributed and never characterised; D-067 says the merchant
page never counts silence back at them. Each of those is enforced somewhere in the strings below, and
until now there was no single place to read them side by side.

## Scope

**In:** anything reachable by a merchant, an agent holding a forwarded comment link, or an
underwriter reading the report or its PDF.

- Rule set data — category names, rule titles, rule clauses, `manual` reasons, attestation questions,
  the declared not-checked boundary.
- Finding and observation templates produced by the engine's check handlers and layer runners.
- Report copy — headings, section ledes, coverage wording, state labels, evidence-slip labels.
- The merchant comment page and its attestation form.
- Outbound mail — the merchant invitation and the IQwallet report covering message.
- Database functions the merchant page calls, whose `reason` strings are shown to the merchant.

**Out**, and listed here so the boundary is explicit rather than assumed:

| Not inventoried | Why |
|---|---|
| Documents Check (`rules/documents.*.json`, `packages/engine/src/documents/`, `apps/web/src/components/Documents*.tsx`, `apps/worker/src/documents*.ts`) | A separate programme with its own check families and its own report. Not the peptide/RUO path. |
| Retention and export panel (`RetentionPanel.tsx`, `ExportControls.tsx`, `apps/worker/src/export/`) | Operator-only surface. Never rendered to a merchant, an agent or IQwallet. |
| Analyst workspace chrome — `SignIn.tsx`, `Rail.tsx`, `PastReports.tsx`, `RuleSetPane.tsx`, `CredentialModal.tsx`, `SendModal.tsx`, `InviteModal.tsx`, `ScanInput`/`ScanProgress` in `App.tsx` | Behind the analyst gate. A merchant has no account and the merchant route renders none of it (D-066). |
| `screenStorefront` progress lines (`apps/worker/src/screen.ts`) | Console output for the operator running a scan. Uses layer vocabulary deliberately; `describeAccess` in the same file is the part that reaches the report and **is** inventoried. |
| `packages/engine/src/suspicion.ts` explanations | Feed product-page sampling. Never attached to a finding. |
| `packages/engine/src/sitemap.ts` parse reasons | Recorded on `documents[].error` for diagnostics. What reaches a reader is `discoverLayer0`'s `unusableReason`, which **is** inventoried. |
| `packages/engine/src/copy.ts` term lists — `DIRECTIVE_TERMS`, `DETERMINATION_TERMS`, `INTERNAL_TERMS` | Vocabulary the build audits output *against*. Not output. `REQUIREMENT_HEADINGS` from the same file **is** output and is inventoried. |
| `demo/index.html` | The design specification (D-004). Its copy is placeholder — "31 of 40" is called out in `ReportView.tsx` as exactly that. Nothing ships from it. |

## How to read it

- **Line** is the line the string literal begins on.
- **Key** is the identifier, constant, object key or function that owns it. Where a message is
  assembled from several adjacent literals, the line range is given and the literals are joined as
  the source joins them.
- **String** is the literal's content exactly as written in the file, `${…}` placeholders and escape
  sequences included. Where a string is a template, the placeholder names are what tell you what the
  reader actually sees.

Counts: **55 rules** (title + clause, plus 12 `manual` reasons), **19 attestation questions**,
**10 category names**, **1 declared boundary**, and the generated and rendered copy below.

---

## `rules/ruleset.json`

Version `2.15.0`, effective `2026-05-26`, source document
`Combined_Peptide_Program_Website_Guidelines_Updated_20260526.pdf`.

The single source of truth (hard constraint 1). Titles and clauses are snapshotted onto every
finding at assembly time, so a report reopened later renders the wording it was produced under
(D-002). Clauses are rendered **verbatim** in the Program requirement column and audited for being
byte-identical (D-041) — a whitespace-only difference fails the build.

`CATG-007` is the one rule whose `source` is `mintro` rather than `programme`; its clause renders
under a different heading for that reason (D-138).

#### Category names

Rendered as the section heading of each report category, and as the two-digit index beside it.

| Line | Key | String |
|---|---|---|
| 16 | `categories[0].name` — id `gate`, prefix `GATE` | Access and identity gating |
| 22 | `categories[1].name` — id `disclose`, prefix `DISC` | Site-wide disclosure |
| 28 | `categories[2].name` — id `product`, prefix `PROD` | Product page content |
| 34 | `categories[3].name` — id `naming`, prefix `NAME` | Naming and taxonomy |
| 40 | `categories[4].name` — id `catalog`, prefix `CATG` | Catalog composition |
| 46 | `categories[5].name` — id `coa`, prefix `COA` | Quality documentation |
| 52 | `categories[6].name` — id `fulfil`, prefix `FULF` | Fulfillment and screening |
| 58 | `categories[7].name` — id `offsite`, prefix `OFFS` | Off-site presence |
| 64 | `categories[8].name` — id `payment`, prefix `PAY` | Payments |
| 70 | `categories[9].name` — id `comms`, prefix `COMM` | Customer communications |

#### Attestation questions

| Line | Key | String |
|---|---|---|
| 76 | `attestations[shipping-destinations].question` — programme, critical | Do you ship only within the USA, excluding PO boxes and international addresses? |
| 82 | `attestations[shipping-to-clinics].question` — law, critical | Do you ship to gyms, med-spas, wellness clinics or weight-loss clinics? |
| 88 | `attestations[adult-signature].question` — programme, major | Do first-time orders require an adult signature at 21+? |
| 94 | `attestations[packing-slip-disclaimer].question` — programme, major | Does the packing slip carry the RUO disclaimer and research acknowledgement? |
| 100 | `attestations[ban-list].question` — programme, critical | Do you maintain a permanent ban list for customers who indicate human use? |
| 106 | `attestations[ban-list-permanence].question` — programme, major | Are bans documented and permanent, with no appeal? |
| 112 | `attestations[support-dosing-guidance].question` — law, critical | Do support staff ever provide dosing, administration or protocol guidance — by email, chat, phone or DM? |
| 118 | `attestations[support-dosing-response].question` — law, major | What is your standard support response to a dosing question? |
| 124 | `attestations[staff-protocol-help].question` — law, critical | Do staff offer to help customers "figure out" protocols? |
| 130 | `attestations[social-account-content].question` — law, critical | Do any social accounts contain human-use claims, testimonials or outcome stories? |
| 136 | `attestations[influencer-payment].question` — law, critical | Do you pay or barter with influencers? |
| 142 | `attestations[social-audit-cadence].question` — programme, major | How often are social channels audited, and by whom? |
| 148 | `attestations[brand-mention-monitoring].question` — programme, minor | Do you monitor third-party brand mentions and issue cease-and-desist notices? |
| 154 | `attestations[coa-lab-accreditation].question` — programme, major | Is your COA lab independent and accredited? Which accreditation? |
| 160 | `attestations[coa-batch-cadence].question` — programme, minor | How often do you receive new batches, and how quickly are COAs updated? |
| 166 | `attestations[payment-channels].question` — network, critical | Do you accept payment through any channel other than card processing? |
| 172 | `attestations[related-storefronts].question` — network, critical | Do you operate any other storefronts, brands or domains selling the same products? |
| 178 | `attestations[research-field-storage].question` — programme, major | Do you store the declared research field with every order? |
| 184 | `attestations[prior-termination].question` — network, critical | Has any acquirer, processor or platform terminated you? |

#### Declared boundary

| Line | Key | String |
|---|---|---|
| 191 | `not_checked[].subject` | Social media accounts |
| 192 | `not_checked[].why` | Mintro crawls the storefront. It does not follow or read the social media accounts a storefront links to. The programme guidelines name social media as where FDA is actively looking, so nothing in this report speaks to what those accounts contain. |

#### Rule titles, clauses, and manual-rule reasons

| Line | Key | String |
|---|---|---|
| 203 | `GATE-001.title` — gate, major, review_only, `dom_assert`, source `programme` | Age affirmation before entry |
| 204 | `GATE-001.clause` | Every visitor must be stopped before accessing the website. This requires age affirmation (21+). |
| 229 | `GATE-002.title` — gate, critical, auto_fail, `http_probe`, source `programme` | Products hidden until an account exists |
| 230 | `GATE-002.clause` | All visitors prior to shopping for or purchasing any product must set up an account. |
| 255 | `GATE-003.title` — gate, critical, auto_fail, `flow_probe`, source `programme` | Guest checkout disabled |
| 256 | `GATE-003.clause` | Guest checkout must be disabled. |
| 271 | `GATE-004.title` — gate, major, review_only, `dom_assert`, source `programme` | Terms acknowledged at sign-up |
| 272 | `GATE-004.clause` | Users must acknowledge 'I Agree' on the full Terms and Conditions before account creation. |
| 294 | `GATE-005.title` — gate, major, review_only, `dom_assert`, source `programme` | Research field required at sign-up |
| 295 | `GATE-005.clause` | Require the buyer to identify their research status. This must be a required field, not optional. |
| 319 | `GATE-006.title` — gate, major, review_only, `manual`, source `programme` | Research field stored with each order |
| 320 | `GATE-006.clause` | Store the selected field with every order in your database. |
| 323 | `GATE-006.params.reason` | Order records are server-side. Requires merchant attestation. |
| 333 | `GATE-007.title` — gate, major, review_only, `text_match`, source `programme` | Terms cover all required clauses |
| 334 | `GATE-007.clause` | Research-only use restriction; prohibition on human consumption; not for diagnosis/treatment/prevention; indemnification of the seller; buyer is a qualified professional. |
| 354 | `DISC-001.title` — disclose, critical, review_only, `text_match`, source `programme` | Footer disclaimer wording |
| 355 | `DISC-001.clause` | For research and laboratory use only. Not for human or animal consumption. |
| 370 | `DISC-002.title` — disclose, critical, auto_fail, `computed_style`, source `programme` | Footer disclaimer is legible |
| 371 | `DISC-002.clause` | In legible font, not hidden or collapsed. |
| 388 | `DISC-003.title` — disclose, critical, auto_fail, `dom_assert`, source `programme` | Disclaimer on every sampled page |
| 389 | `DISC-003.clause` | Must appear in the footer of every page of the website. |
| 405 | `PROD-001.title` — product, major, review_only, `text_match`, source `programme` | CAS number listed |
| 406 | `PROD-001.clause` | Exact Chemical Abstracts Service registry number for the compound. |
| 423 | `PROD-002.title` — product, major, review_only, `text_match`, source `programme` | Molecular formula listed |
| 424 | `PROD-002.clause` | e.g. C62H98N16O22 for BPC-157. |
| 443 | `PROD-003.title` — product, minor, review_only, `text_match`, source `programme` | Molecular weight listed |
| 444 | `PROD-003.clause` | Expressed in g/mol. |
| 465 | `PROD-004.title` — product, minor, review_only, `text_match`, source `programme` | Storage conditions listed |
| 466 | `PROD-004.clause` | e.g. 'Store at -20C, desiccated.' |
| 487 | `PROD-005.title` — product, critical, review_only, `text_cooccurrence`, source `programme` | No dosing information |
| 488 | `PROD-005.clause` | Never include dosing information (mg, frequency, route of administration, injection schedule). |
| 522 | `PROD-006.title` — product, critical, auto_fail, `text_match`, source `programme` | No pharmaceutical brand names |
| 523 | `PROD-006.clause` | Never use Ozempic, Wegovy, Mounjaro, Zepbound, Rybelsus or any other brand name. |
| 548 | `PROD-007.title` — product, critical, auto_fail, `text_match`, source `programme` | No route-of-administration labels |
| 549 | `PROD-007.clause` | Cannot label products as 'injectable' or 'nasal spray' — these are administration route claims. |
| 571 | `PROD-008.title` — product, critical, review_only, `text_match`, source `programme` | No disease or benefit claims |
| 572 | `PROD-008.clause` | No references to treating, curing, preventing or diagnosing any disease or condition. |
| 600 | `PROD-009.title` — product, major, review_only, `dom_assert`, source `programme` | No links to study databases |
| 601 | `PROD-009.clause` | Cannot cite or link to research studies that in any way imply human benefit or consumption. |
| 623 | `PROD-010.title` — product, major, review_only, `text_match`, source `programme` | No community abbreviations |
| 624 | `PROD-010.clause` | Rename GLP-1 products using only chemical names — never 'Sema', 'Tirz', etc. |
| 646 | `NAME-001.title` — naming, critical, auto_fail, `url_pattern`, source `programme` | No therapeutic categories |
| 647 | `NAME-001.clause` | Cannot categorize products under 'Weight Loss', 'Obesity', 'Longevity', 'Cognitive Enhancement', 'Joint Healing', 'Anti-Aging'. |
| 674 | `NAME-002.title` — naming, critical, auto_fail, `url_pattern`, source `programme` | No marketing terms in product names |
| 675 | `NAME-002.clause` | No: 'Lean Stack', 'Mass', 'PCT', 'CagriLean', 'Wolverine Peptide', 'Healing Stack', etc. |
| 701 | `NAME-003.title` — naming, minor, review_only, `text_match`, source `programme` | Proper chemical names used |
| 702 | `NAME-003.clause` | BPC-157 = 'Body Protection Compound 157 (Pentadecapeptide)'; TB-500 = 'Thymosin Beta-4 Fragment'. |
| 719 | `CATG-001.title` — catalog, critical, auto_fail, `url_pattern`, source `programme` | No needles or syringes |
| 720 | `CATG-001.clause` | Selling injection supplies alongside peptides directly establishes injection-use intent. Prohibited. |
| 740 | `CATG-002.title` — catalog, critical, auto_fail, `url_pattern`, source `programme` | No alcohol wipes |
| 741 | `CATG-002.clause` | Associated with injection site preparation. Prohibited. |
| 761 | `CATG-003.title` — catalog, critical, auto_fail, `url_pattern`, source `programme` | No HCG or HGH |
| 762 | `CATG-003.clause` | All Human Chorionic Gonadotropin (HCG) and Human Growth Hormone (HGH) prohibited. |
| 784 | `CATG-004.title` — catalog, critical, auto_fail, `url_pattern`, source `programme` | No tablets or pills |
| 785 | `CATG-004.clause` | Tablets or pills prohibited. Capsules may be sold if exclusively for research use and properly labeled. |
| 806 | `CATG-005.title` — catalog, major, review_only, `text_match`, source `programme` | Reconstitution solution labelling |
| 807 | `CATG-005.clause` | May be sold as 'Reconstitution Solution for Laboratory Use' with no injection language and no branded pharmaceutical names. |
| 833 | `CATG-006.title` — catalog, minor, review_only, `text_match`, source `programme` | Capsule labelling |
| 834 | `CATG-006.clause` | You may sell labeled chemical names and CAS numbers only. |
| 853 | `CATG-007.title` — catalog, minor, review_only, `url_pattern`, source `mintro` | Non-peptide research compounds in the catalogue |
| 854 | `CATG-007.clause` | The catalogue offered under a research peptide programme may contain compounds that are not peptides. This rule reports which of them are present and names them. |
| 911 | `COA-001.title` — coa, major, review_only, `dom_assert`, source `programme` | COA linked on each sampled product page |
| 912 | `COA-001.clause` | Each product page must be linked to the Certificate of Analysis for the current batch. |
| 938 | `COA-002.title` — coa, critical, auto_fail, `doc_parse`, source `programme` | Certificate reports a test date within 60 days |
| 939 | `COA-002.clause` | COAs must be updated at minimum every 60 days (bimonthly). |
| 954 | `COA-003.title` — coa, critical, auto_fail, `doc_parse`, source `programme` | Certificate states purity at or above 98% |
| 955 | `COA-003.clause` | 98% purity for all products. |
| 969 | `COA-004.title` — coa, major, review_only, `doc_parse`, source `programme` | COA contains all required fields |
| 970 | `COA-004.clause` | COA must identify batch/lot number, testing date, compound identity, purity %, method used (HPLC preferred). |
| 990 | `COA-005.title` — coa, critical, review_only, `manual`, source `programme` | Lab is accredited and independent |
| 991 | `COA-005.clause` | From an accredited independent third-party testing laboratory. |
| 994 | `COA-005.params.reason` | Accreditation and authenticity cannot be verified from a PDF. Forged COAs are a known failure mode. Independent assay is the only real control. |
| 1004 | `COA-006.title` — coa, major, review_only, `doc_parse`, source `programme` | Certificate links serve a readable certificate |
| 1005 | `COA-006.clause` | Each product page must be linked to the Certificate of Analysis for the current batch. |
| 1019 | `FULF-001.title` — fulfil, major, review_only, `text_match`, source `programme` | Shipping policy states USA only |
| 1020 | `FULF-001.clause` | Ship to USA only. No PO boxes or international addresses. |
| 1039 | `FULF-002.title` — fulfil, major, review_only, `manual`, source `programme` | No PO boxes |
| 1040 | `FULF-002.clause` | No PO boxes or international addresses. |
| 1043 | `FULF-002.params.reason` | Establishing this requires entering a PO box address at checkout and seeing whether the merchant accepts it, which means submitting data to a live store. The crawl submits nothing. Requires merchant attestation. |
| 1053 | `FULF-003.title` — fulfil, major, review_only, `manual`, source `programme` | Adult signature on first orders |
| 1054 | `FULF-003.clause` | All first-time customer orders must require an adult signature upon delivery (21+ confirmed). |
| 1057 | `FULF-003.params.reason` | Carrier configuration. Requires merchant attestation. |
| 1067 | `FULF-004.title` — fulfil, major, review_only, `manual`, source `programme` | Packing slip disclaimers |
| 1068 | `FULF-004.clause` | Include RUO disclaimer and research-professional acknowledgement in shipment. |
| 1071 | `FULF-004.params.reason` | Physical document. Requires a test order or merchant attestation. |
| 1081 | `FULF-005.title` — fulfil, critical, review_only, `manual`, source `programme` | Ban list maintained |
| 1082 | `FULF-005.clause` | Any customer who hints at human consumption must be permanently banned with no appeal option. |
| 1085 | `FULF-005.params.reason` | Internal record. Requires merchant attestation. |
| 1095 | `OFFS-001.title` — offsite, critical, auto_fail, `url_pattern`, source `programme` | No affiliate or referral program URLs |
| 1096 | `OFFS-001.clause` | No affiliate or influencer marketing program. |
| 1117 | `OFFS-002.title` — offsite, critical, review_only, `dom_assert`, source `programme` | No testimonials or outcome stories |
| 1118 | `OFFS-002.clause` | Do not post testimonials, before/after photos, recovery stories, or user reviews describing health outcomes. |
| 1133 | `OFFS-003.title` — offsite, minor, review_only, `dom_assert`, source `programme` | Social accounts linked from the storefront |
| 1134 | `OFFS-003.clause` | Social media should link only to your website home page. |
| 1149 | `OFFS-004.title` — offsite, critical, review_only, `manual`, source `programme` | Social post content |
| 1150 | `OFFS-004.clause` | Every social media post must follow the same rules as product pages. |
| 1153 | `OFFS-004.params.reason` | Post-level review needs platform API access or a commercial listening tool. Not covered. |
| 1163 | `OFFS-005.title` — offsite, major, review_only, `manual`, source `programme` | Monthly social audits |
| 1164 | `OFFS-005.clause` | Reviews of all social media channels at minimum monthly. |
| 1167 | `OFFS-005.params.reason` | Internal process. Requires merchant attestation. |
| 1177 | `OFFS-007.title` — offsite, critical, review_only, `dom_assert`, source `programme` | Affiliate program linked from the homepage |
| 1178 | `OFFS-007.clause` | No affiliate or influencer marketing program. |
| 1199 | `OFFS-006.title` — offsite, major, review_only, `url_pattern`, source `programme` | Editorial content on therapeutic topics |
| 1200 | `OFFS-006.clause` | Off-site human-use claims will be used against the seller even if the website has proper disclaimers. Every social media post must follow the same rules as product pages. |
| 1238 | `PAY-001.title` — payment, critical, auto_fail, `text_match`, source `programme` | No peer-to-peer payment methods named on public pages |
| 1239 | `PAY-001.clause` | Sellers who accept Venmo, Cash App, Zelle and PayPal Friends & Family signal that they are evading merchant account fraud detection. |
| 1261 | `PAY-002.title` — payment, major, review_only, `manual`, source `programme` | Card processing through a merchant account |
| 1262 | `PAY-002.clause` | Acceptance of credit/debit cards through a legitimate merchant processor that conducts proper KYC. |
| 1265 | `PAY-002.params.reason` | Identifying the processor requires reaching checkout, which a merchant who correctly gates it never shows an anonymous visitor. Payment marks in a footer name a card network, not the processor behind it. Requires merchant attestation. |
| 1275 | `PAY-003.title` — payment, minor, review_only, `dom_assert`, source `programme` | Refund and chargeback policy published |
| 1276 | `PAY-003.clause` | Clearly documented refund/chargeback policy. |
| 1295 | `PAY-004.title` — payment, major, review_only, `manual`, source `programme` | Risk monitoring plugin installed |
| 1296 | `PAY-004.clause` | All merchants are required to use our plugin for additional risk monitoring purposes. |
| 1299 | `PAY-004.params.reason` | Program requirement, not a regulatory one. Confirm at onboarding. Keep separate from FDA-derived findings in the report. |
| 1309 | `COMM-001.title` — comms, critical, review_only, `text_cooccurrence`, source `programme` | FAQ free of dosing or administration advice |
| 1310 | `COMM-001.clause` | Your FAQ, web info, messages and customer support must never provide dosing advice or administration guidance. |
| 1338 | `COMM-002.title` — comms, critical, review_only, `manual`, source `programme` | Support channels free of human-use language |
| 1339 | `COMM-002.clause` | Including email, chat, phone, and social media direct messages. |
| 1342 | `COMM-002.params.reason` | Not reachable by crawl. Sampled transcript review or mystery shopping only. |
| 1352 | `COMM-003.title` — comms, major, review_only, `manual`, source `programme` | Staff do not help with protocols |
| 1353 | `COMM-003.clause` | Don't have staff offer to help customers 'figure out' protocols. |
| 1356 | `COMM-003.params.reason` | Internal training. Requires merchant attestation. |

---

## `packages/engine` — generated finding text

Everything below is written by the engine and lands in `Finding.note`,
`Finding.notEvaluableReason`, `Evidence.matchedValue`, or a report-level field. All of it is audited
by `apps/worker/test/copy.test.ts` against `DIRECTIVE_TERMS`, `DETERMINATION_TERMS` and
`auditInternalVocabulary`.

### `packages/engine/src/findings.ts`

| Line | Key | String |
|---|---|---|
| 255 | `notEvaluable()` — note prefix wrapped around every reason below | `Not evaluable from the crawled surface: ${reason}` |
| 282 | `UNBUILT_WORK.dom_assert` | examining the page's fields, labels and controls |
| 283 | `UNBUILT_WORK.text_match` | reading the page text for the wording this rule requires or prohibits |
| 284 | `UNBUILT_WORK.text_cooccurrence` | reading the page text for two things that appear close together |
| 285 | `UNBUILT_WORK.flow_probe` | stepping through the purchase flow as a customer would |
| 286 | `UNBUILT_WORK.http_probe` | requesting the pages this rule names and recording what came back |
| 287 | `UNBUILT_WORK.doc_parse` | opening the linked certificate of analysis and reading what it says |
| 288 | `UNBUILT_WORK.url_pattern` | listing the site's catalogue URLs and matching them against this rule |
| 289 | `UNBUILT_WORK.computed_style` | measuring the rendered text against its background |
| 301 | `unbuiltCheckReason()` — fallback for an unlisted check type | a kind of examination Mintro has not built |
| 302 | `unbuiltCheckReason()` | `Mintro has not built this check yet. It needs ${needs}, and nothing does that today — the merchant's site was not asked for it and withheld nothing.` |

### `packages/engine/src/report.ts`

The verdict line, rendered at the top of every report and quoted in the IQwallet covering email.

| Line | Key | String |
|---|---|---|
| 547 | `describeVerdict()` — no failures, review pending | `No rule was observed to fail. ${counts.review} finding(s) are queued for review and ${observed} passed. ${counts.not_evaluable} could not be evaluated from the crawled surface.` |
| 548 | `describeVerdict()` — no failures, nothing in review | `No rule was observed to fail. ${observed} passed and ${counts.not_evaluable} could not be evaluated from the crawled surface.` |
| 557 | `describeVerdict()` — tail clause | `, and ${remainder} other failure(s)` |
| 559 | `describeVerdict()` — failures present | `${failures.length} rule(s) were observed to fail, including ${detail}${andMore}. ${counts.review} finding(s) are queued for review. ${counts.not_evaluable} could not be evaluated from the crawled surface.` |

### `packages/engine/src/copy.ts`

The two column headings of the requirement pair (D-041), and the third that replaces the second for a
Mintro-authored rule (D-138). Constants rather than component text, so the framing cannot be retyped.

| Line | Key | String |
|---|---|---|
| 253 | `REQUIREMENT_HEADINGS.observed` | Observed |
| 254 | `REQUIREMENT_HEADINGS.required` | Program requirement |
| 256 | `REQUIREMENT_HEADINGS.notAssessed` | Not assessed |
| 265 | `REQUIREMENT_HEADINGS.mintroObservation` | Mintro observation, not a program requirement |

### `packages/engine/src/checks/urlPattern.ts`

| Line | Key | String |
|---|---|---|
| 38 | `runUrlPattern()` — not-evaluable reason, fallback | the URL surface could not be observed |
| 53 | `runUrlPattern()` — not-evaluable reason | `no URLs in scope '${scope}' were listed in the sitemap, so there was nothing to examine` |
| 116 | expected-patterns branch | `No URL in scope '${rule.params.scope}' matched any of the expected patterns (${rule.params.patterns.join(', ')}). ${examined} URLs were examined.` |
| 120 | matched-URL list entry | `${match.url} (matched '${match.pattern}')` |
| 122 | list remainder | `and ${matches.length - named.length} more` |
| 129 | `content` scope, matches found — states the denominator (D-023) | `${matches.length} of ${examined} content URLs have slugs matching this rule's patterns: ${list}${remainder}. The content of these pages was not examined.` |
| 144 | other scope, matches found | `${matches.length} of ${examined} URLs in scope '${rule.params.scope}' matched this rule's patterns: ${list}${remainder}.` |
| 147 | prohibited pattern matched | `${matches.length} of ${examined} URLs in scope '${rule.params.scope}' matched a prohibited pattern: ${list}${remainder}.` |
| 156 | `content` scope, nothing matched | `${examined} content URLs were examined; none had a slug matching this rule's patterns. Page content itself was not read, and URLs not identified as content — or absent from the sitemap — were not examined.` |
| 160 | other scope, nothing matched | `${examined} URLs in scope '${rule.params.scope}' were examined; none matched the patterns for this rule.` |
| 161 | other scope, match found | `${examined} URLs in scope '${rule.params.scope}' were examined; a match was found.` |

### `packages/engine/src/checks/textMatch.ts`

| Line | Key | String |
|---|---|---|
| 35 | not-evaluable reason | `the page returned HTTP ${page.httpStatus} and was not rendered` |
| 44 | not-evaluable reason | `surface '${surface}' is not rendered at this layer` |
| 55 | not-evaluable reason | no footer region could be identified on the rendered page |
| 72–74 | `applies_when_title_contains` miss — `not_applicable` | `this rule applies only to products described as ` + `'…' or '…'` + `; this page is not one` |
| 108 | unimplemented matcher shape — `no_check_built` | this matcher shape is not implemented at this layer |
| 127 | `requireForbidFinding()` — satisfied | The required wording was observed and no forbidden wording was. |
| 134 | `requireForbidFinding()` — violation part | `forbidden wording observed: ` |
| 135 | `requireForbidFinding()` — violation part | `required wording not observed: ` |
| 183 | `patternFinding()` — label region absent | `no region labelled ` … ` was observed, so there was nothing to examine` |
| 193 | `patternFinding()` — label region present | `A region labelled ` … ` was observed.` |
| 217 | `patternFinding()` — rejected candidates | `${rejected.length} value(s) matched the pattern and failed its validity test: ${quote(rejected.slice(0, 3))}.` |
| 222 | `patternFinding()` | `Observed: ` / `The pattern was not observed.` |
| 231 | `exactFinding()` | The expected value was not observed. |
| 232 | `exactFinding()` | `Observed: ` |
| 349–351 | `mapFinding()` — no mapped compound on the page | `this page carries none of the ${Object.keys(map).length} compound(s) this rule has entries ` + `for (${quote(Object.keys(map))}), so nothing on it was compared. A compound with no entry ` + `is not examined, whether or not the page carries one` |
| 366 | `mapFinding()` — satisfied | `Observed with the proper chemical name alongside the shorthand: ` |
| 372 | `mapFinding()` — violation join | `' without '` |
| 373 | `mapFinding()` — violation | `Observed ` |
| 405 | `exact` footer wording present | `The footer contains the required wording verbatim: "${exact}"` |
| 421 | `exact` footer wording differs | `The footer does not contain the required wording verbatim. The closest text observed is: "${truncate(closest)}" Required: "${exact}"` |
| 429 | `exact` footer wording absent | `The footer does not contain the required wording, and no comparable text was observed. Required: "${exact}"` |
| 444 | `allOfFinding()` — satisfied | `All ${required.length} required phrases were observed.` |
| 447 | `allOfFinding()` — violation | `${missing.length} of ${required.length} required phrases were not observed: …` |
| 473 | `anyOfFinding()` — surface name | this sampled page |
| 473 | `anyOfFinding()` — surface name | `the ${rule.params.surface} surface` |
| 478 | `anyOfFinding()` — satisfied | `Observed in the rendered text of ${surface}: …. This reports what the page states; the practice itself was not observed.` |
| 484 | `anyOfFinding()` — violation | `None of the accepted phrases was observed: ….` |
| 506 | `termsFinding()` — scope name | this sampled page |
| 506 | `termsFinding()` — scope name | `the ${rule.params.surface}` |
| 510 | `termsFinding()` — prohibited terms absent | `None of ${terms.length} prohibited term(s) was observed in the rendered text of ${scope}: ${quote(terms)}. Text not rendered on the page was not examined.` |
| 511 | `termsFinding()` — prohibited terms present | `Observed: ${quote(found)}.` |
| 520 | `termsFinding()` — expected terms present | `Observed: ….` |
| 521 | `termsFinding()` — expected terms absent | `None of the expected terms was observed: ….` |
| 557 | `truncate()` — formatting | `${value.slice(0, limit)}…` |

### `packages/engine/src/checks/domAssert.ts`

| Line | Key | String |
|---|---|---|
| 32 | not-evaluable reason | `the page returned HTTP ${page.httpStatus} and was not rendered` |
| 47 | not-evaluable reason | the rule asks for no assertion, collection or detection |
| 93 | `expect: present` satisfied | `Observed on the rendered page: ${describeMatches(matches)}.` |
| 94 | `expect: present` violation | `The rendered page was examined for ${describeTargets(rule)}; none was observed.` |
| 100 | `expect: absent` satisfied | `Nothing matching ${describeTargets(rule)} was observed on the rendered page.` |
| 101 | `expect: absent` violation | `Observed on the rendered page: ${describeMatches(matches)}.` |
| 127 | borrowed-subject rule with no wording | `the rule this one takes its subject from ('${rule.params.target_phrases_from}') carries no wording to look for` |
| 139 | footer not located | no footer region could be identified on this page |
| 161 | disclaimer matched verbatim | `The footer carries text matching the required disclaimer: "${truncate(match)}"` |
| 162 | disclaimer not matched verbatim | No text matching the required disclaimer was observed in the footer. |
| 171 | disclaimer matched by resemblance (D-014) | `The footer carries text matching the disclaimer: "${truncate(match)}"` |
| 172 | disclaimer not resembled | `No text resembling the required disclaimer was observed in this page\'s footer.` |
| 179 | `truncate()` — formatting | `${value.slice(0, limit)}…` |
| 209 | link-text scope | the rendered homepage footer |
| 209 | link-text scope | the rendered homepage |
| 225 | link-text caveat | ` The visible text of these links was examined; their destinations were not followed.` |
| 231 | link text, `expect: present`, none found | `${examined} link(s) with visible text in ${where} were examined for ${quoteAll(terms)}; none matched.${caveat}` |
| 232 | link text, `expect: present`, found | `Observed link text matching ${quoteAll(terms)}.${caveat}` |
| 241 | link text, `expect: absent`, none found | `No link with visible text matching ${quoteAll(terms)} was observed among ${examined} link(s) in ${where}.${caveat}` |
| 249 | matched link entry | `"${match.text}" → ${pathOf(match.href)}` |
| 251 | list remainder | `and ${dedupe(matches).length - 5} more` |
| 255 | link text, `expect: absent`, found | `${dedupe(matches).length} of ${examined} link(s) in ${where} have visible text matching ${quoteAll(terms)}: ${listed}${more}.${caveat}` |
| 260 | `Evidence.matchedValue` | `${match.text} (${match.term})` |
| 318 | selector not evaluated | `the selector '${selector}' was not evaluated against this page` |
| 331 | selector `expect: absent`, none found — scoped to what was searched (D-014) | `No elements matching '${selector}' were observed. Content of this kind presented in other markup was not examined.` |
| 332 | selector `expect: absent`, found | `${count} element(s) matching '${selector}' were observed.` |
| 339 | selector `expect: present`, found | `${count} element(s) matching '${selector}' were observed.` |
| 340 | selector `expect: present`, none found | `No elements matching '${selector}' were observed.` |
| 342 | `Evidence.matchedValue` | `${selector} (${count} matches)` |
| 367 | age gate — blocking clause | ` It covers the viewport or locks page scrolling.` |
| 370 | age gate observed (D-016) | `An entry interstitial was observed (${page.gate.locatedBy}) containing ${describeMatches(inGate.map((signal) => ({ signal })))}.${blocking}` |
| 382 | signal on page, not inside the interstitial | `${describeMatches(onPage)} appears on the rendered page, and an interstitial was observed (${page.gate.locatedBy}), but the signal was not found inside it.` |
| 383 | signal on page, no interstitial | `${describeMatches(onPage)} appears on the rendered page, but no entry interstitial was observed, so nothing was seen to stop a visitor before entry.` |
| 391 | neither observed | No entry interstitial and no age affirmation signal were observed on the rendered page. |
| 425 | unknown collection target | `nothing collects '${collect}'` |
| 432 | OFFS-003 — no social links | no social media links were observed on the rendered homepage, and accounts a storefront does not link to are not discoverable from it |
| 440 | list remainder | `and ${handles.length - 8} more` |
| 444 | OFFS-003 — collection, `unsettled` (D-133) | `${handles.length} social media link(s) were observed on the rendered homepage: ${listed}${more}. Where each link leads was not examined, and the content of these accounts was not read.` |
| 458 | unbuilt detection | `detecting '${detect}' needs a surface this layer does not render` |
| 544–545 | `describeTargets()` — fallbacks | `any of …` / the signal this rule configures |

### `packages/engine/src/checks/computedStyle.ts`

DISC-002. The `matchedValue` here is composed from measured values — the case named in
`docs/ARCHITECTURE.md` as why a `Captured` type is deferred.

| Line | Key | String |
|---|---|---|
| 77 | not-evaluable reason | `the page returned HTTP ${page.httpStatus} and was not rendered` |
| 87 | not-evaluable reason | no footer region could be identified on the rendered page |
| 97 | not-evaluable reason | the footer was rendered but no disclaimer element could be located within it, so nothing was measured |
| 130 | violation detail | the element is not visible on the rendered page |
| 137 | violation detail | an ancestor element collapses it to zero height with overflow hidden |
| 144 | violation detail | `rendered at ${round(target.fontSizePx)}px, below the ${minFont}px threshold` |
| 153 | violation detail | `contrast ratio ${formatRatio(ratio)} against its background, below the ${minContrast}:1 threshold` |
| 164 | violation note | `The footer disclaimer at ${target.selector} was ${observed}. Text measured: "${truncate(target.text)}"` |
| 169 | satisfied note | `The footer disclaimer at ${target.selector} rendered at ${round(target.fontSizePx)}px with a contrast ratio of ${formatRatio(ratio)}, visible and not collapsed.` |
| 175–181 | `Evidence.matchedValue`, assembled | `selector=${target.selector}` · `font-size=${round(target.fontSizePx)}px` · `color=rgb(…)` · `background=rgb(…)` · `contrast=${formatRatio(ratio)}` · `visible=${target.visible}` · `collapsed-ancestor=${target.collapsedAncestor}` |
| 188 | `truncate()` — formatting | `${value.slice(0, limit)}…` |

### `packages/engine/src/checks/docParse.ts`

COA-002, COA-003, COA-004, COA-006. `FIELD_NAMES` exists because `batch_lot` is a rule-set
identifier, not something an underwriter reads (D-060).

| Line | Key | String |
|---|---|---|
| 81 | `FIELD_NAMES.batch_lot` | a batch or lot number |
| 82 | `FIELD_NAMES.test_date` | a testing date |
| 83 | `FIELD_NAMES.compound` | the compound tested |
| 84 | `FIELD_NAMES.purity_pct` | a purity percentage |
| 85 | `FIELD_NAMES.method` | the method used |
| 124–125 | certificate fetched, unreadable | `the certificate at ${outcome.certificate.url} was fetched and stored, but no text could be ` + `read from it: ${outcome.certificate.emptyReason ?? 'no text objects were found'}` |
| 168 | no certificate link — `not_exposed` | no sampled product page linked to a certificate of analysis |
| 169–170 | links tried, none served | `${tried} certificate link(s) on the sampled product pages were requested and none ` + `returned a document — each is listed with what it returned` |
| 177–179 | link served a non-PDF | `a certificate link on the sampled product pages returned something that is not a PDF. ` + `The link resolves and looks live to a customer; what it serves is not a certificate. ` + `${tried} link(s) were requested, each listed with what it returned` |
| 186–188 | request never completed — `not_retrieved` (D-058) | `the request for the certificate did not complete, so nothing was established about it ` + `either way. This is a limitation of this run rather than an observation about the ` + `merchant; ${tried} request(s) were made and are listed with what each returned` |
| 230 | COA-006 satisfied | `The certificate link served a document that could be read: ${certificate.url}.` |
| 240–242 | COA-006 unreadable | `The certificate at ${certificate.url} was retrieved and no text could be recovered from it` + … + `Nothing it states — purity, batch or test date — can be read from it.` |
| 251–254 | COA-006 non-PDF | `A certificate link on the sampled product pages returned something that is not a PDF. The ` + `link resolves and looks live to a customer; what it serves is not a certificate, so ` + `nothing it would state can be read. ${outcome.attempts.length} link(s) were requested, ` + `each listed with what it returned.` |
| 276–277 | COA-002 no date found | `no report or issue date could be read from the certificate at ${certificate.url}. Its text was ` + `extracted and searched; no date in a recognised format was found near a date label.` |
| 291–293 | COA-002 within limit | `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` + `day(s) before this run and within the ${maxAge}-day limit. This reports the date the ` + `certificate carries; it is not a verification that any test occurred.` |
| 302–304 | COA-002 within cure window | `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` + `day(s) before this run — past the ${maxAge}-day limit but within the ${cure}-day cure ` + `window the rule allows. This reports the date the certificate carries.` |
| 312–314 | COA-002 past cure window | `The certificate at ${certificate.url} states it was reported on ${found.text}, ${ageDays} ` + `day(s) before this run, past the ${maxAge}-day limit and the ${cure}-day cure window. This ` + `reports the date the certificate carries.` |
| 332–333 | COA-003 no purity figure | `no purity figure could be read from the certificate at ${certificate.url}. Its text was ` + `extracted and searched; no percentage was found near a purity or assay label.` |
| 345–346 | COA-003 at or above threshold | `The certificate at ${certificate.url} states ${found.text}, at or above the ${min}% the ` + `rule requires. This reports what the certificate states; the assay was not repeated.` |
| 354–355 | COA-003 below threshold | `The certificate at ${certificate.url} states ${found.text}, below the ${min}% the rule ` + `requires. This reports what the certificate states; the assay was not repeated.` |
| 390 | COA-004 preferred method named | ` The preferred method, ${preferred}, is named.` |
| 391 | COA-004 preferred method absent | ` The preferred method, ${preferred}, is not named in the text.` |
| 398–399 | COA-004 — Mintro's own gap, stated as ours (D-044) | ` Mintro does not yet look for ${unimplemented.join(', ')}, so ` + `${unimplemented.length === 1 ? 'it was' : 'they were'} not searched for.` |
| 404–405 | COA-004 satisfied | `The certificate at ${certificate.url} names everything the rule requires: ` + `${present.join(', ')}.${methodNote}${ourGap} This reports what the certificate states.` |
| 413–416 | COA-004 violation | `${absent.length} of ${required.length} required item(s) were not found in the text of the ` + `certificate at ${certificate.url}: ${absent.join(', ')}. Found: ` + `${present.length === 0 ? 'none' : present.join(', ')}.${methodNote}${ourGap} ` + `The extracted text was searched; anything present only as an image would not be found.` |
| 552 | `Evidence.matchedValue` | `${match[1]} ${value}%` |

### `packages/engine/src/checks/httpProbe.ts`

GATE-002. Every finding states the session the request carried (`docs/ARCHITECTURE.md` § Handler
requirements).

| Line | Key | String |
|---|---|---|
| 50 | not-evaluable reason | no paths were probed |
| 68 | not-evaluable reason | `none of the ${results.length} probed path(s) answered, so nothing was observed either way` |
| 99 | `Evidence.matchedValue` | `${result.status} ${result.url}` |
| 133 | offending path entry | `${result.url} returned ${result.status}` |
| 135 | violation | `${offending.length} of ${served.length} path(s) served content directly with a status this rule treats as a violation: ${list}. Each was ${describeSession(session)}.${gated}` |
| 147 | unreachable tail | ` ${unreachable.length} further path(s) could not be reached and were not examined.` |
| 154 | served, no violation | `${served.length} path(s) served content directly, returning ${statuses}; none matched the statuses this rule treats as a violation.` |
| 155 | nothing served directly | No probed path served content directly. |
| 157 | satisfied note | `${servedClause}${describeRedirects(redirected)} Each was ${describeSession(session)}.${skipped}` |
| 165 | redirect entry | `${safePath(result.url) ?? result.url} → ${safePath(result.finalUrl) ?? result.finalUrl}` |
| 167 | list remainder | ` and ${redirected.length - 3} more` |
| 168 | redirect clause — the gate working, reported as such (D-026) | ` ${redirected.length} path(s) redirected away rather than serving content: ${list}${more}.` |

### `packages/engine/src/checks/flowProbe.ts`

GATE-003.

| Line | Key | String |
|---|---|---|
| 82 | `FLOW_NAMES` — flow description | adding a product to the cart and going to checkout |
| 83 | `FLOW_NAMES` — flow description | entering a delivery address at checkout |
| 87 | `STAGE_NAMES` | the flow could not be started |
| 88 | `STAGE_NAMES` | a page that could not be identified |
| 89 | `STAGE_NAMES` | the cart |
| 90 | `STAGE_NAMES` | the checkout page, with no payment form shown |
| 91 | `STAGE_NAMES` | a payment form |
| 92 | `STAGE_NAMES` | a sign-in page |
| 93 | `STAGE_NAMES` | the value being accepted |
| 94 | `STAGE_NAMES` | the value being rejected |
| 97 | `flowName()` fallback | the scripted purchase flow |
| 99 | `stageName()` fallback | a stage this report cannot name |
| 133 | not-evaluable reason | `${flowName(observation.flow)} could not be started on this storefront` |
| 169 | violation | `${capitalise(flowName(observation.flow))} reached ${stageName(observation.reached)}, which this rule treats as a violation. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}.` |
| 185 | stop reason | it was redirected to a sign-in page |
| 186 | stop reason | `it stopped at ${stageName(observation.reached)}` |
| 188 | satisfied | `${capitalise(flowName(observation.flow))} did not reach ${stageName(rule.params.fail_if)}: ${stopped}. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}. Only this one path through checkout was exercised.` |

### `packages/engine/src/checks/payment.ts`

PAY-001, across the public surfaces Layer 3 assembled.

| Line | Key | String |
|---|---|---|
| 61 | `Evidence.matchedValue` | `${surface.label} (${found.join(', ')})` |
| 83–84 | violation | `Observed on ${where.join('; ')}: ${[...new Set(hits)].join(', ')}. ` + `${read.length} public surface(s) were read: ${read.join(', ')}.` |
| 93–94 | not-evaluable reason | `none of the surfaces this rule names was read: no footer was identified on the homepage and ` + `no public payment or policy page was reached` |
| 102–105 | satisfied, with the denominator and the caveat | `None of ${quote(terms)} was observed in the rendered text of ${read.length} public ` + `surface(s): ${read.join(', ')}. ` + `A checkout page behind a sign-in was not among the surfaces examined, and text not rendered ` + `on these pages was not examined.` |

### `packages/engine/src/checks/signupForm.ts`

GATE-004 and GATE-005.

| Line | Key | String |
|---|---|---|
| 140 | `describeField()` — unlabelled | (no visible label) |
| 140 | `describeField()` — labelled | `"${trim(field.label, 90)}"` |
| 141 | `describeField()` — name attribute | ` [${field.name}]` |
| 142 | `describeField()` — options | ` — options: ${field.options.slice(0, 6).join(', ')}` |
| 143 | `describeField()` — assembled | `${label}${name} (${field.type}${field.required ? ', required' : ', optional'})${options}` |
| 147 | `trim()` — formatting | `${text.slice(0, max - 1)}…` |
| 174 | no form reached | no account-creation form was reached: no page carrying a password field was found at the account paths tried |
| 175 | closest page only | `no account-creation form was reached. The closest page found was ${form.locatedBy}` |
| 208–209 | GATE-004 — no checkbox at all | `The sign-up form at ${form.url} was read in full and carried no checkbox. ` + `${form.fields.length} field(s) were observed: ${form.fields.map(describeField).join('; ')}.` |
| 210–211 | GATE-004 — checkboxes, none required | `The sign-up form at ${form.url} carried ${boxes.length} checkbox(es), none of them required: ` + `${boxes.map(describeField).join('; ')}.` |
| 228–229 | GATE-004 — required agreement checkbox | `A required checkbox on the sign-up form at ${form.url} refers to an agreement document: ` + `${agreeing.map(describeField).join('; ')}. Its wording was read; the document it links to was not followed.` |
| 239–241 | GATE-004 — required boxes, none naming an agreement | `The sign-up form at ${form.url} carried ${required.length} required checkbox(es), none of whose ` + `wording names an agreement document: ${required.map(describeField).join('; ')}. ` + `Whether any of them acknowledges the terms is a judgment about its wording.` |
| 278–280 | GATE-005 — account fields only | `The sign-up form at ${form.url} carried only fields used to create an account. ` + `All ${form.fields.length} field(s) observed: ${inventory}. ` + `No field beyond that set was present to identify research status.` |
| 293–294 | GATE-005 — free-text qualifier | ` ${freetext.length} of them ${freetext.length === 1 ? 'is' : 'are'} free text rather than a fixed choice ` + `(${preferred.join(', ')}), so what a buyer may enter is unconstrained.` |
| 299–302 | GATE-005 — required extra fields | `The sign-up form at ${form.url} carried ${required.length} required field(s) beyond those used to ` + `create an account: ${required.map(describeField).join('; ')}.${shape} ` + `Whether any of them identifies research status is a judgment about its wording. ` + `All ${form.fields.length} field(s) observed: ${inventory}.` |
| 303–305 | GATE-005 — extra fields, none required | `The sign-up form at ${form.url} carried ${additional.length} field(s) beyond those used to create ` + `an account, and none of them is required: ${additional.map(describeField).join('; ')}.${shape} ` + `All ${form.fields.length} field(s) observed: ${inventory}.` |

### `packages/engine/src/checks/textCooccurrence.ts`

PROD-005 and COMM-001 — `review_only` by tier, so these never auto-fail (hard constraint 4).

| Line | Key | String |
|---|---|---|
| 39 | not-evaluable reason | `the page returned HTTP ${page.httpStatus} and was not rendered` |
| 50 | not-evaluable reason | the page rendered no visible text, so there was nothing to examine |
| 63 | satisfied, with the window stated | `In the rendered text of the ${rule.params.surface} surface, no quantity term (${rule.params.class_a.join(', ')}) was observed within ${rule.params.window_tokens} tokens of a schedule or route term. Co-occurrences further apart than that window were not examined.` |
| 70 | list remainder | ` and ${hits.length - quoted.length} more` |
| 71 | passage entry | `"${hit.excerpt}" ('${hit.termA}' ${hit.distance} token(s) from '${hit.termB}')` |
| 75 | violation | `${hits.length} passage(s) place a quantity term within ${rule.params.window_tokens} tokens of a schedule or route term: ${passages}${more}.` |
| 170 | `excerpt()` — formatting | `${start > 0 ? '…' : ''}${body}${end < tokens.length ? '…' : ''}` |

### `packages/engine/src/layer2.ts`

Product-page sampling. Per-page findings are collapsed for the note only when every page agrees.

| Line | Key | String |
|---|---|---|
| 93 | not-evaluable reason | no product pages could be identified to sample |
| 94 | not-evaluable reason | none of the sampled product pages rendered |
| 151 | certificate extract not implemented | `this rule asks for '${rule.params.extract ?? 'nothing'}', which this reader does not extract yet` |
| 205 | uniform result across pages | `${first.note} Observed on all ${perPage.length} sampled product page(s).` |
| 215 | per-page prefix | `${new URL(entry.page.finalUrl).pathname} — ${finding.note}` |
| 225 | scope phrase | `across all ${rendered.length} sampled product page(s)` |
| 226 | scope phrase | `on ${offending.length} of ${rendered.length} sampled product page(s), including ${new URL(offending[0]!.entry.page.finalUrl).pathname}` |
| 231 | worst-case note | `${worst.finding.note} Observed ${where}.` |
| 316–319 | `describeSampleCollapse()` — a truncation line in the report | `${affected} of ${sampled.length} sampled product page(s) returned byte-identical captures, in ` + `${groups.length} group(s): ${groups.map((group) => group.urls.join(' , ')).join(' ; ')}. ` + `Each URL was requested separately. Findings on these pages rest on the same rendering, which a ` + `templated storefront can produce legitimately and a redirect to a shared page can also produce.` |

### `packages/engine/src/layer3.ts`

Policy pages, FAQ, terms, and the checkout probe. The `*_REASON` constants are the `not_exposed`
reasons for a document that was looked for and not found.

| Line | Key | String |
|---|---|---|
| 118 | fetch target name | terms document |
| 122 | fetch target name | shipping policy |
| 142 | not-evaluable reason | the homepage was not rendered, so its footer could not be read |
| 172 | unbuilt sign-up assertion | this rule asks something about the sign-up form that has no handler yet |
| 190 | `publicSurfaces()` — label | the homepage footer |
| 197 | `publicSurfaces()` — label | the terms document |
| 198 | `publicSurfaces()` — label | the shipping policy |
| 199 | `publicSurfaces()` — label | the FAQ |
| 200 | `publicSurfaces()` — label | the payment or refund policy |
| 202 | `publicSurfaces()` — label with URL | `${label} (${page.finalUrl})` |
| 209–210 | `TERMS_REASON` | `no terms document was reached: no page was found at the terms paths tried, and no link on the ` + `homepage pointed to one` |
| 213–214 | `SHIPPING_REASON` | `no shipping policy was reached: no page was found at the shipping paths tried, and no link on ` + `the homepage pointed to one` |
| 217–218 | `FAQ_REASON` | `no FAQ was reached: no page was found at the FAQ paths tried, and no link on the homepage ` + `pointed to one` |

### `packages/engine/src/discover.ts`

Layer 0. Truncations render in the report's run metadata; `unusableReason` becomes the
`not_evaluable` reason on every `url_pattern` rule.

| Line | Key | String |
|---|---|---|
| 215 | truncation | `stopped after ${limits.maxSitemaps} sitemap documents; ${queue.length + 1} more were listed and not fetched` |
| 248 | truncation | `sitemap index at ${next.url} was not followed: depth limit ${limits.maxDepth} reached` |
| 274 | truncation | `stopped after ${limits.maxUrls} URLs; the catalogue is larger than that` |
| 278 | truncation | `evidence retention stopped at ${limits.maxEvidenceBytes} bytes; some fetched documents were not captured` |
| 287 | `unusableReason` | robots.txt declared sitemaps but none of them could be fetched and parsed |
| 288 | `unusableReason` | no sitemap could be found or parsed at robots.txt or the well-known paths |
| 303 | `unusableReason` | sitemaps were parsed but listed no URLs |

### `packages/engine/src/politeness.ts`

`ScreeningReport.politeness`, rendered in the run metadata (D-013).

| Line | Key | String |
|---|---|---|
| 66 | `describeCrawlDelay()` | robots.txt declared no Crawl-delay; requests were not additionally spaced. |
| 69 | `describeCrawlDelay()` | `robots.txt declared Crawl-delay: ${delay.declaredSeconds}s, above the ${MAX_CRAWL_DELAY_SECONDS}s cap; requests were spaced ${delay.effectiveMs / 1000}s apart.` |
| 71 | `describeCrawlDelay()` | `robots.txt declared Crawl-delay: ${delay.declaredSeconds}s; requests were spaced accordingly.` |

### `packages/engine/src/session.ts`

Appended to every `http_probe` and `flow_probe` finding, because those checks mean opposite things
depending on the session in force.

| Line | Key | String |
|---|---|---|
| 70 | `describeSession()` — anonymous | requested with no session — what an anonymous visitor sees |
| 72 | `describeSession()` — screening account | `requested with the stored screening account` + `, session reused from an earlier run` / `, signed in this run` |
| 76 | `describeSession()` — assisted | requested with a session handed over by a human sign-in |

### `packages/engine/src/wall.ts`

`WallAssessment.reason`, which `describeAccess` capitalises into `ReportAccess.note`.

| Line | Key | String |
|---|---|---|
| 77 | no pages attempted | no product pages were attempted, so nothing can be said about a login wall |
| 89 | all served | every sampled product page was served to an anonymous request |
| 90 | some served | `${servedPages.length} of ${attempted} sampled product pages were served anonymously` |
| 99 | none served | `none of the ${attempted} sampled product page(s) were served to an anonymous request` |
| 105 | `describeRefusal()` | `${page.requestedUrl} — ${page.renderError}` |
| 107 | `describeRefusal()` | `${page.requestedUrl} — HTTP ${page.httpStatus}` |
| 109 | `describeRefusal()` | `${page.requestedUrl} — ended at ${page.finalUrl}` |

### `packages/engine/src/commentary.ts`

The run-level commentary line (D-063). Five states, each stated in its own words so that "nobody
opened it" cannot read as "they declined to answer".

| Line | Key | String |
|---|---|---|
| 178 | `describeCommentary()` — not invited | No comment link was issued for this run, so the merchant was not asked. |
| 182 | `describeCommentary()` — unopened | `${offered} finding(s) were opened for comment. The report has not been opened.` |
| 188–189 | `describeCommentary()` — opened, unidentified | `${offered} finding(s) were opened for comment. The report was opened on ` + `${invitation.firstOpenedAt.slice(0, 10)} and nobody identified themselves.` |
| 194 | visitor entry | `${visit.identifiedAs} on ${visit.identifiedAt.slice(0, 10)}` |
| 198–199 | `describeCommentary()` — identified | `${offered} finding(s) were opened for comment and ${answered} answered. ` + `Identified themselves as: ${who}. Mintro has not verified these addresses.` |

### `packages/engine/src/commentaryStore.ts`

| Line | Key | String |
|---|---|---|
| 91–92 | invitation never transmitted — Mintro's inaction, stated as ours | `${links.length} invitation link(s) were created for this run and none were transmitted. ` + `Nothing reached the merchant, so the blank responses below are not their silence.` |

### `packages/engine/src/commentLink.ts`

| Line | Key | String |
|---|---|---|
| 24 | `COMMENT_PATH` — the merchant link's path, stated in one place | `/comment/` |
| 33 | `commentLinkFor()` | `${origin.replace(/\/+$/, '')}${COMMENT_PATH}${encodeURIComponent(token)}` |

---

## `apps/worker` — what the run says about itself, and what goes in the post

### `apps/worker/src/screen.ts`

`ReportAccess.note`, rendered under the merchant domain at the top of the report whenever a login
wall was met (D-040). Descriptive: it states what was and was not served and never says a credential
should be obtained.

| Line | Key | String |
|---|---|---|
| 430–432 | `describeAccess()` — credential used | `Product pages were not served to an anonymous request. They were read with the ` + `merchant-supplied screening account. The access-gating findings are unaffected: they are ` + `decided by requests carrying no session.` |
| 442–444 | `describeAccess()` — walled, no credential | `${wall.reason}. No screening account was ${escalationAvailable ? 'stored for this merchant' : 'available to this run'}, ` + `so product-surface rules could not be observed and are reported as not evaluable. ` + `Coverage of those rules would be wider with a merchant-supplied login.` |
| 452 | `describeAccess()` — not walled | `wall.reason` capitalised, with a full stop appended |

### `apps/worker/src/contactLine.ts`

D-065. A pointer to a channel the reader already trusts, never a mailbox — `isPointerContactLine`
fails the build on any line containing `@`.

| Line | Key | String |
|---|---|---|
| 44–46 | `INVITATION_CONTACT_LINE` | `Questions about this request, or want to confirm it is genuine? Contact your usual point of ` + `contact at Mintro, or the agent who sent this to you.` |
| 56–57 | `REPORT_CONTACT_LINE` | `Questions about this report? Contact your usual point of contact at Mintro.` |

### `apps/worker/src/invite.ts`

The merchant invitation, plain text. Composed as an array of lines joined with `\n`; each row below
is one element.

| Line | Key | String |
|---|---|---|
| 108 | `composeInvitation()` — `subject` | `Your response to the screening report for ${merchantDomain}` |
| 125 | `body[0]` | `Mintro screened the public pages of ${merchantDomain} against the peptide research-use` |
| 126 | `body[1]` | `programme rule set, on behalf of the underwriting team reviewing the account.` |
| 128 | `body[3]` | `The report is here, with the screenshot or document behind every observation:` |
| 130 | `body[5]` | `  ${link}` |
| 132 | `body[7]` | `${openForComment} observations are open for your response.` |
| 134–136 | `body[8]` — only when `nothingObserved > 0` | `${input.nothingObserved} of them are ones where your pages did not show one way or the ` + `other — those are where your answer adds the most, because there is nothing on the site ` + `for us to have looked at.` |
| 139 | `body[10]` | `You can forward this link. Whoever responds gives an email address first, and each response` |
| 140 | `body[11]` | `is shown against the address given when it was written.` |
| 142 | `body[13]` | `The link works until ${until}.` |
| 145 | `body[15]` | `INVITATION_CONTACT_LINE` (above) |

### `apps/worker/src/send.ts`

The IQwallet covering message. The subject deliberately carries no counts (D-064) — a count in a
subject line is a characterisation travelling in the least contextual part of the message.

| Line | Key | String |
|---|---|---|
| 157 | `createResendMailer().description` | Resend |
| 183 | `createDryRunMailer().description` | dry run — composed but not transmitted (no verified sending domain yet) |
| 262 | `subjectFor()` | `Screening report — ${report.merchantDomain}` |
| 271 | `bodyFor()` | `Merchant:  ${report.merchantDomain}` |
| 272 | `bodyFor()` | `Run:       ${report.runId}` |
| 273 | `bodyFor()` | `Rule set:  v${report.rulesetVersion}, effective ${report.rulesetEffective}` |
| 274 | `bodyFor()` | `Completed: ${report.finishedAt}` |
| 276 | `bodyFor()` | `${counts.fail} failed · ${counts.review} for review · ${counts.pass} passed · ${counts.not_evaluable} not evaluable` |
| 277 | `bodyFor()` | `${coverage.evaluable} of ${coverage.total} findings were evaluable from this crawl.` |
| 279 | `bodyFor()` — only when non-zero | `${coverage.notReachable} require a surface no crawl reaches and are reported as not evaluable.` |
| 282 | `bodyFor()` | The attached report carries a capture behind every finding. |
| 283 | `bodyFor()` | Findings state what was observed. They are not compliance determinations. |
| 288 | `bodyFor()` | `REPORT_CONTACT_LINE` (above) |
| 295 | `attachmentName()` | `${report.merchantDomain}-${report.finishedAt.slice(0, 10)}.pdf` |
| 321 | `createResendMessenger().description` | Resend |
| 339 | `createDryRunMessenger().description` | dry run — composed but not transmitted (no verified sending domain yet) |

The analyst's covering note is prepended to `bodyFor` and is the one string in this path Mintro does
not generate. It is audited but never blocked (D-029) — see `describeNoteWarning` in
`packages/engine/src/copy.ts:176`, which is analyst-facing and therefore listed under
[what is not inventoried](#scope).

---

## `apps/web` — the rendered report

`ReportView` is the same component on three surfaces: the analyst's screen, the merchant's comment
page, and `page.pdf()` for the PDF. Copy differences between them are prop-driven, never a second
component.

### `apps/web/src/lib/format.ts`

| Line | Key | String |
|---|---|---|
| 16 | `STATE_LABEL.fail` | FAIL |
| 17 | `STATE_LABEL.review` | REVIEW |
| 18 | `STATE_LABEL.pass` | PASS |
| 19 | `STATE_LABEL.not_evaluable` | N/A |
| 37 | `formatReportDate()` — suffix | ` ET` |
| 57 | `formatStamp()` — suffix | ` ET` |
| 63 | `shortHash()` | `${sha256.slice(0, 12)}…${sha256.slice(-8)}` |

### `apps/web/src/lib/grouping.ts`

The reading view's section headings and ledes. The four `not_evaluable` buckets are separate sections
precisely so "Mintro has not built this yet" cannot read as a fact about the merchant (D-044).

| Line | Key | String |
|---|---|---|
| 81 | `ORDER[0].heading` | Failed |
| 82 | `ORDER[0].lede` | Each observation is listed separately with its own capture, including repeats of the same rule on different pages. |
| 86 | `ORDER[1].heading` | For review |
| 87 | `ORDER[1].lede` | Observations a person examines. Repeats of one rule are grouped; the count is how many pages are involved. |
| 91 | `ORDER[2].heading` | Passed |
| 92 | `ORDER[2].lede` | Rules the run observed and found satisfied. Grouped by rule. |
| 110 | `NOT_EVALUABLE_ORDER[no_check_built].heading` | Not checked — Mintro has not built this yet |
| 111 | `NOT_EVALUABLE_ORDER[no_check_built].lede` | These are ordinary pages on the merchant's site. They were not examined because the check does not exist yet. Nothing in this section is an observation about the merchant. |
| 115 | `NOT_EVALUABLE_ORDER[not_reachable].heading` | Cannot be answered from a website |
| 116 | `NOT_EVALUABLE_ORDER[not_reachable].lede` | No crawl of a public storefront could establish these, whoever ran it. They rest on a record, a document or a person. |
| 120 | `NOT_EVALUABLE_ORDER[not_exposed].heading` | Looked for, not found on the site |
| 121 | `NOT_EVALUABLE_ORDER[not_exposed].lede` | The check ran against the merchant's pages and what it looks for was not there to measure. Each states what was sought and where. |
| 125 | `NOT_EVALUABLE_ORDER[not_applicable].heading` | Does not apply to these pages |
| 126 | `NOT_EVALUABLE_ORDER[not_applicable].lede` | The rule's subject is not on the page at all — a capsule labelling rule against a product that is not a capsule. Not a gap in the crawl or the site. |
| 130 | `NOT_EVALUABLE_ORDER[not_retrieved].heading` | Not retrieved on this run |
| 131 | `NOT_EVALUABLE_ORDER[not_retrieved].lede` | The request for these did not complete — a timeout or a connection failure. Nothing was established either way, and in particular nothing about the merchant. A re-run may resolve them. |
| 135 | `NOT_EVALUABLE_ORDER[unrecorded].heading` | Reason not recorded |
| 136 | `NOT_EVALUABLE_ORDER[unrecorded].lede` | This run was screened before Mintro separated these reasons, so which one applies was never written down. A completed run is never edited, so it stays as recorded. |
| 207 | `describeGroup()` — several pages | `${group.findings.length} observations across ${pages.size} pages` |
| 208 | `describeGroup()` — one page | `${group.findings.length} observations` |
| 268 | `NOTHING_OBSERVED_ID` — anchor the merchant callout targets | `nothing-observed` |

### `apps/web/src/lib/evidence.ts`

`EvidenceAccess.description`, rendered on the report's Evidence row.

| Line | Key | String |
|---|---|---|
| 43 | Supabase storage | `signed URLs from the private ${bucket} bucket, ${SIGNED_URL_TTL_SECONDS}s expiry` |
| 64 | local directory | local evidence directory (development only — not signed, not private) |
| 81 | unavailable | `evidence unavailable — ${reason}` |

### `apps/web/src/components/ReportView.tsx`

| Line | Key | String |
|---|---|---|
| 151 | report eyebrow | `Report · {formatReportDate(report.finishedAt)}` |
| 170 | access note headline — credential used | Product pages read with a merchant-supplied login. |
| 171 | access note headline — walled | Coverage limited by a login wall. |
| 184 | download button | `Rendering…` / `Download PDF` |
| 196 | invite button | Invite merchant response |
| 209 | send button | Send to IQwallet |
| 219 | run-level commentary card heading | Merchant response |
| 353 | `ObstructionNote` heading (D-136) | Surfaces this run could not reach |
| 356 | `ObstructionNote` lead | `{obstruction.unanswered} of {obstruction.attempted} requests for a page did not answer.` |
| 359 | `ObstructionNote` — no rules affected | No rule depended on them. |
| 360 | `ObstructionNote` — rules affected | `${obstruction.rulesAffected} rule(s) are unevaluated for that reason, rather than for anything observed about the merchant.` |
| 366 | URL list remainder | `and {more} more` |
| 384 | `VerdictBanner` badge | `{failed} FAILED` |
| 396 | `TickStrip` legend | failed |
| 397 | `TickStrip` legend | need review |
| 398 | `TickStrip` legend | passed |
| 399 | `TickStrip` legend | not evaluable from the site |
| 405 | `TickStrip` eyebrow | `All {report.strip.length} findings` |
| 412 | tick `title` attribute | `${tick.ruleId} — ${tick.title} — ${STATE_LABEL[tick.state]}` |
| 445 | `Filters` chip | Everything |
| 446 | `Filters` chip | Failed |
| 447 | `Filters` chip | Needs review |
| 448 | `Filters` chip | Passed |
| 449 | `Filters` chip | Not evaluable |
| 511 | `CoverageBreakdown` column | Evaluated · observed from the crawled surface |
| 512 | `CoverageBreakdown` column | Does not apply · the rule's subject is not on these pages |
| 513 | `CoverageBreakdown` column | Not checked · Mintro has not built these yet |
| 514 | `CoverageBreakdown` column | Not reachable · no crawl of a website could answer these |
| 515 | `CoverageBreakdown` column | Not exposed · this storefront did not carry them |
| 516 | `CoverageBreakdown` column | Not retrieved · this run could not fetch them |
| 517 | `CoverageBreakdown` column | Not recorded · screened before Mintro separated these |
| 525 | `CoverageBreakdown` eyebrow | Coverage |
| 527 | `CoverageBreakdown` split | `{c.resolved} resolved · {c.outstanding} outstanding · {c.total} rules` |
| 591 | `CoverageLine.itemise()` | `${n} ${text}` |
| 595 | resolved part | evaluated |
| 596 | resolved part | do not apply here |
| 600 | outstanding part | not checked — Mintro has not built these yet |
| 601 | outstanding part | need a surface no crawl reaches |
| 602 | outstanding part | looked for and not found on the site |
| 603 | outstanding part | this run could not fetch |
| 604 | outstanding part | recorded before this distinction existed |
| 610–612 | `CoverageLine` | `{resolved} of {total}` resolved ({resolvedParts}) |
| 616 | `CoverageLine` | `{outstanding}` outstanding ({outstandingParts}) |
| 642–644 | `LegacyCoverageLine` | `{evaluable} of {total}` evaluated |
| 648–649 | `LegacyCoverageLine` (D-047) | `{unevaluated} not evaluated — this run was screened before Mintro separated the reasons, so which applies was not recorded` |
| 698 | `CategoryCard` index | `String(index + 1).padStart(2, '0')` |
| 699 | `CategoryCard` name | `category.name` — from `rules/ruleset.json` |
| 705 | disclosure caret | ▶ |
| 761 | `FindingRow` state badge | `STATE_LABEL[finding.state]` |
| 780 | `FindingRow` evidence line | `▸ {source === undefined ? '—' : shorten(source)}` |
| 829 | `Requirement` left heading | `REQUIREMENT_HEADINGS.notAssessed` / `.observed` |
| 851 | `Requirement` right heading (D-138) | `REQUIREMENT_HEADINGS.mintroObservation` / `.required` |
| 854 | `Requirement` quotation | `finding.clause` — verbatim, no trim, no ellipsis, no sentence case |
| 927 | `StateSection` badge | `section.heading` |
| 929 | `StateSection` count | `{section.count} finding{section.count === 1 ? '' : 's'}` |
| 932 | `StateSection` lede | `section.lede` |
| 1020 | `GroupCard` state badge | `STATE_LABEL[group.state]` |
| 1025 | `GroupCard` count | `×{group.findings.length}` |
| 1029 | `GroupCard` lede | `describeGroup(group)` |
| 1060 | `RunMeta` label | Run |
| 1064 | `RunMeta` label | Rule set |
| 1065 | `RunMeta` value | `v{report.rulesetVersion}, effective {report.rulesetEffective}` |
| 1068 | `RunMeta` label | Politeness |
| 1072 | `RunMeta` label | Evidence |
| 1077 | `RunMeta` label | Truncated |
| 1088 | `describeMode()` | public crawl |
| 1090 | `describeMode()` | screening account |
| 1092 | `describeMode()` | assisted sign-in |

### `apps/web/src/components/EvidenceSlip.tsx`

Evidence kinds render distinctly and neither is ever drawn as the other (D-012).

| Line | Key | String |
|---|---|---|
| 34 | eyebrow, no-capture branch | Evidence |
| 39 | no-capture heading | No capture |
| 41–42 | no-capture body | This finding carries no stored evidence. It was produced before any surface was reached. |
| 53 | clause label, `pass` only (D-047) | Rule. |
| 65 | eyebrow | Evidence |
| 67 | evidence-kind badge | stored document / rendered page |
| 69 | capture stamp | `captured {formatStamp(primary.capturedAt)}` |
| 83 | key–value label | Source |
| 87 | key–value label | Method |
| 90 | method, documentary | fetched document · no browser |
| 91 | method, rendered | rendered DOM · headless Chromium |
| 96 | key–value label | SHA-256 |
| 110 | matched-URL remainder | `…and {primary.matchedUrls.length - 8} more` |
| 126 | attempts heading (hard constraint 3) | Requests attempted |
| 130 | attempt with no response | no response |
| 161 | documentary capture glyph | ▤ |
| 163 | documentary capture label | stored document |
| 165 | documentary capture, nothing retained | not retained |
| 212 | screenshot `alt` | Full-page screenshot captured during the run |
| 217 | screenshot placeholder | capture not reachable / loading capture… |
| 221 | screenshot caption | full-page PNG |

### `apps/web/src/components/Attestations.tsx`

Two sections after the findings, and one rule governing both: nothing here is an observation (D-134).
`AttestationForm` at the bottom of the file is the merchant's side of the same questions.

| Line | Key | String |
|---|---|---|
| 41 | `OUTCOME_LABEL.answered` | Answered |
| 42 | `OUTCOME_LABEL.declined` | Declined to answer |
| 43 | `OUTCOME_LABEL.unanswered` | Not answered |
| 53–54 | `UNANSWERED_BODY` | Not observable by Mintro, and not answered. Nothing in this report speaks to this requirement. |
| 58 | `AUTHORITY_LABEL.law` | Law |
| 59 | `AUTHORITY_LABEL.network` | Card network |
| 60 | `AUTHORITY_LABEL.programme` | Programme |
| 82 | `AttestationSection` heading | Stated by the merchant |
| 89–91 | `AttestationSection` lede | These are requirements of the programme that a crawl of a website cannot observe. Mintro put them to the merchant and recorded the replies exactly as written. **Nothing in this section was observed or verified by Mintro.** |
| 94–95 | `AttestationSection` counts | `{counts.answered} answered · {counts.declined} declined · {counts.unanswered} not answered · {counts.total} asked` |
| 121 | question text | `question.question` — from `rules/ruleset.json`, snapshotted onto the run |
| 125 | question meta | `{AUTHORITY_LABEL[question.authority]} · {question.sev}` |
| 138 | declined body | The merchant declined to answer this question. |
| 148–149 | attribution | `Written by someone who identified themselves as {question.identifiedAs}` + ` on {submittedAt}` |
| 181 | superseded disclosure | `{answers.length} earlier {answers.length === 1 ? 'answer' : 'answers'}` |
| 188 | superseded, declined | Declined to answer. |
| 215 | `NotCheckedSection` heading | What was not checked |
| 219–220 | `NotCheckedSection` rows | `item.subject` / `item.why` — from `rules/ruleset.json`, verbatim |
| 262 | `AttestationForm` heading (merchant-facing) | Questions the screening cannot answer |
| 263–267 | `AttestationForm` lede | Some programme requirements are about what happens away from your website — where you ship, what your support team says, who tests your batches. Mintro has no way to observe those, so they are put to you directly. Your answers are recorded exactly as you write them and passed on with the report, shown as yours. |
| 269–272 | `AttestationForm` lede, second paragraph (D-067) | You can answer any of these, or none. If you would rather not answer one, saying so is recorded as its own reply. |
| 331 | `AttestationField` — recorded, declined | Recorded: you chose not to answer this one. |
| 332 | `AttestationField` — recorded, answered | `Recorded: "${sent.body ?? ''}"` |
| 339 | textarea placeholder | Your answer / Add to or change your answer |
| 350 | submit button | `Saving…` / `Send answer` / `Send revised answer` |
| 357 | decline button | Prefer not to answer |
| 362 | not-yet-identified hint | Give an email address above before answering. |

### `apps/web/src/components/MerchantResponse.tsx`

Four of the five commentary states render here; `not_invited` renders nothing. Attribution is the
whole design (D-063) — a named source on every block, always.

| Line | Key | String |
|---|---|---|
| 51 | block heading, `unopened` | Merchant response |
| 53 | `unopened` body | This finding was opened for comment. The merchant has not opened the report. |
| 62 | block heading, `unidentified` | Merchant response |
| 64–65 | `unidentified` body | This finding was opened for comment. The report was opened and nobody identified themselves. |
| 73 | visitor entry | `${visit.identifiedAs} on ${visit.identifiedAt.slice(0, 10)}` |
| 78 | block heading, `no_comment` | Merchant response |
| 88 | `no_comment` body, first clause | This finding was opened for comment. |
| 90 | `no_comment`, nobody named | The report was opened and no comment was left on it. |
| 91 | `no_comment`, named | `Identified themselves as ${who}, and left no comment on it.` |
| 99 | block heading, `commented` | Merchant response |
| 116 | citation | `Identified themselves as {comment.identifiedAs}, {formatStamp(comment.submittedAt)}` |
| 117 | citation, later entries | ` — added after an earlier response` |
| 122–123 | disclaimer | Recorded as received and reproduced without alteration. Mintro has verified neither the response nor the address it was given under. |

### `apps/web/src/components/Participation.tsx`

The run-level record for IQwallet, and it goes in the PDF. Every line is a fact about delivery; a
finding with no response is **unanswered** and never "ignored", "declined" or "unexplained".

| Line | Key | String |
|---|---|---|
| 39 | heading, not invited | Merchant participation |
| 45 | not invited (Mintro's inaction, stated as ours) | No comment link was transmitted for this run, so the merchant was not asked to respond. |
| 55 | heading | Merchant participation |
| 58 | term | Invitation sent to |
| 61 | value, none recorded | not recorded |
| 63 | qualifier | ` — the link may be forwarded, so this is where it was sent rather than who used it` |
| 67 | term | Report first opened |
| 68 | value, never opened | Not opened. |
| 70 | term | Identified themselves |
| 74 | value, not opened | Nobody, and the report was not opened. |
| 77 | value, opened but unidentified | The report was opened and nobody identified themselves. |
| 83 | visitor entry | `{visit.identifiedAs} on {visit.identifiedAt.slice(0, 10)}` |
| 92–93 | self-declaration qualifier | Self-declared. Mintro has verified neither these addresses nor the responses given under them. |
| 99 | term | Responses |
| 101 | value | `{answered} of {offered} findings open for response were answered.` |
| 112 | remainder — a count and nothing more (D-074) | `The remaining {unanswered} carry no response.` |
| 135 | list heading | Responded to |
| 139 | list entry | `finding.title` |
| 141 | list entry qualifier | ` — page {finding.ordinal + 1}` |

### `apps/web/src/components/QuarantineNotice.tsx`

Shown above the findings of a run whose captures cannot be resolved (D-033, D-034). It states an
observation about the record and stops — it does not filter the run out of the list, and it does not
say the findings are wrong.

| Line | Key | String |
|---|---|---|
| 29 | tag | Evidence incomplete |
| 31 | lede | Some captures behind these findings cannot be retrieved. |
| 34 | reason | `reason` — from `public.run_quarantine` |
| 42 | badge `title` | Evidence incomplete — some captures cannot be retrieved |
| 43 | badge | evidence incomplete |

---

## The merchant's own page

### `apps/web/src/components/CommentPane.tsx`

Reached by `?comment=<token>` with no account and no session. Renders the same `ReportView` the
analyst sees, minus every operator action (D-066) and minus `MerchantResponse`, which would narrate
the reader's own behaviour back at them (D-067).

| Line | Key | String |
|---|---|---|
| 91 | read failed — not the same as an invalid link (D-036) | The report could not be loaded just now. Please try again shortly. |
| 98 | fallback when the function returns no reason | this link is not valid |
| 114 | loading | Loading the report… |
| 124 | eyebrow, invalid link | Screening report |
| 125 | heading, invalid link | This link cannot be opened |
| 128–129 | invalid link, recovery | Replying to the message that carried this link reaches a person. Anything already written on this report is kept. |
| 261 | identify failure fallback | That could not be saved just now. Please try again. |
| 301 | attestation before identifying | Please give an email address above before answering. |
| 316 | attestation failure fallback | That could not be saved just now. Please try again. |
| 328 | comment before identifying | Please give an email address above before writing a response. |
| 348 | comment failure fallback | That could not be saved just now. Please try again. |
| 378 | eyebrow | `Screening report · {opened.merchantDomain}` |
| 379 | heading — the ask, not the document (D-067) | Your response |
| 387–389 | lede | The team reviewing your account asked Mintro to screen your public pages against the peptide research-use programme rule set. This is what was observed, with the capture behind each one. |
| 400 | count, leading the second paragraph | `{invited.length} observations are open for your response.` |
| 400–403 | second paragraph — "or none" before anything is asked | You can respond to any of them, or none. What you write is recorded exactly as you write it, shown as yours, and passed to the team reviewing your account with the report. Mintro does not edit it, shorten it, or reply to it. |
| 409–411 | link lifetime and forwarding | This link works until {expiresAt}. It can be forwarded — whoever responds says who they are, and each response is shown against the address given when it was written. |
| 416–417 | contact line (D-065) | Questions about this request, or want to confirm it is genuine? Contact your usual point of contact at Mintro, or the agent who sent this to you. |
| 507 | `NothingObservedCallout` heading (D-067, D-069) | `{count} where your pages did not show one way or the other` |
| 513 | callout jump link | Jump to these |
| 528–532 | callout body | For these, your public pages did not show either way — an order-handling practice, a page behind a login, a document not published. **A response here adds more than anywhere else on this report**, because there is nothing on the site for the team reviewing your account to read instead. You can describe how your site handles it now, or how you intend to. |
| 573–574 | `Identify` — already identified | `Responding as {identity.email}. Each response below is recorded against this address.` |
| 582 | `Identify` — hand-off button (D-071) | Someone else responding? |
| 591 | `Identify` — field label | Your email address |
| 601–603 | `Identify` — hint | Needed before you can respond, so the team reviewing your account can see who answered. Each response is shown against the address you give. |
| 625 | `Identify` — button | `Saving…` / `Continue` |
| 666 | `CommentBox` — prior entry attribution | `{comment.identifiedAs} · {formatStamp(comment.submittedAt)}` |
| 672 | `CommentBox` — prior entries hint | Anything you add is kept alongside what is already here, not in place of it. |
| 678 | `CommentBox` — label | Add to your response / Your response |
| 687 | `CommentBox` — label qualifier, on every box (D-067) | optional |
| 708 | `CommentBox` — placeholder (D-067, hard constraint 7) | How does your site handle this, now or in future? |
| 713 | `CommentBox` — not-yet-identified hint | Give an email address at the top of the page to respond. |
| 731 | `CommentBox` — submit | `Saving…` / `Save response` |

### `apps/web/src/App.tsx`

| Line | Key | String |
|---|---|---|
| 180 | `MerchantRoute` — no Supabase configuration | This report cannot be loaded: the site is not configured. |
| 1038 | `PrintHeader` — lockup `alt` | Mintro |
| 1040 | `PrintHeader` — meta | `Rule set v{report.rulesetVersion} · effective {report.rulesetEffective}` |
| 1042 | `PrintHeader` — meta | `Run {report.runId}` |
| 1226–1227 | `commentaryProps()` — commentary read failed | The merchant responses for this run could not be read, so none are shown below. This is a failure to read them, not an absence of them. |

### `supabase/migrations/0016_merchant_commentary.sql`

`reason` values returned to the merchant page and rendered as-is. One answer covers "no such token"
and "expired" deliberately — a caller holding a bad token learns nothing from the difference.

| Line | Key | String |
|---|---|---|
| 282 | `open_report_for_comment` | this link is not valid |
| 291 | `open_report_for_comment` | this run has no report to comment on |
| 362 | `identify_for_comment` | this link is not valid |
| 366 | `identify_for_comment` | an email address is needed before commenting |
| 408 | `submit_merchant_comment` | this link is not valid |
| 417 | `submit_merchant_comment` | an email address is needed before commenting |
| 423 | `submit_merchant_comment` | nothing was written |

### `supabase/migrations/0044_merchant_attestations.sql`

| Line | Key | String |
|---|---|---|
| 128 | `submit_merchant_attestation` | this link is not valid |
| 136 | `submit_merchant_attestation` | an email address is needed before answering |
| 140 | `submit_merchant_attestation` | an answer is either answered or declined |
| 149 | `submit_merchant_attestation` | nothing was written |

---

## Where this wording is enforced

Listed so that anyone editing a string above knows what will go red, and so that a string with no
guard behind it is visible as such.

| Guard | What it holds |
|---|---|
| `apps/worker/test/copy.test.ts` | Every generated finding, the verdict, the invitation and the covering email, audited against `DIRECTIVE_TERMS`, `DETERMINATION_TERMS` and `auditInternalVocabulary`, across all five real runs. |
| `apps/worker/test/requirement.test.ts` | The Observed / Program requirement pair: the requirement byte-identical to the rule's `clause`, the observation free of directive language. |
| `apps/web/test/reportRequirement.test.ts` | The rendered pair, including which heading a `source: mintro` rule gets (D-138). |
| `apps/web/test/attestationSection.test.ts` | That an unanswered question renders `UNANSWERED_BODY` rather than a blank. |
| `apps/web/test/grouping.test.ts` | Section headings and ledes, and that `fail` never collapses. |
| `apps/web/test/anchors.test.ts` | That `NothingObservedCallout`'s link and `NOTHING_OBSERVED_ID` meet (D-069). |
| `apps/web/test/merchantRoute.test.ts` | That the merchant route renders no operator action (D-066). |
| `apps/web/test/bundledControls.test.ts` | That each control's copy is present in the emitted JavaScript (D-131). |
| `apps/worker/test/inviteJob.test.ts` | That the count in the invitation is the count the merchant will see, computed by one predicate, and that a dry run is recorded as a dry run. |
| `apps/worker/test/send.test.ts` | The send log — what went out, to whom, under which mailer, accepted or refused. |
| `packages/ruleset` validator (`npm run validate`) | That every rule has a `title` and a `clause`, and that a malformed rule set exits 1. |

## Two things this inventory surfaced

Neither is a defect and neither was changed. Both are wording facts that only show up when the
strings are read side by side.

1. **"Merchant response" is typed out in five places** — the run-level card in `ReportView.tsx:219`,
   and each of the four commentary states in `MerchantResponse.tsx` (51, 62, 78, 99). Repeating it on
   every block is deliberate under D-063 — a named source, never implied by position — but the string
   itself is a literal in all five, unlike `REQUIREMENT_HEADINGS`, which was made a constant for
   exactly this reason.

2. **`describeCommentary` has no render site.** `packages/engine/src/commentary.ts:172–200` composes a
   one-line run-level statement of the five commentary states, and it is exported through
   `index.ts` and `browser.ts` — but the only callers in the repository are
   `packages/engine/test/commentary.test.ts`. What actually reaches a reader is
   `ParticipationRecord` (`apps/web/src/components/Participation.tsx:45–112`), which states the same
   five facts as a definition list rather than a sentence. The two agree today; nothing checks that
   they still will.
