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
] as const;
export type Surface = (typeof SURFACES)[number];

/** URL scopes for Layer 0 slug matching. */
export const URL_SCOPES = ['all', 'collections', 'products', 'pages'] as const;
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
export const DOC_EXTRACTS = ['test_date', 'purity_pct'] as const;
export type DocExtract = (typeof DOC_EXTRACTS)[number];

/** Fields a COA can be required to contain. */
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
