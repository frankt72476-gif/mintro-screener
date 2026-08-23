/**
 * The COA checks (D-057).
 *
 * COA-002 and COA-003 are `critical` and `auto_fail`. The direction that matters is therefore the
 * one where **a value could not be read**: a scanned certificate carries no text at all, and
 * failing a merchant because this reader cannot see an image would be the worst false positive
 * the system can produce. Every unreadable case must be `not_evaluable`, never a missing value.
 *
 * The other rule running through all of these: a finding may report **what a certificate states**,
 * never that the certificate is genuine. COA-005 is `manual` precisely because forged COAs are a
 * known failure mode, and nothing here may quietly answer the question it leaves open.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '@mintro/ruleset';
import {
  checkCoaDate,
  checkCoaFields,
  checkCoaPurity,
  findDate,
  findPurity,
  isReadableText,
  type Certificate,
  type CertificateOutcome,
} from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');
const docRule = (id: string): RuleOfType<'doc_parse'> => {
  const found = ruleset.rules.find((r: Rule) => r.id === id);
  if (found === undefined || found.type !== 'doc_parse') throw new Error(`no doc_parse rule ${id}`);
  return found;
};

const COA_002 = docRule('COA-002');
const COA_003 = docRule('COA-003');
const COA_004 = docRule('COA-004');

const NOW = new Date('2026-08-22T00:00:00.000Z');

const NOT_PUBLISHED: CertificateOutcome = { found: false, why: 'not_published', attempts: [] };

function certificate(text: string, overrides: Partial<Certificate> = {}): CertificateOutcome {
  return { found: true, certificate: {
    url: 'https://shop.example/coa/batch-1.pdf',
    sha256: 'a'.repeat(64),
    evidenceKey: 'run-1/coa/aaaaaaaaaaaaaaaa.pdf',
    text,
    fetchedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  } };
}

/** What a scanned certificate looks like: fetched and stored, with no text in it. */
const SCANNED = certificate('', {
  emptyReason:
    'the 3 decoded content stream(s) carry no text objects, which is what a scanned certificate ' +
    'looks like — an image of a page rather than text',
});

describe('a certificate that could not be read is never a failure', () => {
  it.each([
    ['COA-002', () => checkCoaDate(COA_002, SCANNED, NOW)],
    ['COA-003', () => checkCoaPurity(COA_003, SCANNED)],
    ['COA-004', () => checkCoaFields(COA_004, SCANNED)],
  ])('%s reports not_evaluable on a scanned certificate', (id, check) => {
    const finding = check();
    expect(finding.state, id).toBe('not_evaluable');
    expect(finding.notEvaluableKind, id).toBe('not_exposed');
    // The reason names what happened, and the document is still cited as evidence.
    expect(finding.note, id).toContain('no text could be read');
    expect(finding.evidence[0]?.evidenceKey, id).toBe(
      SCANNED.found ? SCANNED.certificate.evidenceKey : '',
    );
  });

  it.each([
    ['COA-002', () => checkCoaDate(COA_002, NOT_PUBLISHED, NOW)],
    ['COA-003', () => checkCoaPurity(COA_003, NOT_PUBLISHED)],
    ['COA-004', () => checkCoaFields(COA_004, NOT_PUBLISHED)],
  ])('%s reports not_evaluable when no certificate was published', (id, check) => {
    const finding = check();
    expect(finding.state, id).toBe('not_evaluable');
    expect(finding.notEvaluableKind, id).toBe('not_exposed');
    expect(finding.note, id).toContain('no sampled product page linked to a certificate');
  });

  it('does not fail COA-003 when the text is readable but names no purity', () => {
    const finding = checkCoaPurity(COA_003, certificate('Batch 44. Method: HPLC. Compound: BPC-157.'));
    expect(finding.state).toBe('not_evaluable');
    expect(finding.note).toContain('no percentage was found near a purity or assay label');
  });

  it('does not fail COA-002 when the text is readable but names no report date', () => {
    const finding = checkCoaDate(COA_002, certificate('Batch 44. Purity 99.1%.'), NOW);
    expect(finding.state).toBe('not_evaluable');
    expect(finding.note).toContain('no date in a recognised format');
  });
});

describe('COA-003 — stated purity', () => {
  it('passes at or above the minimum, and says it is reporting a claim', () => {
    const finding = checkCoaPurity(COA_003, certificate('Assay: Purity 99.2 % by HPLC'));
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('99.2%');
    // Never "purity is 99.2%" — the certificate says so, and COA-005 owns whether to believe it.
    expect(finding.note).toContain('reports what the certificate states');
    expect(finding.note).toContain('the assay was not repeated');
  });

  it('fails below the minimum', () => {
    const finding = checkCoaPurity(COA_003, certificate('Purity: 91.4%'));
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('below the 98% the rule requires');
  });
});

describe('COA-002 — the date the certificate states it was issued', () => {
  it('passes inside the limit', () => {
    const finding = checkCoaDate(COA_002, certificate('Date of Analysis: 2026-08-01'), NOW);
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('21 day(s) before this run');
  });

  it('honours the cure window the rule declares', () => {
    // 70 days old: past the 60-day limit, inside the 14-day cure window.
    const finding = checkCoaDate(COA_002, certificate('Test Date: 2026-06-13'), NOW);
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('within the 14-day cure window');
  });

  it('fails beyond the limit and the cure window', () => {
    const finding = checkCoaDate(COA_002, certificate('Report Date: 2026-01-05'), NOW);
    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('past the 60-day limit and the 14-day cure window');
  });
});

describe('reading a date', () => {
  it('reads a date next to a date label, not the first date in the document', () => {
    const text = 'Printed 2026-08-20. Batch made 2025-01-01. Date of Test: 2026-07-15. Expiry 2027-01-01.';
    expect(findDate(text)?.text).toContain('2026-07-15');
  });

  /**
   * `03/04/2026` is March 4th to a US lab and April 3rd to a European one. COA-002 is `auto_fail`,
   * so a month's error either way could fail a compliant merchant — and `not_evaluable` is the
   * honest answer to a date this reader cannot disambiguate.
   */
  it('refuses an ambiguous numeric date rather than guessing a month', () => {
    expect(findDate('Test Date: 03/04/2026')).toBeNull();
  });

  it('reads a written month', () => {
    expect(findDate('Date of Analysis: 15 July 2026')?.date.getUTCMonth()).toBe(6);
    expect(findDate('Report Date: July 15, 2026')?.date.getUTCMonth()).toBe(6);
  });
});

/**
 * The quoted value is the value, not the window it was found in (D-060).
 *
 * The first version returned the whole capture, so the evidence slip read
 * `7/22/2026 7/22/2026 Cert` — the date, a repeat of it, and the start of the next heading. A
 * reader checking a finding against the stored PDF has to see the same string in both.
 */
describe('the quoted date is the date', () => {
  it('quotes only the token, from the real corepeptides text', () => {
    const text =
      'Laboratory ID: V260706-2 012 Lot Number: C74111 Date Reported: 7/22/2026 7/22/2026 ' +
      'Certificate of Analysis GLOW 70 mg';

    expect(findDate(text)?.text).toBe('7/22/2026');
  });

  it('does not truncate a written month, or take a number beside it', () => {
    // The numeric shape matches "26 Batch 44" here. Only parsing tells it from the real date,
    // which is why candidates are parsed rather than the first match returned.
    expect(findDate('Report Date: July 15, 2026 Batch 44')?.text).toBe('July 15, 2026');
  });

  it('reads a date whichever way round the day and month are, when the value settles it', () => {
    expect(findDate('Date Reported: 7/22/2026')?.date.toISOString().slice(0, 10)).toBe('2026-07-22');
    expect(findDate('Date Reported: 22/7/2026')?.date.toISOString().slice(0, 10)).toBe('2026-07-22');
  });

  it('refuses a date whose components leave the order open', () => {
    expect(findDate('Date Reported: 12/11/2026')).toBeNull();
  });

  /**
   * COA-002 asks when the certificate was issued (D-058). A collection date answers an easier
   * question, and accepting it would look like an answer to this one.
   */
  it('ignores a label naming when the sample arrived', () => {
    expect(findDate('Date Received: 7/22/2026')).toBeNull();
  });
});

/**
 * The note names what the rule asks for (D-060).
 *
 * D-058 renamed the param from `test_date` to `report_date` because those are different things.
 * A rename that fixes the param and leaves the sentence answering the old question is the same
 * failure, surviving where a reader actually meets it.
 */
describe('COA-002 copy names the date it read', () => {
  it('says reported, not tested', () => {
    const finding = checkCoaDate(COA_002, certificate('Date Reported: 2026-08-01'), NOW);

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('states it was reported on');
    expect(finding.note).not.toContain('test date');
    // And it still refuses to claim the test happened.
    expect(finding.note).toContain('not a verification that any test occurred');
  });

  it('says so when no report or issue date could be read', () => {
    const finding = checkCoaDate(COA_002, certificate('Batch 44. Purity 99.1%.'), NOW);
    expect(finding.note).toContain('no report or issue date could be read');
  });
});

describe('reading a purity', () => {
  it('reads a percentage near a purity label', () => {
    expect(findPurity('Purity 99.5%')?.value).toBe(99.5);
    expect(findPurity('Assay: 98 %')?.value).toBe(98);
  });

  it('ignores percentages that are not purity', () => {
    // A moisture or impurity figure is not the assay, and reading one as purity would fail a
    // compliant certificate on a `critical` rule.
    expect(findPurity('Moisture content 0.4%')).toBeNull();
  });

  it('refuses a figure outside 0-100', () => {
    expect(findPurity('Purity 998%')).toBeNull();
  });
});

describe('COA-004 — required fields', () => {
  const full =
    'Certificate of Analysis. Lot Number: SC-4471. Date of Analysis: 2026-07-15. ' +
    'Compound: BPC-157. Purity: 99.2%. Method: HPLC.';

  it('passes when every declared field is present, naming the preferred method', () => {
    const finding = checkCoaFields(COA_004, certificate(full));
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('The preferred method, HPLC, is named');
    expect(finding.note).toContain('names everything the rule requires');
    expect(finding.note).toContain('reports what the certificate states');
  });

  it('names what it could not find in words, not in rule-set identifiers', () => {
    const finding = checkCoaFields(COA_004, certificate('Compound: BPC-157. Purity: 99.2%.'));
    expect(finding.state).toBe('review');
    // D-060: `batch_lot` is an identifier in the rule set, not something an underwriter reads.
    expect(finding.note).toContain('a batch or lot number');
    expect(finding.note).not.toContain('batch_lot');
    // D-018: the limit of the observation is in the finding.
    expect(finding.note).toContain('anything present only as an image would not be found');
  });
});

/**
 * The three ways of not getting a certificate are three different facts (D-058).
 *
 * They used to share one sentence — "no product page linked to one, **or** the link did not
 * resolve to a document" — and the attempts that would have distinguished them were computed and
 * dropped before reaching a finding. That is hard constraint 3 broken and the pre-D-044
 * conflation one check down.
 */
describe('why no certificate was retrieved', () => {
  const attempts = [
    { url: 'https://shop.example/coa/a.pdf', status: 404 },
    { url: 'https://shop.example/coa/b.pdf', status: 200, error: "served 5120 byte(s) as 'text/html'" },
  ];

  it('reports a broken certificate link as the merchant, and says it looks live', () => {
    const finding = checkCoaPurity(COA_003, { found: false, why: 'link_broken', attempts });

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_exposed');
    // The sharpest of the three: a link that resolves and serves something else.
    expect(finding.note).toContain('looks live to a customer');
    expect(finding.evidence[0]?.attempts).toHaveLength(2);
  });

  /**
   * A request that never completed is a fact about this run, not about the merchant. It gets its
   * own kind because filing it under `not_exposed` would say a merchant published nothing because
   * our request failed.
   */
  it('reports a failed request as not_retrieved, not as the merchant', () => {
    const finding = checkCoaDate(
      COA_002,
      { found: false, why: 'not_retrieved', attempts: [{ url: 'https://shop.example/coa/a.pdf', status: 0 }] },
      NOW,
    );

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
    expect(finding.note).toContain('limitation of this run rather than an observation about the merchant');
  });

  it('carries the attempts on every failure, whichever it is', () => {
    for (const why of ['not_published', 'link_broken', 'not_retrieved'] as const) {
      const finding = checkCoaFields(COA_004, { found: false, why, attempts });
      // Hard constraint 3: a not_evaluable finding evidences *why*, with what was requested.
      expect(finding.evidence[0]?.attempts, why).toEqual(attempts);
    }
  });
});

/**
 * Bytes coming out is not text coming out (D-058).
 *
 * biotechpeptides.com's certificate decoded to 2,944 characters with no run of three letters in
 * it — a subset font with its own encoding and no character map. The field readers then found
 * nothing, and COA-004 reported "5 of 5 required fields were not found": an observation about the
 * merchant's certificate derived from our inability to read it.
 */
describe('unreadable extraction is not an empty document', () => {
  it('rejects extracted bytes that are not readable text', () => {
    // The real extraction from biotechpeptides.com's certificate, verbatim.
    const garbled = String.raw`!"#  $% # '    +#', - 7   .  7   )    ( $#' $=$9"$ 9# ,#>75$ +##  ,$# $.`;
    expect(isReadableText(garbled)).toBe(false);
  });

  it('accepts real certificate text', () => {
    expect(
      isReadableText('Vanguard Laboratory Report To: Compound: GLOW Lot Number: C74111 Purity 99.50%'),
    ).toBe(true);
  });

  it('accepts nothing too short to judge', () => {
    expect(isReadableText('Purity')).toBe(false);
  });
});
