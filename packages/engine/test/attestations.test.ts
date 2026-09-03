/**
 * Resolving the merchant's answers against the questions (D-134).
 *
 * The property that matters most here is the one Frank named: an unanswered question must reach
 * the view as an explicit outcome, not as a missing row the view has to notice was missing. Five
 * of the nineteen questions have no rule of any kind behind them, so an unanswered one there means
 * the requirement has no coverage in the document from any source. A blank would read as nothing
 * to report.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { attestationAsking, resolveAttestations, type StoredAttestation } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const answered = (
  questionId: string,
  body: string,
  submittedAt = '2026-08-26T10:00:00.000Z',
): StoredAttestation => ({
  questionId,
  outcome: 'answered',
  body,
  identifiedAs: 'ops@shop.example',
  submittedAt,
});

const declined = (
  questionId: string,
  submittedAt = '2026-08-26T10:00:00.000Z',
): StoredAttestation => ({
  questionId,
  outcome: 'declined',
  identifiedAs: 'ops@shop.example',
  submittedAt,
});

const find = (result: ReturnType<typeof resolveAttestations>, id: string) => {
  const found = result.questions.find((q) => q.questionId === id);
  if (found === undefined) throw new Error(`no question ${id}`);
  return found;
};

describe('every question appears, answered or not', () => {
  it('lists all of them when nothing was answered', () => {
    const result = resolveAttestations(ruleset.attestations, []);
    expect(result.questions).toHaveLength(ruleset.attestations.length);
    expect(result.counts).toEqual({
      answered: 0,
      onFileWithoutAnswer: 0,
      unanswered: ruleset.attestations.length,
      // Nothing carried forward either: this run inherited nothing because nothing was asked.
      inherited: 0,
      // And nothing recorded on the merchant's behalf (D-212).
      recorded: 0,
      total: ruleset.attestations.length,
    });
  });

  /**
   * Driven by the rule set, not by the stored rows. A join the other way would list what was
   * answered and silently omit what was not, which is the whole failure this is written against.
   */
  it('still lists every question when only one was answered', () => {
    const result = resolveAttestations(ruleset.attestations, [answered('ban-list', 'Yes, permanent.')]);
    expect(result.questions).toHaveLength(ruleset.attestations.length);
    expect(result.counts.unanswered).toBe(ruleset.attestations.length - 1);
  });

  it('keeps the rule set\'s order, so the document reads the same every time', () => {
    const result = resolveAttestations(ruleset.attestations, [answered('prior-termination', 'No.')]);
    expect(result.questions.map((q) => q.questionId)).toEqual(
      ruleset.attestations.map((a) => a.id),
    );
  });
});

describe('unanswered is an outcome, not an absence', () => {
  /**
   * The defect being guarded: an unanswered question arriving as a row with no outcome, which a
   * view renders as an empty cell beside filled-in ones. It has to say what it means — nobody
   * answered, and no check could have.
   */
  it('names the outcome explicitly rather than leaving fields empty', () => {
    const q = find(resolveAttestations(ruleset.attestations, []), 'prior-termination');
    expect(q.outcome).toBe('unanswered');
    expect(q.question).toBe('Has any acquirer, processor or platform terminated you?');
  });

  it('carries no attribution and no body, because nobody was there', () => {
    const q = find(resolveAttestations(ruleset.attestations, []), 'prior-termination');
    expect(q.body).toBeUndefined();
    expect(q.identifiedAs).toBeUndefined();
    expect(q.submittedAt).toBeUndefined();
  });

  it('keeps its authority and severity, which are facts about the requirement', () => {
    const q = find(resolveAttestations(ruleset.attestations, []), 'prior-termination');
    expect(q.authority).toBe('network');
    expect(q.sev).toBe('critical');
  });
});

/**
 * The reverse of what this block used to assert (D-253).
 *
 * It held that declining was its own outcome and *"distinguishable from never having been asked
 * to"*, on the ground that a refusal tells an underwriter something. The ruling that replaced it:
 * *not answered* has too many real shades — did not know how, wanted to discuss it first, had not
 * decided — to be split into refused-versus-blank without claiming to know which. The report is
 * due-diligence evidence, not a determination, so the honest granularity is answered or not.
 *
 * The rows still exist and cannot be rewritten: `merchant_attestations` is append-only. They are
 * collapsed on the way out.
 */
describe('a row with no answer reads as not answered (D-253)', () => {
  it('collapses to unanswered rather than a third state', () => {
    const result = resolveAttestations(ruleset.attestations, [declined('shipping-to-clinics')]);
    const q = find(result, 'shipping-to-clinics');

    expect(q.outcome).toBe('unanswered');
    expect(q.body).toBeUndefined();
    // Every question is now one of two things, and the counts say so.
    expect(result.counts.unanswered).toBe(ruleset.attestations.length);
    expect(result.counts.answered).toBe(0);
  });

  it('is indistinguishable from a question nobody reached, which is the point', () => {
    const result = resolveAttestations(ruleset.attestations, [declined('shipping-to-clinics')]);
    expect(find(result, 'shipping-to-clinics').outcome).toBe(
      find(result, 'prior-termination').outcome,
    );
  });

  /**
   * The one thing the collapse must NOT throw away.
   *
   * A row proves somebody was there, even carrying no answer. Without that, a run whose questions
   * were all refused would flip from *asked* to *not asked* — a false statement about whether
   * anybody was ever put to them, which is a different claim from why a box is empty.
   */
  it('still counts as proof the questions were asked', () => {
    const result = resolveAttestations(ruleset.attestations, [declined('shipping-to-clinics')]);
    expect(result.counts.onFileWithoutAnswer).toBe(1);
    expect(attestationAsking(result.counts, undefined)).toBe('asked');
  });

  it('reports nothing about WHY the box is empty', () => {
    // No surface may reconstruct the distinction from the resolved shape.
    const q = find(resolveAttestations(ruleset.attestations, [declined('ban-list')]), 'ban-list');
    expect(JSON.stringify(q)).not.toContain('declined');
  });
});

describe('answers', () => {
  it('carries the words verbatim, with who said so and when', () => {
    const q = find(
      resolveAttestations(ruleset.attestations, [answered('adult-signature', 'Yes — UPS adult signature 21+.')]),
      'adult-signature',
    );
    expect(q.outcome).toBe('answered');
    expect(q.body).toBe('Yes — UPS adult signature 21+.');
    expect(q.identifiedAs).toBe('ops@shop.example');
    expect(q.submittedAt).toBe('2026-08-26T10:00:00.000Z');
  });
});

describe('a revision supersedes without erasing', () => {
  it('shows the newest answer and keeps the earlier one', () => {
    const q = find(
      resolveAttestations(ruleset.attestations, [
        answered('coa-lab-accreditation', 'First answer.', '2026-08-26T10:00:00.000Z'),
        answered('coa-lab-accreditation', 'ISO 17025, Janoshik.', '2026-08-26T11:00:00.000Z'),
      ]),
      'coa-lab-accreditation',
    );

    expect(q.body).toBe('ISO 17025, Janoshik.');
    expect(q.superseded?.map((s) => s.body)).toEqual(['First answer.']);
  });

  it('does not depend on the order the rows arrive in', () => {
    const rows = [
      answered('coa-lab-accreditation', 'ISO 17025, Janoshik.', '2026-08-26T11:00:00.000Z'),
      answered('coa-lab-accreditation', 'First answer.', '2026-08-26T10:00:00.000Z'),
    ];
    expect(find(resolveAttestations(ruleset.attestations, rows), 'coa-lab-accreditation').body).toBe(
      'ISO 17025, Janoshik.',
    );
  });

  it('counts a revised question once', () => {
    const result = resolveAttestations(ruleset.attestations, [
      answered('coa-lab-accreditation', 'a', '2026-08-26T10:00:00.000Z'),
      answered('coa-lab-accreditation', 'b', '2026-08-26T11:00:00.000Z'),
    ]);
    expect(result.counts.answered).toBe(1);
    expect(result.counts.answered + result.counts.unanswered).toBe(result.counts.total);
  });

  it('lets a merchant withdraw an answer, and keeps what they withdrew', () => {
    /*
      The newest row wins and it carries no answer, so the question reads as not answered — but the
      earlier answer is still in `superseded`, because the table is append-only and a reader who was
      sent the first version is entitled to see that it changed (D-002).
    */
    const q = find(
      resolveAttestations(ruleset.attestations, [
        answered('ban-list', 'Yes, we keep one.', '2026-08-26T10:00:00.000Z'),
        declined('ban-list', '2026-08-26T12:00:00.000Z'),
      ]),
      'ban-list',
    );
    expect(q.outcome).toBe('unanswered');
    expect(q.body).toBeUndefined();
    expect(q.superseded?.[0]?.body).toBe('Yes, we keep one.');
  });
});

describe('an answer to a retired question', () => {
  /**
   * The row stays in the table — it is append-only — but it has no question to sit under, and
   * rendering it headless would be worse than leaving it in the database.
   */
  it('is dropped rather than rendered without its question', () => {
    const result = resolveAttestations(ruleset.attestations, [answered('a-question-we-retired', 'Yes.')]);
    expect(result.questions.map((q) => q.questionId)).not.toContain('a-question-we-retired');
    expect(result.counts.total).toBe(ruleset.attestations.length);
  });
});

describe('the questions as data', () => {
  it('asks what the merchant does rather than whether they comply (D-067)', () => {
    for (const question of ruleset.attestations) {
      expect(question.question.toLowerCase()).not.toContain('comply');
      expect(question.question.toLowerCase()).not.toContain('compliant');
      expect(question.question.toLowerCase()).not.toContain('in compliance');
    }
  });

  /**
   * A question id that looked like a rule id would invite a reader to take an answer for a check
   * result, and the database column enforces the same split. Checked here too so the rule set
   * cannot be edited into a shape the migration would then refuse.
   */
  it('uses slugs that cannot be mistaken for rule ids', () => {
    for (const question of ruleset.attestations) {
      expect(question.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(question.id).not.toMatch(/^[A-Z]+-\d{3}$/);
    }
  });

  it('covers all nineteen of Table 2, plus the one that moved here from a rule', () => {
    // Nineteen from Table 2 (D-134); the twentieth is PAY-002, asked rather than crawled (D-226).
    expect(ruleset.attestations).toHaveLength(20);
    expect(new Set(ruleset.attestations.map((a) => a.id)).size).toBe(20);
  });
});
