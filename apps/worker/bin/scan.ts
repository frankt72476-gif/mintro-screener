/**
 * Runs Layer 0 and Layer 1 against a storefront and prints what was found.
 *
 *     npm run scan-l1 -- https://shop.example [more-urls...]
 *     npm run scan-l1 -- --evidence-dir ./evidence https://shop.example
 *
 * The order matters. Layer 0 runs first because robots.txt carries the `Crawl-delay` the
 * browser must then observe (D-013) — rendering before reading it would mean the first browser
 * request ignored a delay the site had already declared.
 *
 * After Layer 1 renders, whatever it learned about catalogue structure is fed back into the
 * Layer 0 classifier and the Layer 0 rules are re-evaluated. Nothing is re-fetched: the URLs
 * are the same URLs from the same stored sitemaps, now with a better idea of what they are.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import {
  createHttpFetcher,
  createPacer,
  describeCrawlDelay,
  discoverLayer0,
  layer0Rules,
  reclassify,
  resolveCrawlDelay,
  runLayer1,
  tally,
  assembleReport,
  checkUrlPattern,
  inScope,
  layer2Rules,
  runLayer2,
  scoreProductUrls,
  selectSample,
  type EvidenceArtifact,
  type Finding,
  type Layer0Result,
  type PageContext,
  type SampledPage,
  type ScopeOverrides,
} from '@mintro/engine';
import { renderPage } from '../src/render.js';

const LABEL: Record<Finding['state'], string> = {
  fail: 'FAIL         ',
  review: 'REVIEW       ',
  pass: 'pass         ',
  not_evaluable: 'not evaluable',
};

async function main(argv: readonly string[]): Promise<number> {
  const { targets, evidenceDir, reportDir } = parseArgs(argv);
  if (targets.length === 0) {
    console.error(
      'usage: npm run scan-full -- [--evidence-dir <dir>] [--report-dir <dir>] <storefront-url> [more...]',
    );
    return 2;
  }

  const ruleset = loadRulesetFile('rules/ruleset.json');
  console.log(`Rule set ${ruleset.version} (effective ${ruleset.effective})\n`);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  try {
    for (const target of targets) {
      await scan(browser, target, ruleset, evidenceDir, reportDir);
    }
    return 0;
  } finally {
    await browser.close();
  }
}

/** Product pages sampled per run. ARCHITECTURE.md budgets 3-5. */
const SAMPLE_SIZE = 5;

/**
 * Every CSS selector the rule set asks about, so the renderer can evaluate them in the page.
 *
 * Read from the rules rather than listed here: a selector is rule content, and a handler that
 * cannot query the DOM still needs the answer.
 */
function ruleSelectors(ruleset: Ruleset): string[] {
  const selectors = new Set<string>();
  for (const rule of layer2Rules(ruleset)) {
    if (rule.type === 'dom_assert' && rule.params.selector !== undefined) {
      selectors.add(rule.params.selector);
    }
  }
  return [...selectors];
}

async function scan(
  browser: Browser,
  target: string,
  ruleset: Ruleset,
  evidenceDir: string | undefined,
  reportDir: string | undefined,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const artifacts: EvidenceArtifact[] = [];

  // ---- Layer 0, which also tells us how politely to behave from here on ----------------
  const fetcher = createHttpFetcher({ timeoutMs: 15_000 });
  const layer0 = await discoverLayer0(target, fetcher, { runId });
  artifacts.push(...layer0.artifacts);

  const delay = resolveCrawlDelay(layer0.robots.crawlDelaySeconds);
  const pacer = createPacer(delay);

  console.log('─'.repeat(100));
  console.log(`${layer0.origin}    run ${runId.slice(0, 8)}`);
  console.log(`  politeness ${describeCrawlDelay(delay)}`);

  // ---- Layer 1 -------------------------------------------------------------------------
  const homepage = `${layer0.origin}/`;
  const rendered = await renderPage(browser, homepage, { runId, pacer, timeoutMs: 30_000 });
  artifacts.push(...rendered.artifacts);

  reportRender(rendered.page, pacer.waitedMs());

  const layer1 = runLayer1(rendered.page, ruleset);

  // ---- feed what Layer 1 learned back into the Layer 0 classifier -----------------------
  const overrides = toScopeOverrides(rendered.page);
  const improved = reclassify(layer0, overrides);
  const before = layer0Rules(ruleset).map((rule) => checkUrlPattern(rule, layer0));
  const after = layer0Rules(ruleset).map((rule) => checkUrlPattern(rule, improved));

  reportStructure(rendered.page, overrides, before, after);

  // ---- findings ------------------------------------------------------------------------
  console.log('\n  LAYER 1 — rendered homepage');
  for (const finding of layer1.findings) {
    console.log(`  ${LABEL[finding.state]}  ${finding.ruleId}  ${finding.note}`);
  }

  console.log('\n  LAYER 0 — URL surface (after Layer 1 structure feedback)');
  for (const finding of after) {
    console.log(`  ${LABEL[finding.state]}  ${finding.ruleId}  ${truncate(finding.note)}`);
  }

  // ---- Layer 2: sample product pages by suspicion score --------------------------------
  const productUrls = improved.urls.filter((url) => inScope(url, 'products'));
  const scored = scoreProductUrls(productUrls, ruleset);
  const selected = selectSample(scored, SAMPLE_SIZE);

  console.log(`\n  LAYER 2 — ${selected.length} of ${productUrls.length} product page(s), by suspicion score`);
  for (const pick of selected) {
    const why =
      pick.reasons.length === 0
        ? 'no signal; sampled to fill the quota'
        : pick.reasons.slice(0, 3).map((r) => `${r.ruleId}:${r.matched}`).join(', ');
    console.log(`    score ${String(pick.score).padStart(3)}  ${new URL(pick.url.url).pathname}  (${why})`);
  }

  const selectors = ruleSelectors(ruleset);
  const sampled: SampledPage[] = [];

  for (const pick of selected) {
    const result = await renderPage(browser, pick.url.url, {
      runId,
      pacer,
      selectors,
      timeoutMs: 30_000,
    });
    artifacts.push(...result.artifacts);
    sampled.push({ selection: pick, page: result.page });
  }

  const layer2 = runLayer2(sampled, ruleset);

  const renderedCount = sampled.filter((entry) => entry.page.renderError === undefined).length;
  console.log(`    rendered ${renderedCount}/${sampled.length}${pacer.waitedMs() > 0 ? ` · waited ${pacer.waitedMs()}ms total for Crawl-delay` : ''}`);
  console.log();
  for (const finding of layer2.findings) {
    console.log(`  ${LABEL[finding.state]}  ${finding.ruleId}  ${truncate(finding.note)}`);
  }

  const combined = tally([...layer1.findings, ...after, ...layer2.findings]);
  console.log(
    `\n  combined   ${combined.fail} fail · ${combined.review} review · ${combined.pass} pass · ${combined.not_evaluable} not evaluable`,
  );
  console.log(`  evidence   ${artifacts.length} artifacts, ${formatBytes(storedBytes(artifacts))} stored`);

  if (evidenceDir !== undefined) writeEvidence(artifacts, evidenceDir);

  if (reportDir !== undefined) {
    const allFindings: Finding[] = [...layer1.findings, ...after, ...layer2.findings];
    const report = assembleReport(
      {
        runId,
        merchantDomain: new URL(layer0.origin).host,
        ...(rendered.page.title === '' ? {} : { merchantName: rendered.page.title }),
        ...(rendered.page.shop.platform === undefined ? {} : { platform: rendered.page.shop.platform }),
        mode: 'public',
        startedAt,
        finishedAt: new Date().toISOString(),
        findings: allFindings,
        truncations: layer0.truncations,
        politeness: describeCrawlDelay(delay),
      },
      ruleset,
    );

    const path = join(reportDir, `${report.merchantDomain}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  report     ${path}`);
  }

  console.log();
}

function reportRender(page: PageContext, waitedMs: number): void {
  if (page.renderError !== undefined) {
    console.log(`  render     FAILED — ${page.renderError}`);
    return;
  }
  console.log(
    `  render     HTTP ${page.httpStatus} · ${page.links.length} links · ${page.styledText.length} text runs` +
      ` · footer ${page.footer.found ? `via ${page.footer.locatedBy}` : 'NOT FOUND'}` +
      (waitedMs > 0 ? ` · waited ${waitedMs}ms for Crawl-delay` : ''),
  );
  console.log(
    `  captures   screenshot ${page.screenshotKey === undefined ? 'MISSING' : 'ok'} · DOM ${page.domKey === undefined ? 'MISSING' : 'ok'}`,
  );
  if (page.footerPaymentTerms.length > 0) {
    console.log(`  payments   observed in footer (carried to L3): ${page.footerPaymentTerms.join(', ')}`);
  }
}

function reportStructure(
  page: PageContext,
  overrides: ScopeOverrides,
  before: readonly Finding[],
  after: readonly Finding[],
): void {
  const { shop } = page;
  console.log(
    `  structure  platform ${shop.platform ?? 'unknown'} · ${shop.productUrls.length} product link(s) · ` +
      `${shop.collectionUrls.length} collection link(s) · ${shop.catalogueEntryUrls.length} catalogue entry point(s)`,
  );
  for (const signal of shop.signals) console.log(`             ${signal}`);

  const learned = overrides.segments?.products ?? [];
  if (learned.length > 0) console.log(`             learned product segments: ${learned.join(', ')}`);

  // Report the effect honestly, including when there was none.
  const gained = before.filter(
    (finding, i) => finding.state === 'not_evaluable' && after[i]?.state !== 'not_evaluable',
  );
  console.log(
    gained.length > 0
      ? `  feedback   ${gained.length} Layer 0 rule(s) became evaluable: ${gained.map((f) => f.ruleId).join(', ')}`
      : '  feedback   no Layer 0 rule changed state from the rendered structure',
  );
}

/**
 * Turns what Layer 1 saw into scope overrides.
 *
 * A path segment is learned only when the observed product URLs agree on one — a single sample
 * is a coincidence, not a structure. Observed URLs are always passed through exactly, so a
 * storefront with no common segment still gains the products it demonstrably has.
 */
function toScopeOverrides(page: PageContext): ScopeOverrides {
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

function writeEvidence(artifacts: readonly EvidenceArtifact[], root: string): void {
  let written = 0;
  for (const artifact of artifacts) {
    const path = join(root, artifact.kind === 'screenshot' ? artifact.key : `${artifact.key}.gz`);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, artifact.gzip, { flag: 'wx' });
      written += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      console.error(`  evidence key already exists, refusing to overwrite: ${artifact.key}`);
    }
  }
  console.log(`  written    ${written} artifact(s) to ${root}`);
}

function parseArgs(argv: readonly string[]): {
  targets: string[];
  evidenceDir?: string;
  reportDir?: string;
} {
  const targets: string[] = [];
  let evidenceDir: string | undefined;
  let reportDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--evidence-dir') {
      evidenceDir = argv[i + 1];
      i += 1;
    } else if (arg === '--report-dir') {
      reportDir = argv[i + 1];
      i += 1;
    } else if (arg !== undefined) {
      targets.push(arg);
    }
  }
  return {
    targets,
    ...(evidenceDir === undefined ? {} : { evidenceDir }),
    ...(reportDir === undefined ? {} : { reportDir }),
  };
}

const storedBytes = (artifacts: readonly EvidenceArtifact[]): number =>
  artifacts.reduce((sum, artifact) => sum + artifact.gzipByteLength, 0);

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const truncate = (value: string, limit = 150): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

main(process.argv.slice(2)).then((code) => process.exit(code));
