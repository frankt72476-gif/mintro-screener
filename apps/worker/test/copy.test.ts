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
import { readFileSync, readdirSync } from 'node:fs';
import { loadRulesetFile } from '@mintro/ruleset';
import { composeInvitation } from '../src/invite.js';
import { composeResponseNotice } from '../src/responseNotice.js';
import { INVITATION_CONTACT_LINE, REPORT_CONTACT_LINE, isPointerContactLine } from '../src/contactLine.js';
import {
  CHARACTERISATION_TERMS,
  DIRECTIVE_TERMS,
  INTERNAL_TERMS,
  PARTICIPATION_TERMS,
  assembleReport,
  auditCopy,
  auditInternalVocabulary,
  quotedFromEvidence,
  type Finding,
  type ScreeningReport,
  STATE_LABEL,
  STATE_LABEL_LOWER,
} from '@mintro/engine';
import { formatReportDay } from '@mintro/engine';
import { bodyFor, subjectFor } from '../src/send.js';

/** A delivered link, in the shape `reportLinkFor` builds. */
const REPORT_LINK =
  'https://screener.gomintro.com/r/11111111-2222-4333-8444-555555555555/x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';

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
/** Tracked, so there is always something to read. See `fixtures/reports/README.md`. */
const REPORT_FIXTURES = 'fixtures/reports';

/**
 * Seven, and a **floor** rather than a total: a corpus that shrinks fails as loudly as one that
 * vanishes. Delete four fixtures and every assertion below still runs, still passes, and covers
 * three reports instead of seven — the same defect, quieter, and nothing else would catch it.
 * Growth does not touch this number. `fixtures/reports/README.md` has the corpus.
 */
const REPORT_FIXTURE_FLOOR = 7;

/**
 * The pinned reports, or an error.
 *
 * This read `reports/` — the worker's local output directory, which is gitignored — behind
 * `if (!existsSync('reports')) return []`. On the machine that produced them it audited every
 * report. On a clean checkout it audited **nothing** and said so by saying nothing, which is the
 * vacuous pass this project exists to refuse. It throws now: no input is not a green audit.
 */
function storedReports(): ScreeningReport[] {
  const files = readdirSync(REPORT_FIXTURES).filter((file) => file.endsWith('.json'));
  // Two diagnoses, not one. An empty directory is a checkout or a working-directory problem; a
  // short one is a fixture somebody removed. Same remedy, different thing to go and look at.
  if (files.length === 0) throw new Error(`no report fixtures in ${REPORT_FIXTURES}/`);
  if (files.length < REPORT_FIXTURE_FLOOR) {
    throw new Error(
      `${REPORT_FIXTURES}/ holds ${files.length} reports; at least ${REPORT_FIXTURE_FLOOR} are expected. ` +
        `Restore the missing fixture, or lower the floor deliberately and record why.`,
    );
  }
  return files.map(
    (file) => JSON.parse(readFileSync(`${REPORT_FIXTURES}/${file}`, 'utf8')) as ScreeningReport,
  );
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
    expect(reports.length, 'fixtures/reports/ is tracked and must not be empty').toBeGreaterThan(0);
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
    /*
      Built from the current rule set rather than read out of `reports/`.

      This compared stored fixtures against `rules/ruleset.json`, which is the D-002 mistake: a
      completed run snapshots its clauses and the rule set moves on without it. The five fixtures are
      at rule set 2.9.0 and the file is at 3.0.0, so the comparison was asserting that an immutable
      record tracks a mutable one.

      The property itself is worth keeping — a report must carry the clause exactly as the rule set
      states it, imperatives intact — so it is asserted where it is true: over a report assembled from
      the rule set now loaded. `assembleReport` fills in every rule that no layer ran, so this covers
      the whole corpus rather than whatever a particular crawl happened to reach.
    */
    const ruleset = loadRulesetFile('rules/ruleset.json');
    const report = assembleReport(
      {
        runId: 'copy-audit',
        merchantDomain: 'shop.example',
        mode: 'public',
        startedAt: '2026-08-26T00:00:00.000Z',
        finishedAt: '2026-08-26T00:01:00.000Z',
        findings: [] as Finding[],
        politeness: 'none declared',
      },
      ruleset,
    );

    const clauses = new Map(ruleset.rules.map((rule) => [rule.id, rule.clause]));
    const rendered = report.categories.flatMap((category) => category.findings);

    for (const finding of rendered) {
      expect(finding.clause, finding.ruleId).toBe(clauses.get(finding.ruleId));
    }

    // Discriminating rather than vacuous: the point is that an imperative survives the trip. If no
    // clause carries one, this test proves nothing about imperatives and should be read again.
    const imperative = rendered.filter((finding) => /\b(must|never|cannot|do not)\b/i.test(finding.clause));
    expect(imperative.length, 'no clause carries an imperative — this audit has nothing to guard').toBeGreaterThan(0);
  });

  /**
   * The same property, on the fixtures, pointed at what is actually true of them.
   *
   * A stored run's clause is its own — D-002 — so there is no external text to compare it against.
   * What still has to hold is that our audit leaves it alone: a clause quotes the standards and says
   * "must", and sanitising it would misquote the document the merchant was screened against.
   */
  it('leaves the imperatives in a stored run alone', () => {
    const withImperatives = reports.flatMap((report) =>
      report.categories.flatMap((category) =>
        category.findings.filter((finding) => /\b(must|never|cannot|do not)\b/i.test(finding.clause)),
      ),
    );

    expect(withImperatives.length, 'no stored clause carries an imperative to leave alone').toBeGreaterThan(0);
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
    link: 'https://screener.gomintro.com/comment/TOKEN',
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
    /*
      A count is a fact; "issues", "problems" and "concerns" are readings, and IQwallet makes them.

      This was a regex typed into this file, and it could not fail: the word boundaries in it were
      literal backspace bytes rather than backslash-b escapes, so the pattern only matched a characterisation
      with a control character beside it. The assertion had been green over text nobody was checking.

      It is now `CHARACTERISATION_TERMS` in `@mintro/engine`, audited by the same `auditCopy` every
      other surface uses — the operator notification needs the same rule, and a second copy of a rule
      in a test file is what produced a check that never checked anything (D-029).
    */
    expect(auditCopy(invitation.body, CHARACTERISATION_TERMS).flagged).toEqual([]);
    expect(auditCopy(invitation.subject, CHARACTERISATION_TERMS).flagged).toEqual([]);
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

  /**
   * What Mintro is, said before the count (D-141).
   *
   * This arrives unexpected from a company the reader may never have heard of, and the natural
   * assumption about whoever just screened your storefront is that they decide something. The
   * sentence is in the opening rather than the sign-off for that reason: by the time a reader reaches
   * "50 observations are open for your response" they have already been told who acts on them.
   *
   * The comment page carries the same sentence, so a reader who opens the link is told once and told
   * the same thing.
   */
  it('says what Mintro does and does not do, before it says what was found', () => {
    /*
      Asserted against the message as it reads, not as it wraps.

      `body` is hard-wrapped plain text joined with newlines, so both of this ruling's sentences
      straddle a line break. Matching the wrapped form would pin the wrap points — a re-wrap that
      changes nothing a reader sees would turn this red, and the usual response to that is to loosen
      the assertion until it stops noticing anything.
    */
    const flowed = invitation.body.split(String.fromCharCode(10)).join(' ');

    expect(flowed).toContain(
      'Mintro reports what it observed; it does not underwrite the account or decide the outcome.',
    );

    // Before the count, not after it: by the time a reader reaches "50 observations are open for your
    // response" they have already been told who acts on them.
    const role = flowed.indexOf('does not underwrite');
    const count = flowed.indexOf('observations are open for your response');
    expect(role, 'the role sentence is missing').toBeGreaterThan(-1);
    expect(count, 'the count is missing').toBeGreaterThan(-1);
    expect(role, 'the count should not precede what Mintro is').toBeLessThan(count);
  });

  it('screens against standards rather than somebody’s programme', () => {
    const flowed = invitation.body.split(String.fromCharCode(10)).join(' ');
    expect(flowed).toContain('research-use-only peptide standards');
    expect(invitation.body).not.toMatch(/\bprogramme\b/i);
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
      expect(subjectFor(report)).toBe(
        `Mintro screening report: ${report.merchantDomain}, ${formatReportDay(report.finishedAt)}`,
      );

      /*
        No counts, asserted as *no counts* rather than as "no digits".

        This was `not.toMatch(/\d/)`, which was a fair proxy while the subject held only a domain
        and became wrong the moment it carried a date. Strip the two things that legitimately
        contain digits — the merchant's domain and the completed date — and nothing numeric may
        remain.
      */
      const withoutData = subjectFor(report)
        .replace(report.merchantDomain, '')
        .replace(formatReportDay(report.finishedAt), '');
      expect(withoutData).not.toMatch(/\d/);

      // The date is the masthead's, from the one formatter, so the message and the document it
      // announces cannot disagree about when the run completed.
      expect(subjectFor(report)).toContain(formatReportDay(report.finishedAt));

      // External-facing copy carries no em dash.
      expect(subjectFor(report)).not.toContain('\u2014');
      // The current vocabulary, not the retired one. A guard listing words nothing renders is a
      // guard that cannot fire (D-175).
      for (const label of Object.values(STATE_LABEL)) {
        expect(subjectFor(report), label).not.toMatch(new RegExp(`\b${label}\b`, 'i'));
      }
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s keeps the counts, beside the coverage that qualifies them',
    (_domain, report) => {
      // Dropped from the subject, not from the message. Three failures out of ninety-seven
      // evaluable findings is a different fact from three out of five.
      const body = bodyFor(report, 'Captures attached.', REPORT_LINK);
      // Read from the shared set, so this cannot go on asserting a word the report stopped using
      // — which is how the mail and the document it announces came to name states differently
      // in the first place (D-175).
      expect(body).toContain(`${report.counts.fail} ${STATE_LABEL_LOWER.fail}`);
      expect(body).toContain('findings were evaluable from this crawl');
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s points the reader at a person',
    (_domain, report) => {
      // D-065, extended to this audience: IQwallet knowing who Mintro is removes the need to
      // verify the sender, not the need to reach a person. An underwriter with a question about a
      // capture is mid-decision on a merchant, and the reply-to here is a no-reply address.
      expect(bodyFor(report, 'Captures attached.', REPORT_LINK)).toContain(REPORT_CONTACT_LINE);
      expect(isPointerContactLine(REPORT_CONTACT_LINE)).toBe(true);
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s states counts without instructing',
    (_domain, report) => {
      expect(offending(bodyFor(report, 'Captures attached.', REPORT_LINK))).toEqual([]);
    },
  );

  it('says findings are not determinations', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The posture stated plainly in the one place a recipient definitely reads.
    expect(bodyFor(report, '', REPORT_LINK)).toContain('not compliance determinations');
  });

  it('does not let an analyst note bypass the audit unnoticed', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The note is analyst-supplied and travels into the email. If one day it is audited too,
    // this is where that is decided — for now it is passed through and this records that.
    const body = bodyFor(report, 'You should reject this merchant.', REPORT_LINK);
    expect(offending(body)).toContain('should');
  });

  it('carries the report link, and says who serves it', () => {
    /*
      Nothing is attached any more (D-255). The email states where the report is and that Mintro
      serves it, and does not explain that the format changed or why: the reader is here to read a
      report, not to hear about a delivery decision.
    */
    const report = reports[0];
    if (report === undefined) return;
    const body = bodyFor(report, 'Captures attached.', REPORT_LINK);

    expect(body).toContain(REPORT_LINK);
    expect(body).toContain('served by Mintro');
    expect(body).not.toContain('attached report');
    expect(body).not.toMatch(/\.pdf\b/);
  });

  it('says the link is live and that a copy can be saved', () => {
    /*
      The property chosen when serving was chosen over attaching, said plainly and without alarm.
      IQwallet learns it from us on the day the report arrives rather than from a link that does
      not answer one afternoon.
    */
    const report = reports[0];
    if (report === undefined) return;
    const body = bodyFor(report, '', REPORT_LINK);

    expect(body).toContain('live link rather than a file you now hold');
    expect(body).toContain('save the page');
    // Frank's ruling: no em dashes in this copy.
    expect(body).not.toContain('\u2014');
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

/**
 * The operator notification (D-143 … D-146).
 *
 * Internal mail, and that is the argument for auditing it rather than against. Nothing else Mintro
 * writes describes a merchant's *conduct*, and an operator who reads "the merchant failed to
 * respond" in their own inbox every week will eventually write it into a covering note — where
 * D-029 catches it after it has been typed rather than before it was ever modelled.
 */
describe('the response-round notification', () => {
  const submitted = composeResponseNotice({
    merchantDomain: 'shop.example',
    runLink: 'https://screener.gomintro.com/?report=shop.example',
    allIn: false,
    submittedCount: 1,
    invitedCount: 2,
    event: {
      kind: 'submitted',
      address: 'ops@shop.example',
      at: new Date('2026-08-27T14:05:00.000Z'),
    },
  });

  const allIn = composeResponseNotice({
    merchantDomain: 'shop.example',
    runLink: 'https://screener.gomintro.com/?report=shop.example',
    allIn: true,
    submittedCount: 1,
    invitedCount: 2,
    event: {
      kind: 'not_responding',
      address: 'owner@shop.example',
      by: 'analyst@example.com',
      at: new Date('2026-08-27T14:20:00.000Z'),
    },
  });

  const resubmitted = composeResponseNotice({
    merchantDomain: 'shop.example',
    runLink: 'https://screener.gomintro.com/?report=shop.example',
    // Never true for a re-submit: a re-submit is by an address that resolved when it first
    // submitted, so it cannot move the invited set (D-151).
    allIn: false,
    submittedCount: 2,
    invitedCount: 2,
    event: {
      kind: 'resubmitted',
      address: 'ops@shop.example',
      at: new Date('2026-08-28T11:00:00.000Z'),
      addedAt: new Date('2026-08-28T10:55:00.000Z'),
    },
  });

  it.each([
    ['submit', submitted],
    ['all-in', allIn],
    ['re-submit', resubmitted],
  ])('%s instructs nobody and characterises nobody', (_name, notice) => {
    // `PARTICIPATION_TERMS` is the directive list plus the words that only make sense about a
    // *party*: "issues", "concerns", "failures", "unresponsive".
    expect(auditCopy(notice.subject, PARTICIPATION_TERMS).flagged).toEqual([]);
    expect(auditCopy(notice.body, PARTICIPATION_TERMS).flagged).toEqual([]);
  });

  it.each([
    ['submit', submitted],
    ['all-in', allIn],
    ['re-submit', resubmitted],
  ])("%s carries none of Mintro's internal vocabulary", (_name, notice) => {
    expect(auditInternalVocabulary(notice.subject).clean).toBe(true);
    expect(auditInternalVocabulary(notice.body).clean).toBe(true);
  });

  it('leads with the all-in line only when the round is in', () => {
    expect(allIn.body.startsWith('All invited responses are in.')).toBe(true);
    expect(submitted.body).not.toContain('All invited responses are in');
  });

  it('says all-in has closed nothing', () => {
    /*
      The single most likely misreading, and it is worth a sentence in every one of these.

      An operator who sees "All invited responses are in" once a week will start reading it as the
      system having done something. It has not: nothing was closed, nothing was sent, and the round
      ends when they send the combined document (D-143, D-148).
    */
    expect(allIn.body).toContain('Nothing has been closed or sent');
  });

  it('reports the count as a count', () => {
    expect(submitted.body).toContain('1 of 2 invited have submitted.');
  });

  it('keeps a self-declared identity self-declared', () => {
    // The address was typed into a box on a page anyone holding a forwarded link can open. "From
    // ops@shop.example" would present it as established, which is the claim D-144 refuses to make.
    expect(submitted.body).toContain('Someone identified as ops@shop.example');
  });

  it('attributes a not-responding mark to the operator who made it', () => {
    // Mintro's judgement, named as Mintro's. Rendering it as a fact about the merchant is the one
    // thing D-145 forbids, and an unattributed line is how that happens.
    expect(allIn.body).toContain('was marked as not responding by analyst@example.com');
    expect(allIn.body).toContain('operator judgement, recorded as one');
  });

  it('says plainly what a re-submit is, without telling anyone to act on it', () => {
    expect(resubmitted.body.startsWith('A responder added to their response after submitting.')).toBe(
      true,
    );
    // The earlier response is not replaced, and an operator should not have to infer that.
    expect(resubmitted.body).toContain('Their earlier response stands');
    // And never the all-in line: a re-submit cannot resolve an invited set that already resolved.
    expect(resubmitted.body).not.toContain('All invited responses are in');
  });

  it('links to the run rather than describing what to do with it', () => {
    expect(allIn.body).toContain('https://screener.gomintro.com/?report=shop.example');
    // No "please review", no "action required" — those are in `DIRECTIVE_TERMS` and the audit above
    // would catch them, but the shape matters too: the message ends at a link.
    expect(allIn.body.trimEnd().split('\n').slice(-3).join(' ')).not.toMatch(/\bplease\b/i);
  });
});
