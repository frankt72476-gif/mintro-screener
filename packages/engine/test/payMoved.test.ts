/**
 * PAY-002 is asked, not crawled (D-226).
 *
 * It was a rule that could not observe its own subject. You cannot see who processes a merchant's
 * card payments from their storefront — a correctly gated checkout never shows an anonymous
 * visitor, and a footer's payment marks name a card network, not the processor behind it — so
 * every run reported it `not_evaluable` with the reason *"requires merchant attestation."*
 *
 * A rule whose only output is "ask the merchant" is a question wearing a rule's clothes. It is now
 * a question.
 *
 * ## The requirement did not change, and this is the part to get right
 *
 * The published standard still carries the sentence, byte for byte, in the corpus. What changed is
 * how Mintro checks it: ask, do not crawl. These assert that framing structurally — the clause is
 * still in the corpus, the question quotes it verbatim, and the corpus count still reconciles
 * exactly rather than being relaxed to absorb the difference.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkAgainstCorpus, corpusClauseLines, loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { FINDING_TERMS, auditCopy } from '../src/copy.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';
import { resolve } from 'node:path';

const CORPUS_PATH = resolve(REPO_ROOT, 'rules/sources/ruo-standards-v1.1.md');

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const corpus = readFileSync(CORPUS_PATH, 'utf8');

const CLAUSE =
  'Card payments must run through a legitimate merchant processor that performs proper KYC. ' +
  'How a seller collects money is read as evidence of how the business is run.';

const question = ruleset.attestations.find((entry) => entry.id === 'payment-processor-kyc');

describe('PAY-002 has left the crawl set', () => {
  it('is no longer a rule, so it produces no finding', () => {
    // The old path is gone entirely: nothing to run, nothing to render, nothing to count. A rule
    // that stayed would render `not_evaluable` beside its own question and be counted twice.
    expect(ruleset.rules.map((rule) => rule.id)).not.toContain('PAY-002');
    expect(ruleset.rules.filter((rule) => rule.cat === 'payment').map((rule) => rule.id)).toEqual([
      'PAY-001',
      'PAY-003',
    ]);
  });

  it('leaves no rule whose only answer is to ask the merchant', () => {
    /*
      The shape that made this a question. Ten `manual` rules remain and each names something a
      crawl cannot reach — but PAY-002's reason said "requires merchant attestation" while an
      attestation section sat in the same report, which is the duplication this closes.

      The others stay rules for now; whether any follows is a separate ruling, and this asserts only
      that PAY-002 is not among them.
    */
    const manual = ruleset.rules.filter((rule) => rule.type === 'manual');
    expect(manual).toHaveLength(10);
    expect(manual.map((rule) => rule.id)).not.toContain('PAY-002');
  });
});

describe('and arrived as a question', () => {
  it('is in the attestation set, beside the other payment question', () => {
    expect(question, 'payment-processor-kyc is not in the attestation set').toBeDefined();

    const ids = ruleset.attestations.map((entry) => entry.id);
    expect(ids).toHaveLength(20);
    // Beside `payment-channels`, which asks a different thing — see below.
    expect(ids[ids.indexOf('payment-channels') + 1]).toBe('payment-processor-kyc');
  });

  it('asks what the merchant does, and determines nothing', () => {
    expect(question!.question).toBe(
      'Who processes your card payments, and did they run KYC on you when you were onboarded?',
    );

    // A question, in the register of the other nineteen (D-067: ask what they do, never whether
    // they comply). And it passes the guard the report's own copy passes (D-217, D-224).
    expect(question!.question.endsWith('?')).toBe(true);
    const audit = auditCopy(question!.question, FINDING_TERMS);
    expect(audit.clean, `flagged ${audit.flagged.join(', ')}`).toBe(true);
  });

  /**
   * A distinct question, not an extension of the existing one.
   *
   * `payment-channels` asks whether money arrives by any route other than card processing — a
   * different fact with a different answer. A merchant can take card payments only and still be
   * processed by somebody who ran no KYC, and folding the two together would let one answer stand
   * for both.
   */
  it('does not restate the payment-channels question', () => {
    const channels = ruleset.attestations.find((entry) => entry.id === 'payment-channels')!;

    expect(channels.question).toBe('Do you accept payment through any channel other than card processing?');
    expect(question!.question).not.toBe(channels.question);
    expect(channels.question.toLowerCase()).not.toContain('kyc');
  });

  it('carries the severity the rule carried', () => {
    // The requirement did not become more or less important by changing how it is checked.
    expect(question!.sev).toBe('major');
    expect(question!.authority).toBe('programme');
  });
});

describe('the requirement is still the standard, and still checked against it', () => {
  it('keeps its clause in the published corpus', () => {
    // The sentence never left the standards document, and this is what makes "moved, not dropped"
    // a fact rather than a framing.
    expect(corpus.includes(CLAUSE)).toBe(true);
  });

  it('quotes the corpus verbatim on the question', () => {
    expect(question!.clause).toBe(CLAUSE);
    expect(corpus.includes(question!.clause!)).toBe(true);
  });

  /**
   * The count still reconciles exactly, which is what stops this being a relaxation.
   *
   * 53 published requirements: 52 crawled, 1 asked. An inequality here would let the corpus and
   * the rule set drift by any amount as long as somebody called the difference an attestation.
   */
  it('reconciles: 52 rules plus 1 question equals 53 clause lines', () => {
    const programme = ruleset.rules.filter((rule) => rule.source === 'programme');
    const asked = ruleset.attestations.filter((entry) => entry.clause !== undefined);
    const lines = corpusClauseLines(corpus);

    expect(programme).toHaveLength(52);
    expect(asked).toHaveLength(1);
    expect(lines).toHaveLength(53);
    expect(programme.length + asked.length).toBe(lines.length);

    expect(checkAgainstCorpus(ruleset, corpus, 'corpus')).toEqual([]);
  });

  /**
   * The control, made to fail the way it exists to catch (D-026).
   *
   * If the question's clause could drift from the standard's the moment it stopped being a rule,
   * "the requirement did not change" would be false within one edit. The validator holds a
   * question's clause to the corpus exactly as it holds a rule's.
   */
  it('refuses a question whose clause is not in the corpus', () => {
    const drifted = {
      ...ruleset,
      attestations: ruleset.attestations.map((entry) =>
        entry.id === 'payment-processor-kyc'
          ? { ...entry, clause: 'Card payments must run through a processor of some kind.' }
          : entry,
      ),
    } as Ruleset;

    const defects = checkAgainstCorpus(drifted, corpus, 'corpus');
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.map((defect) => defect.message).join(' | ')).toContain('payment-processor-kyc');
  });

  it('refuses a clause that leaves the corpus with nothing asking it', () => {
    // The other direction: drop the question's clause and the corpus carries a line nobody quotes.
    const orphaned = {
      ...ruleset,
      attestations: ruleset.attestations.map((entry) =>
        entry.id === 'payment-processor-kyc' ? { id: entry.id, question: entry.question, authority: entry.authority, sev: entry.sev } : entry,
      ),
    } as Ruleset;

    const text = checkAgainstCorpus(orphaned, corpus, 'corpus').map((defect) => defect.message).join(' | ');
    expect(text).toContain('the two files have moved apart');
    expect(text).toContain('no rule quotes');
  });
});
