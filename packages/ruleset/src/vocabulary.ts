/**
 * Closed vocabularies for the rule set.
 *
 * Every value here is a term the engine must understand in order to act. Adding a member
 * is therefore a code change by definition — a new check type needs a handler, a new tier
 * needs a state mapping, a new surface needs a crawler that can reach it. That is the line
 * hard constraint 1 draws: rules are data, but the vocabulary rules are written in is code.
 */

/**
 * The four states. A rule that cannot be observed from the crawled surface returns
 * `not_evaluable` — never `pass`. See hard constraint 2 and D-009.
 */
export const STATES = ['fail', 'review', 'pass', 'not_evaluable'] as const;
export type State = (typeof STATES)[number];

/**
 * Check types. Each selects a handler in the engine. See docs/ARCHITECTURE.md § Check types.
 */
export const CHECK_TYPES = [
  'url_pattern',
  'http_probe',
  'dom_assert',
  'text_match',
  'text_cooccurrence',
  'computed_style',
  'doc_parse',
  'flow_probe',
  'manual',
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/**
 * Tier decides state on violation, and nothing else decides it. See D-009.
 */
export const TIERS = ['auto_fail', 'review_only'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * What the evaluation does with a rule (D-259). A separate axis from `tier`.
 *
 * `tier` answers *"what state does a violation produce"* and feeds `stateForViolation`. This
 * answers *"what part does this rule play when the site is read as a business"*:
 *
 *   `legality` — a law, regulation or card-network violation. Any one observed ends it.
 *   `routing`  — a solution condition. It decides where a merchant can be placed, not whether.
 *   `evidence` — everything else. Cited under an angle, never decisive on its own.
 *
 * **Deliberately not called `tier`.** That name is taken by the auto_fail/review_only axis above,
 * which `packages/engine/src/report.ts` writes into every assembled report — and those reports are
 * frozen under D-002. Reusing the key would leave it meaning one thing in every run to date and
 * another in every run after, inside immutable documents. See D-259.
 */
export const EVALUATION_TIERS = ['legality', 'routing', 'evidence'] as const;
export type EvaluationTier = (typeof EVALUATION_TIERS)[number];

/**
 * How much a rule carries when an angle cites it (D-259, amended 2026-09-09).
 *
 * **Evidence and routing tiers. Never legality.** The original ruling put weight on evidence
 * alone, on the reasoning that a routing rule "names a condition" and so is not weighed. The
 * amendment found that wrong in the direction that matters: the routing conditions are not equally
 * consequential, and flattening them lost the difference between a catalogue selling syringes and
 * one whose affiliate page is untidy. Both are conditions; only one changes where a merchant can
 * be placed.
 *
 * Legality stays bare, and that is not symmetry for its own sake. A legality item observed ends
 * the evaluation — there is nothing for a weight to modulate, so a number there would be one
 * nothing reads, and `invariants.ts` refuses it.
 */
export const RULE_WEIGHTS = ['heavy', 'ordinary'] as const;
export type RuleWeight = (typeof RULE_WEIGHTS)[number];

/**
 * The tiers that carry a weight. The complement of this is exactly `legality`.
 *
 * Named rather than written as `!== 'legality'` at each site, so the rule is stated once and the
 * two invariants below cannot drift into disagreeing about it.
 */
export const WEIGHTED_TIERS = ['evidence', 'routing'] as const;

export function tierCarriesWeight(tier: EvaluationTier): boolean {
  return (WEIGHTED_TIERS as readonly string[]).includes(tier);
}

/**
 * The ratified legality and routing sets, pinned here rather than left to the data (D-259).
 *
 * These are closed lists Frank ratified, not a shape the data may grow into. A seventh legality
 * rule arriving by edit is a business decision that needs a decision number, and until it has one
 * the file should be refused. Every other rule is `evidence` by the catch-all, so only these two
 * need naming.
 */
export const LEGALITY_RULE_IDS = [
  'CATG-003',
  'CATG-004',
  'PAY-001',
  'PROD-006',
  'PROD-008',
  'PROD-015',
] as const;

export const ROUTING_RULE_IDS = [
  'GATE-002',
  'GATE-003',
  'CATG-001',
  'CATG-002',
  'CATG-005',
  'OFFS-001',
  'OFFS-007',
] as const;

/**
 * Severity drives report ordering only. It never affects state — see D-009. It is
 * deliberately not consulted anywhere in this package beyond validating its value.
 */
export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Crawl layers. See docs/ARCHITECTURE.md § Crawl layering. `null` means the rule is not
 * reachable by crawling at all, which is true of exactly the `manual` check type.
 */
export const LAYERS = [0, 1, 2, 3] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Named surfaces a check can be pointed at. The crawler must know how to reach each one,
 * so this is a closed set.
 */
export const SURFACES = [
  'homepage',
  'product',
  'all_sampled',
  'footer',
  'register',
  'terms',
  'faq',
  'shipping_policy',
  'checkout',
  'checkout_and_footer',
  /**
   * The footer plus any payment or policy page a visitor reaches without an account (D-049).
   *
   * Replaces `checkout_and_footer` for PAY-001. That surface made the rule resolvable only for
   * merchants who *fail* GATE-002 and GATE-003, because a merchant who gates checkout — which is
   * what those rules require — has no checkout an anonymous crawl can read. A rule that can only
   * speak about non-compliant merchants is inverted.
   *
   * Peer-to-peer payment rails are advertised, not hidden: a merchant taking Zelle says so where
   * customers can see it. The footer and the public policy pages are where that appears.
   */
  'footer_and_public_pages',
] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * URL scopes for Layer 0 slug matching.
 *
 * `content` is defined negatively — a URL that is neither a product nor a collection nor a
 * utility path — because editorial content has no path segment in common across platforms.
 * Shopify puts it under `/pages/` and `/blogs/`; WordPress storefronts serve it from the root
 * alongside everything else. A scope that only matched a segment would miss the latter entirely,
 * which is the case OFFS-006 exists for (D-020).
 *
 * Its accuracy therefore depends on how well products were classified. Where the catalogue was
 * not identified, `content` is close to "every URL" and a rule scoped to it should say so.
 */
export const URL_SCOPES = ['all', 'collections', 'products', 'pages', 'content'] as const;
export type UrlScope = (typeof URL_SCOPES)[number];

/** Assertion direction shared by the presence-testing check types. */
export const EXPECTATIONS = ['present', 'absent'] as const;
export type Expectation = (typeof EXPECTATIONS)[number];

/** How many sampled pages must satisfy a check for it to hold. */
export const THRESHOLDS = ['all', 'any'] as const;
export type Threshold = (typeof THRESHOLDS)[number];

/**
 * Non-assertion things a `dom_assert` rule can be asked to gather rather than test.
 * OFFS-003 collects social handles for the report instead of asserting on them.
 */
export const DOM_COLLECTS = ['social_handles'] as const;
export type DomCollect = (typeof DOM_COLLECTS)[number];

/** Things a `dom_assert` rule can be asked to identify on a page. */
export const DOM_DETECTS = ['gateway'] as const;
export type DomDetect = (typeof DOM_DETECTS)[number];

/** Values a `doc_parse` rule can pull out of a COA. Each needs an extractor in the parser. */
/**
 * Values a `doc_parse` rule can pull from a certificate.
 *
 * `report_date` replaced `test_date` in D-058. The rule asks whether a COA has been "updated at
 * minimum every 60 days", and updated means the certificate was **issued**, not when the sample
 * was drawn — a merchant publishing a certificate reported 22 July has updated their documentation
 * as of 22 July.
 *
 * The rename is the point. Leaving the param named `test_date` while the reader accepts a report
 * date would be the reader quietly answering a different question from the one the rule names,
 * which is the failure D-052 is about.
 */
export const DOC_EXTRACTS = ['report_date', 'purity_pct'] as const;
export type DocExtract = (typeof DOC_EXTRACTS)[number];

/** Fields a COA can be required to contain. */
/**
 * Fields COA-004 requires a certificate to carry.
 *
 * `test_date` stays here and is **not** renamed alongside `DOC_EXTRACTS`. COA-004 asks what the
 * certificate identifies, and the program document names a testing date among them; COA-002 asks
 * how recently the document was updated. They are different questions and the names now say so.
 */
export const COA_FIELDS = ['batch_lot', 'test_date', 'compound', 'purity_pct', 'method'] as const;
export type CoaField = (typeof COA_FIELDS)[number];

/** Scripted interactions available to `flow_probe`. Each is a piece of worker code. */
export const FLOWS = ['add_to_cart_then_checkout', 'checkout_address_validation'] as const;
export type Flow = (typeof FLOWS)[number];

/** Outcomes a `flow_probe` can treat as a violation. */
export const FLOW_FAILURES = ['payment_step_reached', 'accepted'] as const;
export type FlowFailure = (typeof FLOW_FAILURES)[number];

/** Rule ID format. Stable, never reused. See CLAUDE.md § Conventions. */
export const RULE_ID_PATTERN = /^[A-Z]+-\d{3}$/;

/** Category ID prefix format, as declared by `categories[].prefix`. */
export const CATEGORY_PREFIX_PATTERN = /^[A-Z]+$/;
