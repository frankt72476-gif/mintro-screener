/**
 * Screening one storefront, end to end.
 *
 * Layer 0, then Layer 1, then Layer 0 again with what Layer 1 learned, then Layer 2 over a sample
 * of product pages. Returns the assembled report and every capture taken.
 *
 * ## Why this is a module and not a CLI function
 *
 * Two callers need it: `bin/scan.ts` (an analyst at a terminal) and `bin/worker.ts` (the Fly
 * machine draining the queue). D-035 is the reason it lives here rather than being written twice —
 * the last time this project had two paths that did the same thing, only one of them was ever run
 * and four defects lived in the other. A queue worker that crawls *slightly* differently from the
 * command everyone tests with is that mistake with a job table attached.
 *
 * The order matters. Layer 0 runs first because robots.txt carries the `Crawl-delay` the browser
 * must then observe (D-013) — rendering before reading it would mean the first browser request
 * ignored a delay the site had already declared.
 *
 * Nothing here writes to a database or to disk. It crawls and returns; the caller decides where
 * the result goes. That is the same split as the check handlers (`CLAUDE.md`: handlers are pure,
 * side effects happen in the runner).
 */

import type { Browser, BrowserContext } from 'playwright';
import type { Ruleset } from '@mintro/ruleset';
import {
  createHttpFetcher,
  createPacer,
  describeCrawlDelay,
  discoverLayer0,
  layer0Rules,
  reclassify,
  resolveCrawlDelay,
  runLayer1,
  assembleReport,
  checkUrlPattern,
  inScope,
  layer2Rules,
  runLayer2,
  scoreProductUrls,
  selectSample,
  tally,
  type EvidenceArtifact,
  type Finding,
  type Layer0Result,
  type PageContext,
  type SampledPage,
  type ScopeOverrides,
  type ScreeningReport,
  type SessionDescriptor,
} from '@mintro/engine';
import { renderPage } from './render.js';
import { runGateRules, type AnonymousAccess } from './gate.js';
import { probePaths } from './probe.js';
import { runCheckoutFlow } from './flow.js';

/** Product pages sampled per run. ARCHITECTURE.md budgets 3-5. */
export const SAMPLE_SIZE = 5;

export interface ScreenOptions {
  readonly runId: string;
  /** Progress lines. The CLI prints them; the worker records them against the queue row. */
  readonly onProgress?: (line: string) => void;
  /**
   * A context carrying the merchant's supplied session, for pages behind their login (M9).
   *
   * It is used for Layer 1 and Layer 2 rendering only. **The gate rules never see it**: they are
   * run by `runGateRules`, whose API has no parameter that could carry a session, against an
   * anonymous access built here from a fresh context (D-039).
   *
   * A credential widens what is visible. It never narrows what is reported.
   */
  readonly authenticated?: BrowserContext;
  /** How the session was obtained, recorded on the findings it produced. */
  readonly session?: SessionDescriptor;
}

export interface ScreenResult {
  readonly report: ScreeningReport;
  readonly artifacts: readonly EvidenceArtifact[];
  readonly layer0: Layer0Result;
  readonly homepage: PageContext;
  readonly sampled: readonly SampledPage[];
  readonly findings: readonly Finding[];
}

export async function screenStorefront(
  browser: Browser,
  target: string,
  ruleset: Ruleset,
  options: ScreenOptions,
): Promise<ScreenResult> {
  const { runId } = options;
  const say = options.onProgress ?? ((): void => undefined);
  const startedAt = new Date().toISOString();
  const artifacts: EvidenceArtifact[] = [];

  // ---- Layer 0, which also tells us how politely to behave from here on ----------------
  const fetcher = createHttpFetcher({ timeoutMs: 15_000 });
  const layer0 = await discoverLayer0(target, fetcher, { runId });
  artifacts.push(...layer0.artifacts);

  const delay = resolveCrawlDelay(layer0.robots.crawlDelaySeconds);
  const pacer = createPacer(delay);

  say(`${layer0.origin} · politeness ${describeCrawlDelay(delay)}`);

  // ---- Layer 1 -------------------------------------------------------------------------
  const homepage = `${layer0.origin}/`;
  const rendered = await renderPage(browser, homepage, {
    runId,
    pacer,
    timeoutMs: 30_000,
    ...(options.authenticated === undefined ? {} : { context: options.authenticated }),
  });
  artifacts.push(...rendered.artifacts);

  say(
    rendered.page.renderError !== undefined
      ? `homepage render FAILED — ${rendered.page.renderError}`
      : `homepage HTTP ${rendered.page.httpStatus} · footer ${rendered.page.footer.found ? 'located' : 'NOT FOUND'}`,
  );

  const layer1 = runLayer1(rendered.page, ruleset);

  // ---- feed what Layer 1 learned back into the Layer 0 classifier -----------------------
  const overrides = toScopeOverrides(rendered.page);
  const improved = reclassify(layer0, overrides);
  const before = layer0Rules(ruleset).map((rule) => checkUrlPattern(rule, layer0));
  const after = layer0Rules(ruleset).map((rule) => checkUrlPattern(rule, improved));

  const gained = before.filter(
    (finding, i) => finding.state === 'not_evaluable' && after[i]?.state !== 'not_evaluable',
  );
  say(
    gained.length > 0
      ? `${gained.length} Layer 0 rule(s) became evaluable: ${gained.map((f) => f.ruleId).join(', ')}`
      : 'no Layer 0 rule changed state from the rendered structure',
  );

  // ---- Layer 2: sample product pages by suspicion score --------------------------------
  const productUrls = improved.urls.filter((url) => inScope(url, 'products'));
  const scored = scoreProductUrls(productUrls, ruleset);
  const selected = selectSample(scored, SAMPLE_SIZE);

  say(`sampling ${selected.length} of ${productUrls.length} product page(s)`);

  const selectors = ruleSelectors(ruleset);
  const sampled: SampledPage[] = [];

  for (const pick of selected) {
    const result = await renderPage(browser, pick.url.url, {
      runId,
      pacer,
      selectors,
      timeoutMs: 30_000,
      // Where a merchant login earns its keep: product pages behind the wall.
      ...(options.authenticated === undefined ? {} : { context: options.authenticated }),
    });
    artifacts.push(...result.artifacts);
    sampled.push({ selection: pick, page: result.page });
  }

  const layer2 = runLayer2(sampled, ruleset);

  // ---- the gate rules, always without a session -----------------------------------------
  //
  // Built here, from `browser`, and deliberately not from `options.authenticated`. `probePaths`
  // with `authenticated: null` creates its own anonymous context; `runGateRules` could not accept
  // a session even if one were offered.
  const anonymous: AnonymousAccess = {
    probe: (paths) =>
      probePaths(browser, layer0.origin, paths, { authenticated: null, timeoutMs: 20_000 }),

    async flow(productUrl) {
      const context = await browser.newContext();
      try {
        return await runCheckoutFlow(context, { productUrl, origin: layer0.origin, timeoutMs: 20_000 });
      } finally {
        await context.close().catch(() => undefined);
      }
    },
  };

  const firstProduct = selected[0]?.url.url ?? improved.urls.find((url) => inScope(url, 'products'))?.url;
  const gate = await runGateRules({
    ruleset,
    access: anonymous,
    ...(firstProduct === undefined ? {} : { productUrl: firstProduct }),
  });

  say(`gate rules evaluated without a session: ${gate.map((f) => `${f.ruleId} ${f.state}`).join(', ')}`);

  const findings: Finding[] = [...layer1.findings, ...after, ...layer2.findings, ...gate];

  const counts = tally(findings);
  say(
    `${counts.fail} fail · ${counts.review} review · ${counts.pass} pass · ${counts.not_evaluable} not evaluable ` +
      `· ${artifacts.length} capture(s)`,
  );

  const report = assembleReport(
    {
      runId,
      merchantDomain: new URL(layer0.origin).host,
      ...(rendered.page.title === '' ? {} : { merchantName: rendered.page.title }),
      ...(rendered.page.shop.platform === undefined ? {} : { platform: rendered.page.shop.platform }),
      mode: 'public',
      startedAt,
      finishedAt: new Date().toISOString(),
      findings,
      truncations: layer0.truncations,
      politeness: describeCrawlDelay(delay),
    },
    ruleset,
  );

  return { report, artifacts, layer0: improved, homepage: rendered.page, sampled, findings };
}

/**
 * Every CSS selector the rule set asks about, so the renderer can evaluate them in the page.
 *
 * Read from the rules rather than listed here: a selector is rule content, and a handler that
 * cannot query the DOM still needs the answer.
 */
export function ruleSelectors(ruleset: Ruleset): string[] {
  const selectors = new Set<string>();
  for (const rule of layer2Rules(ruleset)) {
    if (rule.type === 'dom_assert' && rule.params.selector !== undefined) {
      selectors.add(rule.params.selector);
    }
  }
  return [...selectors];
}

/**
 * Turns what Layer 1 saw into scope overrides.
 *
 * A path segment is learned only when the observed product URLs agree on one — a single sample
 * is a coincidence, not a structure. Observed URLs are always passed through exactly, so a
 * storefront with no common segment still gains the products it demonstrably has.
 */
export function toScopeOverrides(page: PageContext): ScopeOverrides {
  const segments = commonSegment(page.shop.productUrls);

  return {
    ...(segments === null ? {} : { segments: { products: [segments] } }),
    knownUrls: {
      products: page.shop.productUrls,
      collections: page.shop.collectionUrls,
    },
  };
}

/** The path segment shared by every observed product URL, if there is one. */
function commonSegment(urls: readonly string[]): string | null {
  if (urls.length < 2) return null;

  const firstSegments = urls.map((url) => {
    try {
      return new URL(url).pathname.split('/').filter((s) => s !== '')[0] ?? '';
    } catch {
      return '';
    }
  });

  const candidate = firstSegments[0];
  if (candidate === undefined || candidate === '') return null;
  return firstSegments.every((segment) => segment === candidate) ? candidate : null;
}
