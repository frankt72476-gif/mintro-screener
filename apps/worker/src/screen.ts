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
import type { ProgressEvent } from '@mintro/engine';
import { createScanProgress } from './scanProgress.js';
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
  describeSampleCollapse,
  runLayer2,
  runLayer3,
  scoreProductUrls,
  selectSample,
  tally,
  assessWall,
  wasServed,
  type EvidenceArtifact,
  type Finding,
  type Layer0Result,
  type PageContext,
  type SampledPage,
  type ReportAccess,
  type ScanMode,
  type ScopeOverrides,
  type ScreeningReport,
  type WallAssessment,
} from '@mintro/engine';
import { renderPage } from './render.js';
import { runGateRules, type AnonymousAccess } from './gate.js';
import { discoverLayer3 } from './signup.js';
import { coaLinkVocabulary, fetchCertificate } from './coa.js';
import { probePaths } from './probe.js';
import { runCheckoutFlow } from './flow.js';

/** Product pages sampled per run. ARCHITECTURE.md budgets 3-5. */
export const SAMPLE_SIZE = 5;

export interface ScreenOptions {
  readonly runId: string;
  /** Progress lines. The CLI prints them; the worker records them against the queue row. */
  /**
   * Progress, with structure (D-173).
   *
   * Was `(line: string) => void`. The sentence is unchanged and still the current-state line; what
   * the event adds is the phase it belongs to and, where one is genuinely known, a count.
   */
  readonly onProgress?: (event: ProgressEvent) => void;
  /**
   * Establishes a merchant session, when one turns out to be needed (D-040).
   *
   * **Called only after an anonymous crawl has been refused**, and never before. The analyst does
   * not choose an access mode: the crawl runs public, and if the sampled product pages come back
   * unserved *and* this callback yields a session, the product pages are re-rendered with it.
   *
   * Returns null when no credential is stored for this merchant, which is not a failure — it is
   * the honest answer, and the report says coverage was limited by a wall rather than pretending
   * the catalogue was empty.
   *
   * **The gate rules never see the result.** They are run by `runGateRules`, whose API has no
   * parameter that could carry a session, against an anonymous access built here from a fresh
   * context (D-039). A credential widens what is visible; it never narrows what is reported.
   */
  readonly escalate?: () => Promise<BrowserContext | null>;
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
  const progress = createScanProgress(options.onProgress ?? ((): void => undefined));
  const say = (line: string, count?: { done: number; total: number }): void =>
    progress.say(line, count);
  const startedAt = new Date().toISOString();
  const artifacts: EvidenceArtifact[] = [];

  // ---- Layer 0, which also tells us how politely to behave from here on ----------------
  const fetcher = createHttpFetcher({ timeoutMs: 15_000 });
  const layer0 = await discoverLayer0(target, fetcher, { runId });
  artifacts.push(...layer0.artifacts);

  const delay = resolveCrawlDelay(layer0.robots.crawlDelaySeconds);
  const pacer = createPacer(delay);

  progress.enter('discovery', `${layer0.origin} · politeness ${describeCrawlDelay(delay)}`);

  // ---- Layer 1 -------------------------------------------------------------------------
  const homepage = `${layer0.origin}/`;
  // Anonymous, always. The homepage is where the footer disclosure rules are read, and those
  // describe what a customer sees — reading them while signed in would answer a different
  // question. Escalation, if it happens at all, reaches the product sample and nothing else.
  const rendered = await renderPage(browser, homepage, { runId, pacer, timeoutMs: 30_000 });
  artifacts.push(...rendered.artifacts);

  progress.enter(
    'homepage',
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

  // The denominator the sample is drawn from, recorded once and read twice: by the count on every
  // page below, and by `sampleBasis()` when the report is assembled (D-162, D-173).
  progress.scopeIs(productUrls.length);
  progress.enter('sample', `sampling ${selected.length} of ${productUrls.length} product page(s)`);

  const selectors = ruleSelectors(ruleset);

  const renderSample = async (context?: BrowserContext): Promise<SampledPage[]> => {
    const pages: SampledPage[] = [];
    for (const pick of selected) {
      const result = await renderPage(browser, pick.url.url, {
        runId,
        pacer,
        selectors,
        timeoutMs: 30_000,
        ...(context === undefined ? {} : { context }),
      });
      artifacts.push(...result.artifacts);
      pages.push({ selection: pick, page: result.page });
      /*
        A real denominator: the sample was chosen before the loop and its size cannot change here.

        This counts pages **attempted**, which is not the same quantity as `productsSampled` on the
        report — that one counts pages that came back served, and a page not yet rendered cannot be
        known to have been served. Reporting attempts as successes is the overstatement the whole
        model exists to avoid, so they stay two numbers about two things (D-173).
      */
      progress.say(`product page ${pages.length} of ${selected.length}`, {
        done: pages.length,
        total: selected.length,
      });
    }
    return pages;
  };

  // ---- public first, always ---------------------------------------------------------------
  let sampled = await renderSample();
  let wall = assessWall(sampled.map((entry) => entry.page));
  let usedCredential = false;
  let mode: ScanMode = 'public';

  progress.sampleIs(sampled.filter((entry) => wasServed(entry.page)).length);
  say(wall.reason);

  /*
    Did the sample actually cover five pages (D-062)?

    Five distinct URLs cannot legitimately render byte-identical captures by accident, and a login
    wall sending every product URL to one sign-in page would make every product-surface finding
    describe that page while reporting on five. Nothing was watching for it until now.
  */
  const collapse = describeSampleCollapse(sampled);
  if (collapse !== null) say(`  ${collapse}`);

  // ---- escalate only on an observed refusal ------------------------------------------------
  //
  // The condition is what was *observed*, not what anyone selected. A credential is applied when
  // the anonymous crawl was refused and one exists; otherwise the report says coverage was
  // limited and why. Nobody is asked to predict which it will be (D-040).
  if (wall.walled && options.escalate !== undefined) {
    const context = await options.escalate();

    if (context === null) {
      progress.enter(
        'escalate',
        'a login wall was met and no screening account is stored for this merchant',
      );
    } else {
      progress.enter(
        'escalate',
        'a login wall was met; re-rendering the sample with the stored screening account',
      );
      const retried = await renderSample(context);
      const afterWall = assessWall(retried.map((entry) => entry.page));

      // Kept only if it actually got further. A credential that failed to change what was served
      // has widened nothing, and reporting `screening_account` on that basis would overstate what
      // the run saw — the same false-coverage shape as reporting an unobservable rule as passing.
      if (afterWall.served > wall.served) {
        sampled = retried;
        wall = afterWall;
        usedCredential = true;
        mode = 'screening_account';
        // The sample was replaced wholesale, so `served` is recomputed rather than incremented.
        progress.sampleIs(retried.filter((entry) => wasServed(entry.page)).length);
        say(`signed in: ${afterWall.reason}`);
      } else {
        say('the screening account did not reach the product pages either; keeping the public crawl');
      }
    }
  }

  /*
    The certificate of analysis, for the COA rules (D-057).

    Fetched from the sampled product pages' own links, established as a PDF by its magic number
    rather than by the server's content type, and stored in full. Skipped when nothing linked to
    one — the COA rules then report that, and never read `pass` from an absent certificate.
  */
  const coaContext = await browser.newContext();
  let coa;
  try {
    const coaPage = await coaContext.newPage();
    coa = await fetchCertificate(coaPage, sampled.map((entry) => entry.page), {
      runId,
      pacer,
      // One vocabulary, read from the rule set, shared with COA-001 (D-059).
      vocabulary: coaLinkVocabulary(ruleset),
      onProgress: say,
    });
  } finally {
    await coaContext.close().catch(() => undefined);
  }
  artifacts.push(...coa.artifacts);

  const layer2 = runLayer2(sampled, ruleset, coa?.outcome);

  // ---- Layer 3: the surfaces reached by doing something ----------------------------------
  //
  // The sign-up form and the terms document (D-048). Anonymous, and through the same pacer as
  // everything else: this adds page loads to an origin already being crawled, which is the case
  // `Crawl-delay` exists for (D-013).
  //
  // Placed before the gate block and taking no part in it. GATE-002 and GATE-003 are decided by
  // `runGateRules` from requests carrying no session, and nothing here touches that (D-039).
  progress.enter('surfaces', 'reading the policy pages');
  const discovered = await discoverLayer3(browser, layer0.origin, {
    runId,
    pacer,
    homepageLinks: rendered.page.links.map((link) => ({ href: link.href, text: link.text })),
    onProgress: (line, count) => say(line, count),
  });

  /*
    Which surfaces were actually read, recorded once (D-162, D-173).

    Named only where one was reached. A surface that was not is absent from the list and is never
    reported as missing: a merchant with no FAQ and a run whose FAQ fetch failed are not
    distinguishable from here, which is the distinction D-158 turns on.
  */
  progress.surfaceRead('the homepage');
  if (discovered.signup.found) progress.surfaceRead('the sign-up form');
  if (discovered.terms !== undefined) progress.surfaceRead('the terms document');
  if (discovered.shipping !== undefined) progress.surfaceRead('the shipping policy');
  if (discovered.faq !== undefined) progress.surfaceRead('the FAQ');
  if (discovered.payment !== undefined) progress.surfaceRead('the payment or refund policy');
  artifacts.push(...discovered.artifacts);

  const layer3 = runLayer3(
    {
      signup: discovered.signup,
      homepage: rendered.page,
      ...(discovered.terms === undefined ? {} : { terms: discovered.terms }),
      ...(discovered.shipping === undefined ? {} : { shipping: discovered.shipping }),
      ...(discovered.faq === undefined ? {} : { faq: discovered.faq }),
      ...(discovered.payment === undefined ? {} : { payment: discovered.payment }),
    },
    ruleset,
  );

  say(
    `layer 3: ${layer3.counts.fail} fail · ${layer3.counts.review} review · ${layer3.counts.pass} pass ` +
      `· ${layer3.counts.not_evaluable} not evaluable`,
  );

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

  progress.enter('gate', 'evaluating the gate rules without a session');
  say(`gate rules evaluated without a session: ${gate.map((f) => `${f.ruleId} ${f.state}`).join(', ')}`);

  // Order matters for readability only — `assembleReport` sorts by the rule set. What matters is
  // that the gate findings are the ones `runGateRules` produced: no Layer 3 rule is selected on a
  // surface either of them declares, so neither can be displaced here (D-039).
  const gateIds = new Set(gate.map((finding) => finding.ruleId));
  const layer3Findings = layer3.findings.filter((finding) => !gateIds.has(finding.ruleId));

  const findings: Finding[] = [
    ...layer1.findings,
    ...after,
    ...layer2.findings,
    ...layer3Findings,
    ...gate,
  ];

  const counts = tally(findings);
  say(
    `${counts.fail} fail · ${counts.review} review · ${counts.pass} pass · ${counts.not_evaluable} not evaluable ` +
      `· ${artifacts.length} capture(s)`,
  );

  progress.enter('assembly', 'assembling the report');
  const report = assembleReport(
    {
      runId,
      access: describeAccess(wall, mode, usedCredential, options.escalate !== undefined),
      merchantDomain: new URL(layer0.origin).host,
      ...(rendered.page.title === '' ? {} : { merchantName: rendered.page.title }),
      ...(rendered.page.shop.platform === undefined ? {} : { platform: rendered.page.shop.platform }),
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      findings,
      truncations: [...layer0.truncations, ...(collapse === null ? [] : [collapse])],
      politeness: describeCrawlDelay(delay),
      /*
        What the run asked for and did not get (D-136).

        `discoverLayer3` has recorded every navigation and its outcome since it was written; the
        list simply stopped here and never reached the report. So a run whose gate probes and
        payment capture all timed out published "37 could not be evaluated" and nothing a reader
        could use to tell that from a bare storefront.
      */
      attempts: discovered.attempts,

      /*
        How thin the sample was (D-162).

        Every number here was already computed and thrown away: `productUrls.length` reached the
        report only inside `url_pattern` note prose, and which Layer 3 surfaces were reached reached
        it not at all. `surfacesRead` names only what was actually read — a surface that was not
        reached is simply absent, never reported as missing, because a merchant with no FAQ and a
        failed FAQ fetch are not distinguishable from this list (D-158).
      */
      /*
        Read from the accumulator that fed the run page, rather than derived a second time here
        (D-173). These numbers were computed, discarded and recomputed before; now the live display
        and the stored record cannot disagree, because there is one of each fact.
      */
      sample: progress.sampleBasis(),
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

/**
 * What the report says about its own reach.
 *
 * Descriptive throughout. It states what was served and what was not; it never says a credential
 * *should* be obtained, because report copy does not instruct (D-001). "Coverage would widen with
 * a screening account" is an observation about this run; "get a screening account" would be an
 * instruction, and the difference is the whole of D-001.
 */
function describeAccess(
  wall: WallAssessment,
  mode: ScanMode,
  usedCredential: boolean,
  escalationAvailable: boolean,
): ReportAccess {
  if (usedCredential) {
    return {
      mode,
      wall: true,
      usedCredential: true,
      note:
        'Product pages were not served to an anonymous request. They were read with the ' +
        'merchant-supplied screening account. The access-gating findings are unaffected: they are ' +
        'decided by requests carrying no session.',
    };
  }

  if (wall.walled) {
    return {
      mode,
      wall: true,
      usedCredential: false,
      note:
        `${wall.reason}. No screening account was ${escalationAvailable ? 'stored for this merchant' : 'available to this run'}, ` +
        'so product-surface rules could not be observed and are reported as not evaluable. ' +
        'Coverage of those rules would be wider with a merchant-supplied login.',
    };
  }

  return {
    mode,
    wall: false,
    usedCredential: false,
    note: wall.reason.charAt(0).toUpperCase() + wall.reason.slice(1) + '.',
  };
}
