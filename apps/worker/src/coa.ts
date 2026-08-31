/**
 * Fetching a certificate of analysis (D-057).
 *
 * Finds the COA a product page links to, fetches it, **establishes that what came back is a
 * certificate**, and stores the document body. The handlers in `@mintro/engine` read it.
 *
 * ## Why this was sequenced after the locator
 *
 * D-054 exists because one defect appeared seven times, and this is where it would have been
 * worst. A storefront serving its themed 404 with `Content-Type: text/html` to a `.pdf` request
 * has not served a certificate — and a parser handed that HTML would find no purity figure and no
 * test date. COA-002 and COA-003 are `critical` and `auto_fail`, so "no purity found" on a 404
 * page would fail a merchant whose real certificate says 99.2%.
 *
 * A content type is a claim the server makes. The `%PDF` magic number is the document itself, and
 * that is what is checked.
 *
 * ## The body is stored, not only its hash
 *
 * Hard constraint 3: a hash proves a document has not changed, but it does not let anyone read
 * what the document said. The bytes go to the evidence store and the SHA-256 goes beside them.
 */

import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import type {
  Ruleset,
} from '@mintro/ruleset';
import type {
  CertificateOutcome,
  EvidenceArtifact,
  FetchAttempt,
  PageContext,
  Pacer,
} from '@mintro/engine';
import { extractPdfText, looksLikePdf, withoutFragment } from '@mintro/engine';

/**
 * What a certificate link looks like — read from COA-001, never held here (D-059).
 *
 * This module used to carry its own wider list. Two lists answering one question is D-034's shape,
 * and they diverged exactly as that predicts: on swisschems.is, COA-001 reported *"nothing matching
 * 'coa' or 'certificate of analysis' was observed"* on all five product pages while this fetch was
 * simultaneously requesting two certificate links it had found. Both accurate to their own
 * vocabulary; a reader could reconcile neither.
 *
 * One list, declared where COA-001 already declares it. Widening it is now a rule-set change with
 * a decision number behind it (D-025), and it changes both answers together.
 */
export function coaLinkVocabulary(ruleset: Ruleset): readonly string[] {
  const declared = ruleset.rules.flatMap((rule) =>
    rule.type === 'dom_assert' ? (rule.params.text_or_href_contains ?? []) : [],
  );

  // A rule set with no such rule leaves this empty, and `certificateLinks` then finds nothing —
  // which is reported as "no product page linked to a certificate", not as a silent skip.
  return [...new Set(declared.map((term) => term.toLowerCase()))];
}

export interface CoaResult {
  /**
   * What looking produced, with the attempts attached (D-058).
   *
   * Returned as an outcome rather than an optional certificate, because the three ways of not
   * getting one are three different facts — and the first version returned `certificate?` plus a
   * loose `attempts` array that `screen.ts` then dropped on the floor.
   */
  readonly outcome: CertificateOutcome;
  readonly artifacts: readonly EvidenceArtifact[];
}

export interface CoaOptions {
  readonly runId: string;
  /** What a certificate link looks like, from the rule set. See `coaLinkVocabulary`. */
  readonly vocabulary: readonly string[];
  readonly pacer: Pacer;
  readonly timeoutMs?: number;
  readonly onProgress?: (line: string) => void;
}

/**
 * Finds and fetches a certificate from the sampled product pages.
 *
 * Stops at the first document that is established as a PDF. The remaining candidates are not
 * tried, and every attempt made is returned — a reader must not infer that a link was absent when
 * it was simply never requested.
 */
export async function fetchCertificate(
  page: Page,
  sampled: readonly PageContext[],
  options: CoaOptions,
): Promise<CoaResult> {
  const say = options.onProgress ?? ((): void => undefined);
  const attempts: FetchAttempt[] = [];
  const artifacts: EvidenceArtifact[] = [];

  const candidates = certificateLinks(sampled, options.vocabulary);
  if (candidates.length === 0) {
    say('  no product page linked to a certificate of analysis');
    return { outcome: { found: false, why: 'not_published', attempts }, artifacts };
  }

  // Which failures were seen, so the outcome names the sharpest one rather than the last one.
  let sawBroken = false;
  let sawTransport = false;

  for (const url of candidates.slice(0, 5)) {
    await options.pacer.before();

    const response = await page.request
      .get(url, { timeout: options.timeoutMs ?? 20_000 })
      .catch(() => null);

    if (response === null) {
      // A request that never completed says nothing about the merchant.
      sawTransport = true;
      attempts.push({ url, status: 0, error: 'the request did not complete' });
      continue;
    }

    if (!response.ok()) {
      // A 404 under a certificate link is the merchant linking something that is not there.
      attempts.push({ url, status: response.status() });
      continue;
    }

    const bytes = new Uint8Array(await response.body().catch(() => Buffer.alloc(0)));

    /*
      Established by the document, not by the server's claim about it.

      A themed 404 returned with `Content-Type: application/pdf` is still not a PDF, and a
      certificate served as `application/octet-stream` still is. The magic number settles it.
    */
    if (!looksLikePdf(bytes)) {
      // The link resolves and looks live to a customer, and serves something that is not a
      // certificate. A worse observation than an absent link, and it used to be invisible.
      sawBroken = true;
      const declared = response.headers()['content-type'] ?? 'no content type';
      attempts.push({
        url,
        status: response.status(),
        error:
          `served ${bytes.length} byte(s) as '${declared}' that do not begin with %PDF, so no ` +
          `certificate was retrieved`,
      });
      continue;
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const evidenceKey = `${options.runId}/coa/${sha256.slice(0, 16)}.pdf`;

    // Stored as fetched: a PDF is already compressed, so gzipping it a second time buys nothing.
    // `body` is empty for binary artifacts, exactly as a screenshot's is — the bytes are in `gzip`.
    artifacts.push({
      key: evidenceKey,
      kind: 'coa',
      url,
      sha256,
      byteLength: bytes.length,
      contentType: response.headers()['content-type'] ?? 'application/pdf',
      fetchedAt: new Date().toISOString(),
      body: '',
      gzip: bytes,
      gzipByteLength: bytes.length,
    });

    attempts.push({ url, status: response.status() });

    const extracted = extractPdfText(bytes);
    say(
      extracted.text === ''
        ? `  certificate fetched from ${url} · no text could be read (${extracted.emptyReason ?? 'unknown'})`
        : `  certificate fetched from ${url} · ${extracted.text.length} characters of text`,
    );

    return {
      outcome: {
        found: true,
        certificate: {
          url,
          sha256,
          evidenceKey,
          text: extracted.text,
          ...(extracted.emptyReason === undefined ? {} : { emptyReason: extracted.emptyReason }),
          fetchedAt: new Date().toISOString(),
        },
      },
      artifacts,
    };
  }

  /*
    The sharpest failure wins, not the last one tried.

    A merchant with one broken certificate link and one 404 has a broken link; reporting whichever
    came last would make the finding depend on link order on the page.
  */
  const why = sawBroken ? 'link_broken' : sawTransport ? 'not_retrieved' : 'not_published';
  say(`  no certificate retrieved · ${attempts.length} link(s) tried · ${why}`);
  return { outcome: { found: false, why, attempts }, artifacts };
}

/**
 * Certificate links on the sampled product pages, most likely first.
 *
 * A link whose **href** ends in `.pdf` is preferred over one identified only by its text: COA-001
 * already records that a certificate may be linked as "Independent Test Results", and text alone
 * has selected the wrong document before (D-054). Both are still tried; the ordering just puts
 * the stronger signal first.
 */
export function certificateLinks(
  sampled: readonly PageContext[],
  vocabulary: readonly string[],
): readonly string[] {
  const byHref: string[] = [];
  const byText: string[] = [];

  for (const page of sampled) {
    for (const link of page.links) {
      const href = link.href.toLowerCase();
      const text = link.text.toLowerCase();
      const named = vocabulary.some((hint) => href.includes(hint) || text.includes(hint));
      if (!named) continue;

      // The URL a request would carry, so two links to one certificate are one attempt (D-219).
      if (href.endsWith('.pdf')) byHref.push(withoutFragment(link.href));
      else byText.push(withoutFragment(link.href));
    }
  }

  return [...new Set([...byHref, ...byText])];
}
