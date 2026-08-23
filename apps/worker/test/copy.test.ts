/**
 * The copy audit.
 *
 * Hard constraint 7 and D-001: findings describe what was observed, never what should happen
 * next. D-001 replaced a "DO NOT FORWARD" banner with a statement of fact and extended the
 * discipline to *all report copy*.
 *
 * This audits every string the system generates for a real run — verdict, finding notes, the
 * covering email, the subject line — because directive language creeps back in through whichever
 * surface nobody is checking. The email is the likeliest: a covering note is the most natural
 * place to write "please review" and the least likely place anyone looks for a compliance
 * problem.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadRulesetFile } from '@mintro/ruleset';
import { composeInvitation } from '../src/invite.js';
import { INVITATION_CONTACT_LINE, REPORT_CONTACT_LINE, isPointerContactLine } from '../src/contactLine.js';
import {
  DIRECTIVE_TERMS,
  INTERNAL_TERMS,
  assembleReport,
  auditCopy,
  auditInternalVocabulary,
  quotedFromEvidence,
  type Finding,
  type ScreeningReport,
} from '@mintro/engine';
import { bodyFor, subjectFor, attachmentName } from '../src/send.js';

/**
 * The audited vocabulary lives in `@mintro/engine` (D-029), not here.
 *
 * The same list guards the analyst's covering note at compose time in the browser. A second copy
 * in this file would drift from the one the product actually uses, on the surface where drift
 * matters most.
 */
const DIRECTIVE = DIRECTIVE_TERMS;

function offending(text: string): string[] {
  return [...auditCopy(text).flagged];
}

/** The most recent real run, when one has been produced. */
function storedReports(): ScreeningReport[] {
  if (!existsSync('reports')) return [];
  return readdirSync('reports')
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(`reports/${file}`, 'utf8')) as ScreeningReport);
}

describe('the audit catches what it is looking for', () => {
  it.each(DIRECTIVE)('flags %s', (term) => {
    expect(offending(`This finding ${term} something.`)).toContain(term);
  });

  it('does not fire on words that merely contain a directive term', () => {
    // Word boundaries, so a longer word containing a flagged term is not a match.
    expect(offending('The shoulder injury claim was observed.')).toEqual([]);
    expect(offending('Illegally obtained is a different token.')).toEqual([]);
    expect(offending('The copy was suggestive rather than explicit.')).toEqual([]);
    expect(offending('An advisory notice was observed in the footer.')).toEqual([]);
  });
});

describe('generated report copy', () => {
  const reports = storedReports();

  it('has a real run to audit', () => {
    // A green audit over zero reports would be a green audit over nothing.
    expect(reports.length, 'run `npm run scan-full -- --report-dir ./reports <url>` first').toBeGreaterThan(0);
  });

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'verdict for %s instructs nobody',
    (_domain, report) => {
      expect(offending(report.verdict)).toEqual([]);
    },
  );

  it('no finding note instructs the reader', () => {
    const problems: string[] = [];
    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          const found = offending(finding.note);
          if (found.length > 0) problems.push(`${report.merchantDomain} ${finding.ruleId}: ${found.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('no not-evaluable reason instructs the reader', () => {
    const problems: string[] = [];
    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          const reason = finding.notEvaluableReason;
          if (reason === undefined) continue;
          const found = offending(reason);
          if (found.length > 0) problems.push(`${report.merchantDomain} ${finding.ruleId}: ${found.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Rule clauses are the exception, and the reason is worth stating.
   *
   * A clause quotes the program document — "Guest checkout must be disabled" — and is source
   * material, not Mintro's characterisation. Rewriting them to avoid "must" would misquote the
   * rules the merchant is being screened against. What matters is that our own copy around them
   * stays descriptive.
   */
  it('quotes rule clauses verbatim, including their imperatives', () => {
    const ruleset = loadRulesetFile('rules/ruleset.json');
    const clauses = new Map(ruleset.rules.map((rule) => [rule.id, rule.clause]));

    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          expect(finding.clause).toBe(clauses.get(finding.ruleId));
        }
      }
    }
  });
});

/**
 * Mintro's internal vocabulary never reaches the reader (D-044).
 *
 * The report is read by an underwriter deciding on a merchant. "no layer 3 runner has been built
 * for check type 'dom_assert'" tells them nothing they can use and, worse, reads as something
 * wrong with the merchant's site when it is a gap in this tool.
 *
 * Clauses are exempt for the same reason they are exempt from the directive audit: they quote the
 * program document and are source material rather than our words.
 */
describe('internal vocabulary stays internal', () => {
  const reports = storedReports();

  it('catches the wording this rule exists to remove', () => {
    const audit = auditInternalVocabulary(
      "no layer 3 runner has been built for check type 'dom_assert', so this rule was not examined",
    );
    expect(audit.clean).toBe(false);
    expect(audit.flagged).toContain('dom_assert');
    expect(audit.flagged).toContain('layer 3');
    expect(audit.flagged).toContain('check type');
    expect(audit.flagged).toContain('runner');
  });

  it('leaves ordinary report sentences alone', () => {
    expect(auditInternalVocabulary('The footer disclaimer was contrast ratio 2.94:1.').clean).toBe(true);
    // `manual` is an English word as well as a check type, so it is not on the list.
    expect(auditInternalVocabulary('Requires a manual review of the signed agreement.').clean).toBe(true);
  });

  /**
   * Assembled from the real rule set with no findings, so every rule falls through to the
   * unrun path — which is precisely the copy this rule is about, and there is no way for this
   * to pass vacuously.
   */
  it('finds none of it in a report assembled from the current rule set', () => {
    const ruleset = loadRulesetFile('rules/ruleset.json');
    const report = assembleReport(
      {
        runId: 'run-1',
        merchantDomain: 'shop.example',
        mode: 'public',
        startedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:01:00.000Z',
        findings: [],
        politeness: 'no Crawl-delay declared',
      },
      ruleset,
    );

    const problems: string[] = [];
    for (const category of report.categories) {
      for (const finding of category.findings) {
        const quoted = quotedFromEvidence(finding.evidence);
        for (const text of [finding.title, finding.note, finding.notEvaluableReason ?? '']) {
          const audit = auditInternalVocabulary(text, quoted);
          if (!audit.clean) problems.push(`${finding.ruleId} · ${audit.flagged.join(', ')} · ${text}`);
        }
      }
    }

    expect(problems).toEqual([]);
    // Every rule reached the report, so the sweep above covered all of them.
    expect(report.categories.flatMap((c) => c.findings)).toHaveLength(ruleset.rules.length);
  });

  /**
   * Stored reports are audited too, but only the findings that carry a kind.
   *
   * A run recorded before D-044 has the old wording baked into an immutable record (D-002). It
   * cannot be corrected and must not fail the build forever; what matters is that nothing
   * generated *now* carries it, which the assembled-report case above proves without exception.
   */
  it('finds none of it anywhere a reader looks in current runs', () => {
    const problems: string[] = [];

    for (const report of reports) {
      for (const text of [report.verdict, report.politeness, ...report.truncations]) {
        const audit = auditInternalVocabulary(text);
        if (!audit.clean) problems.push(`${report.merchantDomain} · ${audit.flagged.join(', ')} · ${text}`);
      }

      for (const category of report.categories) {
        for (const finding of category.findings) {
          // Pre-D-044 run: the distinction was not recorded, and the record is immutable.
          if (finding.state === 'not_evaluable' && finding.notEvaluableKind === undefined) continue;
          // `clause` is excluded: it quotes the program document verbatim. The merchant's own
          // markup is exempt too — a CSS selector *is* the evidence (D-060 amended).
          const quoted = quotedFromEvidence(finding.evidence);
          for (const text of [finding.title, finding.note, finding.notEvaluableReason ?? '']) {
            const audit = auditInternalVocabulary(text, quoted);
            if (!audit.clean) {
              problems.push(`${report.merchantDomain} ${finding.ruleId} · ${audit.flagged.join(', ')} · ${text}`);
            }
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  /**
   * A CSS selector is the evidence, and must survive the audit intact (D-060 amended).
   *
   * DISC-002 quotes where it found the disclaimer. On two of the five storefronts that is a Divi
   * theme path — `div.et_pb_column > div.et_pb_module > div.et_pb_text_inner`. Those are the
   * merchant's class names, and a guard that flagged them would either force the selector out of
   * the finding or teach whoever saw the failure to suppress it.
   */
  it("exempts the merchant's own markup, quoted as evidence", () => {
    const note =
      'The footer disclaimer at div.et_pb_column > div.et_pb_module > div.et_pb_text_inner > p ' +
      'rendered at 14px with a contrast ratio of 21:1.';
    const quoted = ['selector=div.et_pb_column > div.et_pb_module > div.et_pb_text_inner > p'];

    expect(auditInternalVocabulary(note, quoted).clean).toBe(true);
    // Without the provenance, the same string is flagged — which is what the first version did.
    expect(auditInternalVocabulary(note).clean).toBe(false);
  });

  it('still catches our own identifiers when a finding quotes nothing like them', () => {
    const note = "1 of 5 required items were not found: test_date. Found: batch_lot.";
    expect(auditInternalVocabulary(note, ['https://shop.example/coa.pdf']).flagged).toEqual([
      'test_date',
      'batch_lot',
    ]);
  });

  it("reads provenance only from fields the evidence type defines as the merchant's", () => {
    const quoted = quotedFromEvidence([
      {
        matchedValue: 'div.et_pb_column',
        sourceUrl: 'https://shop.example/',
        matchedUrls: ['https://shop.example/a_b'],
        attempts: [{ url: 'https://shop.example/c_d' }],
      },
    ]);

    expect(quoted).toContain('div.et_pb_column');
    expect(quoted).toContain('https://shop.example/a_b');
    expect(quoted).toContain('https://shop.example/c_d');
  });

  it('audits the two lists separately, so a failure says which rule broke', () => {
    // Overlapping lists would report a directive-language failure for a vocabulary problem and
    // send the next reader to the wrong constraint.
    const overlap = INTERNAL_TERMS.filter((term) => DIRECTIVE_TERMS.includes(term));
    expect(overlap).toEqual([]);
  });
});

/**
 * The invitation that carries a comment link (D-063).
 *
 * Reader-facing text, written for a merchant being told a bank's processor screened their
 * storefront. It describes what Mintro could not observe and invites their account of it; it never
 * tells them what to do about a finding, and it never characterises the observations.
 */
describe('the merchant invitation', () => {
  const invitation = composeInvitation({
    merchantDomain: 'shop.example',
    link: 'https://mintro-screener.netlify.app/comment/TOKEN',
    expiresAt: new Date('2026-09-22T00:00:00.000Z'),
    openForComment: 50,
    nothingObserved: 12,
  });

  it('instructs nobody', () => {
    // "Please publish your payment methods" would be remediation advice, which would make Mintro
    // a party to the determination (D-001, D-041).
    expect(offending(invitation.subject)).toEqual([]);
    expect(offending(invitation.body)).toEqual([]);
  });

  it("carries none of Mintro's internal vocabulary", () => {
    expect(auditInternalVocabulary(invitation.subject).clean).toBe(true);
    expect(auditInternalVocabulary(invitation.body).clean).toBe(true);
  });

  it('does not characterise the observations', () => {
    // A count is a fact; "issues", "problems" and "concerns" are readings, and IQwallet makes them.
    expect(invitation.body).not.toMatch(/(issues?|problems?|concerns?|violations?|failures?)/i);
  });

  /**
   * What the email no longer says, and why that is the point (D-067).
   *
   * The first version explained the whole arrangement: which findings have no box and why they are
   * Mintro's gaps, that nothing they write changes an observation, that a fresh link keeps what was
   * already written, that Mintro does not check the address. All true, and all of it made the
   * message longer than the attention an unexpected email from an unfamiliar company gets.
   *
   * **The email only has to get them to the page.** The page carries every one of these beside the
   * evidence it is about, which is where each one means something.
   */
  it('leaves the arrangement to the page', () => {
    const moved = [
      'they are our gaps, not yours',
      'Nothing you write changes what was observed',
      'anything you have already written is kept',
      'Mintro does not check the address',
      'recorded exactly as you write it',
    ];

    for (const sentence of moved) {
      expect(invitation.body, `"${sentence}" belongs on the page now`).not.toContain(sentence);
    }
  });

  it('keeps what the reader needs before they open anything', () => {
    // What this is, what is asked, the link, the expiry — and the contact line, asserted below.
    expect(invitation.body).toContain('Mintro screened the public pages of shop.example');
    expect(invitation.body).toContain('50 observations are open for your response');
    expect(invitation.body).toContain('/comment/TOKEN');
    expect(invitation.body).toContain('The link works until 2026-09-22');
  });

  it('calls out the findings where a response is worth most', () => {
    // The sentence most likely to make someone open the link: it is where their answer is worth
    // most, and the only place on the report with nothing on the site to read instead.
    expect(invitation.body).toContain('12 of them are ones where your pages did not show one way');
  });

  it('says the link may be forwarded, because that decision precedes opening it', () => {
    /*
      The one detail that cannot wait for the page.

      The agent decides whether to forward *before* opening anything, and knowing that responses
      are attributed per person changes that decision — they may answer some findings themselves
      and pass the rest to the merchant rather than answering on their behalf.
    */
    expect(invitation.body).toContain('You can forward this link');
    expect(invitation.body).toContain('gives an email address first');
  });

  it('is short enough to be read', () => {
    // Not a style preference. An unexpected message from an unfamiliar company gets a glance, and
    // the link has to survive it. The first version ran to 24 lines of prose.
    const prose = invitation.body.split(String.fromCharCode(10)).filter((line) => line.trim() !== '');
    expect(prose.length).toBeLessThanOrEqual(14);
  });


  it('points the reader at a person they already deal with', () => {
    expect(invitation.body).toContain(INVITATION_CONTACT_LINE);
    expect(isPointerContactLine(INVITATION_CONTACT_LINE)).toBe(true);
  });

  it('publishes no individual address anywhere in the message', () => {
    /*
      The teeth of D-065, and the thing most likely to creep back — from someone who reads
      "contact line" and reaches for a mailbox.

      The link is exempt: it is the point of the message, and it carries a token rather than a
      person. Everything else that looks like an address is a person's address in a document built
      to be forwarded.
    */
    const withoutLink = invitation.body.replace(/https:\S+/g, '');
    expect(withoutLink).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe('the covering email', () => {
  const reports = storedReports();

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'subject for %s instructs nobody',
    (_domain, report) => {
      expect(offending(subjectFor(report))).toEqual([]);
    },
  );

  /**
   * The subject is the domain and nothing more (D-064).
   *
   * Counts used to travel in it. They are a characterisation of the merchant, and the subject line
   * is the most-forwarded, least-contextual part of the message — a phone notification, a thread
   * title in someone else's inbox. "3 failed" seen there is a verdict, which is IQwallet's to
   * reach and not Mintro's to broadcast; the body carries the same counts with the coverage line
   * beside them, where a reader can weigh them.
   */
  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'subject for %s carries no counts',
    (_domain, report) => {
      expect(subjectFor(report)).toBe(`Screening report — ${report.merchantDomain}`);
      expect(subjectFor(report)).not.toMatch(/\d/);
      expect(subjectFor(report)).not.toMatch(/fail|review|pass|evaluable/i);
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s keeps the counts, beside the coverage that qualifies them',
    (_domain, report) => {
      // Dropped from the subject, not from the message. Three failures out of ninety-seven
      // evaluable findings is a different fact from three out of five.
      const body = bodyFor(report, 'Captures attached.');
      expect(body).toContain(`${report.counts.fail} failed`);
      expect(body).toContain('findings were evaluable from this crawl');
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s points the reader at a person',
    (_domain, report) => {
      // D-065, extended to this audience: IQwallet knowing who Mintro is removes the need to
      // verify the sender, not the need to reach a person. An underwriter with a question about a
      // capture is mid-decision on a merchant, and the reply-to here is a no-reply address.
      expect(bodyFor(report, 'Captures attached.')).toContain(REPORT_CONTACT_LINE);
      expect(isPointerContactLine(REPORT_CONTACT_LINE)).toBe(true);
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s states counts without instructing',
    (_domain, report) => {
      expect(offending(bodyFor(report, 'Captures attached.'))).toEqual([]);
    },
  );

  it('says findings are not determinations', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The posture stated plainly in the one place a recipient definitely reads.
    expect(bodyFor(report, '')).toContain('not compliance determinations');
  });

  it('does not let an analyst note bypass the audit unnoticed', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The note is analyst-supplied and travels into the email. If one day it is audited too,
    // this is where that is decided — for now it is passed through and this records that.
    const body = bodyFor(report, 'You should reject this merchant.');
    expect(offending(body)).toContain('should');
  });

  it('names the attachment after the merchant and the run date', () => {
    const report = reports[0];
    if (report === undefined) return;
    expect(attachmentName(report)).toMatch(/^[a-z0-9.-]+-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe('assembled verdicts across outcomes', () => {
  const ruleset = loadRulesetFile('rules/ruleset.json');

  const build = (findings: readonly Finding[]): ScreeningReport =>
    assembleReport(
      {
        runId: 'run-1',
        merchantDomain: 'shop.example',
        mode: 'public',
        startedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:01:00.000Z',
        findings,
        politeness: 'no Crawl-delay declared',
      },
      ruleset,
    );

  it('instructs nobody when nothing failed', () => {
    expect(offending(build([]).verdict)).toEqual([]);
  });

  it('instructs nobody when everything failed', () => {
    const findings: Finding[] = ruleset.rules
      .filter((rule) => rule.tier === 'auto_fail')
      .map((rule) => ({
        ruleId: rule.id,
        state: 'fail' as const,
        note: 'Observed.',
        evidenceKind: 'document' as const,
        evidence: [],
      }));

    expect(offending(build(findings).verdict)).toEqual([]);
  });
});
