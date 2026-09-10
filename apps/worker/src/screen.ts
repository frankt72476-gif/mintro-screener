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
  eyeTestManifest,
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
import { createCrawlContext, renderPage } from './render.js';
import { runGateRules, type AnonymousAccess } from './gate.js';
import { discoverLayer3 } from './signup.js';
import { coaLinkVocabulary, fetchCertificate } from './coa.js';
import { probePaths } from './probe.js';
import { runCheckoutFlow } from './flow.js';

/**
 * The floor: a catalogue with nothing to look at still gets looked at.
 *
 * ARCHITECTURE.md budgets 3-5, and that stands for a storefront where every product page is a
 * compound the rule set recognises. It is a floor rather than the sample size, because the sample
 * is now decided by what the scorer could not account for (D-223).
 */
export const SAMPLE_SIZE = 5;

/**
 * The most product pages one run will render.
 *
 * **A stability bound, not a budget.** D-223 made every unrecognised slug a candidate, and on the
 * stored catalogues that is not a handful: swisschems scores 124 pages worth rendering, corepeptides
 * 104. Rendering all of them is unbounded Playwright work decided by a merchant's catalogue size,
 * which is the shape that has hung this worker before (D-152, D-153) — a run that never returns
 * produces no findings at all, so an unbounded sample trades a thin report for no report.
 *
 * 25 rather than a smaller number because the cap should bind on catalogue size, not on ordinary
 * suspicion: comopeptides scores 14 and never reaches it, so the merchant this was written for is
 * sampled in full. Against the 30-minute deadline (`RUN_DEADLINE_MS`) 25 renders is affordable —
 * it is roughly five times the previous render work, which is real and is why the cap exists at
 * all rather than being left implicit.
 *
 * What it does not do is decide anything. Pages above the cap are declared, not dropped (D-076).
 */
export const RENDER_CAP = 25;

/**
 * What happened when a walled crawl tried to escalate to a stored login (D-185).
 *
 * Three outcomes, and they are three different facts about the merchant and about us. Collapsing
 * the middle one into the first is what made a dead credential invisible.
 */
export type Escalation =
  | { readonly kind: 'no_credential' }
  | { readonly kind: 'sign_in_failed'; readonly reason: string }
  | { readonly kind: 'signed_in'; readonly context: BrowserContext };

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
  /**
   * Signs in with the merchant's stored account, when the crawl is refused.
   *
   * Reports **which** of three things happened rather than returning a bare context-or-null
   * (D-185). `null` used to mean both "no credential is stored" and "one is stored and it did not
   * sign in", and the caller assumed the first — so a report told a reader that no account had
   * been supplied when one had, and had stopped working. The person reading the report is not
   * always the person who would look at the credential card.
   */
  readonly escalate?: () => Promise<Escalation>;
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

  /*
    One anonymous context for the whole crawl (D-267).

    Every render used to build and close its own, which is right until something a page does has to
    survive to the next one. A consent gate is exactly that: it sets a cookie, and a per-render
    context means sixteen product pages behind one gate submit that gate sixteen times. One context
    submits it once and walks through fifteen times.

    It is anonymous and stays anonymous. The escalation path below hands the product sample a
    *different* context carrying a merchant session when one is needed (D-040), and the gate rules
    build their own with no session at all (D-039). Neither is touched by this.
  */
  const crawl = await createCrawlContext(browser);
  /** Set once the crawl has been through a consent gate on this context (D-267). */
  let enteredGate: string | undefined;
  const gateOptions = (): {
    readonly alreadyEnteredGate: boolean;
    readonly onEnteredGate: (description: string) => void;
  } => ({
    alreadyEnteredGate: enteredGate !== undefined,
    onEnteredGate: (description) => {
      enteredGate = description;
      say(`  entered through the merchant's consent gate: ${description}`);
    },
  });

  try {

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
  const rendered = await renderPage(browser, homepage, {
    runId,
    pacer,
    timeoutMs: 30_000,
    context: crawl,
    ...gateOptions(),
  });
  artifacts.push(...rendered.artifacts);

  progress.enter(
    'homepage',
    rendered.page.renderError !== undefined
      ? `homepage render FAILED — ${rendered.page.renderError}`
      : `homepage HTTP ${rendered.page.httpStatus} · footer ${rendered.page.footer.found ? 'located' : 'NOT FOUND'}`,
  );

  /*
    Every page this run rendered, for the challenge count (D-264).

    Accumulated as the crawl goes rather than reconstructed at assembly, for the reason `progress`
    exists: a second derivation from the evidence keys would be a second answer to *how many pages
    did the edge answer*, and D-216 is the record of what happens to second derivations. The
    homepage, the product sample and every Layer 3 candidate all push here.
  */
  const renderedPages: PageContext[] = [rendered.page];

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

  /*
    Everything the scorer could not account for, bounded (D-223).

    `scoreProductUrls` already orders suspicious above unrecognised above benign, so taking the
    top N *is* the priority fill — nothing re-sorts here, and a second ordering computed alongside
    the scorer's would be a second answer to the same question.

    The floor keeps the old behaviour where it still applies: a catalogue whose every page is a
    recognised compound scores nothing, and five of them are still rendered rather than none.
  */
  const worthRendering = scored.filter((entry) => entry.slugClass !== 'benign').length;
  const sampleSize = Math.min(RENDER_CAP, Math.max(SAMPLE_SIZE, worthRendering));
  const selected = selectSample(scored, sampleSize);
  const unrendered = scored.slice(selected.length);

  /*
    What was left, and which kind (D-076). Declared, never silently omitted.

    The two are different facts. A recognised compound left unrendered is a defensible omission —
    the rule set positively accounted for every part of its slug. A page left for want of room is
    not: nothing was established about it, and the reader has to be able to see that the bound was
    ours rather than the catalogue's.
  */
  progress.notRenderedIs(
    unrendered.filter((entry) => entry.slugClass === 'benign').length,
    unrendered.filter((entry) => entry.slugClass !== 'benign').length,
  );

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
        // The merchant session where one was established, the run's own anonymous context
        // otherwise. Either way it is shared across the sample, so a gate is passed once.
        context: context ?? crawl,
        ...gateOptions(),
      });
      artifacts.push(...result.artifacts);
      renderedPages.push(result.page);
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
  /** What escalation found, when it ran. `undefined` means the crawl was never refused. */
  let escalation: Escalation | undefined;
  let mode: ScanMode = 'public';

  progress.sampleIs(sampled.filter((entry) => wasServed(entry.page)).length);
  say(wall.reason);

  /*
    Said out loud, at the point it happened (D-264).

    A run that met bot protection used to look, in the log and in the report, exactly like a run
    against a bare storefront. The three phoenixpeptide runs of 2026-09-09 each read "0 fail · 1
    pass · 61 not evaluable" and finished `complete`, and there was nothing on any surface an
    operator sees to say that no page of the site had been served to anybody.
  */
  if (enteredGate !== undefined) {
    /*
      Said out loud, because it is a thing the crawler did rather than a thing that happened to it
      (D-267). A reader who sees a full catalogue on a merchant who gates it is entitled to know
      how the crawl got there, and the masthead says so too.
    */
    say(`  the catalogue below was read after affirming the gate's statements`);
  }

  if (wall.consentGated > 0) {
    /*
      Said out loud, and said as the credit it is (D-266).

      Run 97bf366a served the gate at sixteen of sixteen product URLs and the log said nothing.
      The line names the merchant's control and names our own choice not to answer it, because the
      reader's question on seeing thin coverage is *whose doing is this*.
    */
    say(
      `  ${wall.consentGated} of ${wall.attempted} sampled page(s) were the merchant's own consent ` +
        'gate; Mintro does not attest through it, so the pages behind it were not read',
    );
  }

  if (wall.challenged > 0) {
    say(
      `  ${wall.challenged} of ${wall.attempted} sampled page(s) were answered by the site's bot ` +
        'protection; the pages behind it were not seen',
    );
  }

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
    escalation = await options.escalate();

    if (escalation.kind === 'no_credential') {
      progress.enter(
        'escalate',
        'a login wall was met and no screening account is stored for this merchant',
      );
    } else if (escalation.kind === 'sign_in_failed') {
      // Distinct from the line above, and the distinction reaches the report (D-185).
      progress.enter(
        'escalate',
        `a login wall was met and the stored screening account did not sign in: ${escalation.reason}`,
      );
    } else {
      const context = escalation.context;
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
    context: crawl,
    ...gateOptions(),
    /*
      With the nav and footer flags (D-271).

      An about page is located by exact link text *in the chrome*: the same words in body copy are
      a blog post. The flags were already on `PageLink` and were being dropped here.
    */
    homepageLinks: rendered.page.links.map((link) => ({
      href: link.href,
      text: link.text,
      inNav: link.inNav,
      inFooter: link.inFooter,
    })),
    onProgress: (line, count) => say(line, count),
  });

  // Every Layer 3 candidate this pass rendered, for the challenge count (D-264). Most were
  // conventional paths that returned a themed 404; being here says a navigation happened, never
  // that a surface was found.
  renderedPages.push(...discovered.pages);

  /*
    Which surfaces were actually read, recorded once (D-162, D-173).

    Named only where one was reached. A surface that was not is absent from the list and is never
    reported as missing: a merchant with no FAQ and a run whose FAQ fetch failed are not
    distinguishable from here, which is the distinction D-158 turns on.
  */
  progress.surfaceRead('the homepage');
  if (discovered.signup.found) progress.surfaceRead('the sign-up form');
  if (discovered.terms.located) progress.surfaceRead('the terms document');
  if (discovered.shipping.located) progress.surfaceRead('the shipping policy');
  if (discovered.faq.located) progress.surfaceRead('the FAQ');
  if (discovered.payment.located) progress.surfaceRead('the payment or refund policy');
  if (discovered.about.located) progress.surfaceRead('the about page');
  artifacts.push(...discovered.artifacts);

  /*
    The about page, and the Layer 2 rules that read it (D-271).

    **Layer 2 evaluates after Layer 3 discovers**, which is the one ordering change here. It used
    to run the moment the product sample was rendered, and it could: every surface it read came
    from the sample. The about page does not — it is located by the same pass that finds the terms
    page — so the rules that read it cannot run until that pass has happened.

    Nothing between the two consumed `layer2`, so this is a move rather than a restructure. The
    render order is untouched: the sample is still rendered before the policy pages, and the pacer
    still spaces every request.
  */
  const aboutPages = discovered.about.located ? [discovered.about.value] : [];
  const layer2 = runLayer2(sampled, ruleset, coa?.outcome, aboutPages);

  const layer3 = runLayer3(
    {
      signup: discovered.signup,
      homepage: rendered.page,
      // Passed whole, located or not: an unreached surface carries the requests its finding needs
      // to evidence why it was not reached (D-182).
      terms: discovered.terms,
      shipping: discovered.shipping,
      faq: discovered.faq,
      payment: discovered.payment,
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

  const challengedPages = renderedPages.filter((page) => page.challenged !== undefined).length;
  const gatedPages = renderedPages.filter((page) => page.gated !== undefined).length;
  const enteredPages = renderedPages.filter((page) => page.enteredGate !== undefined).length;

  progress.enter('assembly', 'assembling the report');
  const report = assembleReport(
    {
      runId,
      access: describeAccess(wall, mode, usedCredential, escalation),
      merchantDomain: new URL(layer0.origin).host,
      ...(rendered.page.title === '' ? {} : { merchantName: rendered.page.title }),
      ...(rendered.page.shop.platform === undefined ? {} : { platform: rendered.page.shop.platform }),
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      findings,
      truncations: [
        ...layer0.truncations,
        ...(collapse === null ? [] : [collapse]),
        ...probeUndecided(discovered.probe),
      ],
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

      /*
        How many pages the edge answered instead of the site (D-264).

        On the masthead rather than in `truncations`, because it is not a coverage limit the run
        chose — it is a statement about whether the document below it describes the merchant at
        all. Omitted where nothing was challenged: a line reading "Bot challenge on 0 of 30 pages"
        on every clean report is noise on all of them, and the field is absent-means-nothing so a
        run recorded before this reads as silence rather than as zero.
      */
      ...(challengedPages === 0
        ? {}
        : { challenge: { challenged: challengedPages, pages: renderedPages.length } }),

      /*
        How many pages the merchant's own gate stood in front of (D-266).

        Its own field rather than a share of `challenge`, because the two say opposite things about
        the merchant and a masthead that merged them would report a compliance control as an
        obstruction.
      */
      /*
        The gate, and what the crawl did about it (D-266, D-267).

        Reported whenever a gate was met, whether or not it was passed — the two are different
        sentences on the masthead and the second one is the interesting one. Omitted only where no
        gate was seen at all.
      */
      ...(gatedPages === 0 && enteredPages === 0
        ? {}
        : {
            consentGate: {
              gated: gatedPages,
              entered: enteredPages,
              pages: renderedPages.length,
            },
          }),

      /*
        What the eye test should read — not what it found (D-198).

        The call takes 22 seconds and produces observations that can never move a state, so it does
        not belong on the crawl's critical path. It runs afterwards, as a job, and writes to
        `eye_tests` rather than here — `runs.report` is sealed the moment the run finishes.

        What the job cannot work out for itself is which page was which. That is known here and
        nowhere else, and recovering it downstream by matching URL shapes is the blindness hard
        constraint 9 describes. So the manifest is built now and the looking happens later.
      */
      eyeTestCaptures: eyeTestManifest({
        homepage: rendered.page,
        products: sampled.map((entry) => entry.page),
        ...(discovered.signupPage === undefined ? {} : { signup: discovered.signupPage }),
        // The rubric asks how a site presents itself, and this is where it answers (D-271).
        ...(aboutPages[0] === undefined ? {} : { about: aboutPages[0] }),
      }),
    },
    ruleset,
  );

  return { report, artifacts, layer0: improved, homepage: rendered.page, sampled, findings };
  } finally {
    // Ours, so ours to close. A merchant-session context belongs to `escalate` and is not touched.
    await crawl.close().catch(() => undefined);
  }
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
export function describeAccess(
  wall: WallAssessment,
  mode: ScanMode,
  usedCredential: boolean,
  escalation: Escalation | undefined,
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
    /*
      Why coverage was limited, distinguishing a missing account from a broken one (D-185).

      This branch used to say "No screening account was stored for this merchant" whenever the
      escalation returned nothing — which covered both the merchant never having supplied one and
      the one they supplied having stopped working. A reader was told the first when the second was
      true, and the two call for different actions by whoever holds the relationship.

      Still descriptive (D-001): it says what happened and stops. "The stored account did not sign
      in" is an observation about this run. "Get a new account" would be an instruction.
    */
    const why =
      escalation?.kind === 'sign_in_failed'
        ? 'A screening account is stored for this merchant and it did not sign in on this run, so it was not used'
        : escalation?.kind === 'signed_in'
          ? 'A stored screening account signed in but the product pages were still not served'
          : escalation === undefined
            ? 'No screening account was available to this run'
            : 'No screening account is stored for this merchant';

    return {
      mode,
      wall: true,
      usedCredential: false,
      note:
        `${wall.reason}. ${why}, ` +
        'so product-surface rules could not be observed and are reported as not observed. ' +
        'Coverage of those rules would be wider with a merchant-supplied login that signs in.',
    };
  }

  return {
    mode,
    wall: false,
    usedCredential: false,
    note: wall.reason.charAt(0).toUpperCase() + wall.reason.slice(1) + '.',
  };
}

/**
 * A note on the run when the cheap Layer 3 probe could not decide (D-182).
 *
 * `undecided` renders, which is the safe behaviour and also the invisible one: a probe layer
 * failing on every request produces exactly the run it produced before the probe existed — same
 * findings, same cost — and nothing would say so. It goes in `truncations` because that is the
 * run-level record of what limited a scan, and it reaches the report; a progress line would not.
 *
 * Silent when the probe decided every candidate, which is the normal case. A permanent "0 probes
 * were undecided" is noise on every run that matters (the reasoning at `report.ts:251`).
 */
export function probeUndecided(probe: { readonly undecided: number; readonly total: number }): string[] {
  if (probe.undecided === 0) return [];
  return [
    `the cheap path check could not reach a verdict on ${probe.undecided} of ${probe.total} ` +
      `Layer 3 candidate(s); each was rendered in full rather than skipped, so no surface was ` +
      `missed, but the check was not doing its work on this run`,
  ];
}
