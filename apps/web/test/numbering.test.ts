/**
 * One continuous 1..N over everything a person can point at (D-248).
 *
 * ## Why this test is the guarantee and not a formality
 *
 * The numbers are allocated on first sight during render rather than by a function that walks the
 * report. That is deliberate — the page's order is assembled by `ReportView`'s JSX out of four
 * different structures, and a function mirroring that walk would be a second copy of it free to
 * drift (D-216, applied to sequence). The cost of that choice is that nothing *declares* the
 * sequence, so it has to be read back out of the rendered document, which is what happens here.
 *
 * Every assertion below is on markup. If the render order changes, these fail; if a row stops being
 * numbered, these fail; if two rows share a number, these fail.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { ReportView } from '../src/components/ReportView.js';
import { AttestationForm } from '../src/components/Attestations.js';
import { createNumbering, eyeLineOrdinal } from '../src/lib/numbering.js';
import type { ScreeningReport } from '@mintro/engine';

const REPORTS = readdirSync('fixtures/reports')
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(`fixtures/reports/${f}`, 'utf8')) as ScreeningReport] as const);

const access = { description: 'none needed for markup', urlFor: async () => null };

/** A rubric with every verdict kind, so the eye-test lines are really rendered. */
const EYE_TEST = {
  kind: 'recorded',
  outcome: {
  kind: 'read',
  test: {
  rubricVersion: '1.0.0',
  model: 'test-model',
  read: 'The storefront reads as a shop.',
  verdicts: [
    { id: 'EYE-01', verdict: 'concern', question: 'Does it read as a shop?', saw: 'A fire sale banner.' },
    { id: 'EYE-02', verdict: 'clear', question: 'Is the research framing present?' },
    { id: 'EYE-03', verdict: 'cannot_tell', question: 'Are the photographs of bodies?' },
  ],
  },
  },
} as never;

/** How many rubric lines the fixture renders. */
const EYE_LINES = 3;

/** What `AttestationForm` takes: the questions themselves. */
const ATTESTATION_QUESTIONS = [
  // `id`, not `questionId`: `AttestationForm` reads `question.id` where the resolved read-only row
  // reads `question.questionId`. A fixture using the wrong one gives every row the same key, which
  // is how the first version of this made both questions number 6.
  { id: 'OPS-01', question: 'Who fulfils orders?', prompt: 'Who fulfils orders?' },
  { id: 'OPS-02', question: 'Where is stock held?', prompt: 'Where is stock held?' },
] as never;

/** Two operational questions, so the fourth structure on the page really renders rows. */
const ATTESTATIONS = {
  asking: 'asked',
  questions: [
    { questionId: 'OPS-01', question: 'Who fulfils orders?', outcome: 'unanswered', prompt: 'Who fulfils orders?' },
    { questionId: 'OPS-02', question: 'Where is stock held?', outcome: 'unanswered', prompt: 'Where is stock held?' },
  ],
  counts: { answered: 0, unanswered: 2, declined: 0, inherited: 0 },
} as never;

const render = (report: ScreeningReport, extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report,
      access,
      surface: 'agent',
      commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      ...extra,
    } as never),
  );

/** Every `.ref-n` chip, in document order. */
const numbersIn = (markup: string): number[] =>
  [...markup.matchAll(/<span class="ref-n[^"]*">(\d+)<\/span>/g)].map((m) => Number(m[1]));

describe('the sequence, on rendered output', () => {
  it.each(REPORTS)('%s: reads 1..N top to bottom, no gaps, no repeats', (_name, report) => {
    const numbers = numbersIn(render(report, { eyeTest: EYE_TEST }));

    // Not a vacuous pass: a report with no numbered rows would satisfy every check below.
    expect(numbers.length).toBeGreaterThan(3);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('is continuous ACROSS findings and eye-test lines, with no restart', () => {
    /*
      The property the whole design turns on. The eye test renders between the not-met section and
      the review section, so its lines take numbers out of the middle of the pool — a separate
      sequence, or a restart at the panel, would show up here as a repeat.
    */
    const [, report] = REPORTS[0]!;
    const withEye = numbersIn(render(report, { eyeTest: EYE_TEST }));
    const withoutEye = numbersIn(render(report));

    expect(withEye.length).toBe(withoutEye.length + EYE_LINES);
    expect(withEye).toEqual(Array.from({ length: withEye.length }, (_, i) => i + 1));
  });

  it('numbers the eye-test lines from the same pool, not from 1', () => {
    const [, report] = REPORTS[0]!;
    const markup = render(report, { eyeTest: EYE_TEST });

    // The chips inside the eye list carry `eye-n`; they must not start over.
    const eyeNumbers = [...markup.matchAll(/<span class="ref-n eye-n">(\d+)<\/span>/g)].map((m) =>
      Number(m[1]),
    );
    expect(eyeNumbers).toHaveLength(EYE_LINES);
    expect(Math.min(...eyeNumbers)).toBeGreaterThan(1);
    // Consecutive among themselves, because the lines render one after another.
    expect(eyeNumbers).toEqual(
      Array.from({ length: eyeNumbers.length }, (_, i) => eyeNumbers[0]! + i),
    );
  });

  it('gives the same finding the same number on a second render', () => {
    // Per report and stable within it: a row that opens and closes, or a re-render, must not
    // renumber the document under the reader.
    const [, report] = REPORTS[0]!;
    expect(numbersIn(render(report, { eyeTest: EYE_TEST }))).toEqual(
      numbersIn(render(report, { eyeTest: EYE_TEST })),
    );
  });
});

describe('the number sits beside the code, not instead of it', () => {
  it('renders both on a finding row', () => {
    /*
      The objection the earlier ruling raised, and the answer to it: two labels for one line rather
      than two identities. The chip is what a person says; the mono tag is what a stored comment
      keys on. Removing either brings the objection back.
    */
    const [, report] = REPORTS[0]!;
    const markup = render(report);
    expect(markup).toMatch(/<span class="ref-n">\d+<\/span>/);
    expect(markup).toMatch(/[A-Z]+-\d{3}/);
  });
});

/**
 * The guard for the class, not the instance (D-250).
 *
 * A section has now fallen out of the sequence twice — the eye test, then the operational questions
 * — and both times nothing failed. An unnumbered section is indistinguishable from a section that
 * was never meant to be numbered, so the only thing that can catch it is a count taken from the
 * rendered document and compared against the rows that should carry a number.
 *
 * `ROW_SELECTORS` is the list that has to grow when a section is added. It is not self-maintaining
 * and cannot be: nothing in the markup says "this is a referenceable line". What makes forgetting
 * loud is the section count below — add a sixth section and that assertion fails, which sends
 * whoever added it to this file.
 */
const ROW_SELECTORS = {
  finding: /<div class="find [^"]*"/g,
  eyeLine: /<li key[^>]*data-verdict=|<li data-verdict=/g,
  // Both shapes: `att-row att-{outcome}` from the section, `att-row att-field` from the form.
  attestation: /<li class="att-row /g,
} as const;

describe('every section is in the sequence (D-250)', () => {
  /*
    Rendered WITH the per-line boxes, because that is what a reader gets (D-251).

    The first version of this guard rendered without `eyeLineCommentBox`, so the eye-test panel had
    no response boxes in it — and when those boxes each painted a second chip for a line that already
    had one, the count still matched and this test still passed. It was checking a render shape no
    surface produces: the merchant page and the analyst report both pass a box builder.

    A guard that renders less than production is a guard with a hole exactly the size of what it
    left out. Both callers are represented here now.
  */
  const markup = (): string =>
    render(REPORTS[0]![1], {
      eyeTest: EYE_TEST,
      attestations: ATTESTATIONS,
      /*
        The operational questions as PRODUCTION renders them (D-252).

        `ReportView` reads `questionsForm ?? <AttestationSection …>`, and **both real surfaces pass a
        form** — `App.tsx` for the analyst report and `CommentPane.tsx` for the merchant page. Only
        the print route falls through to the section.

        This guard passed `attestations` and no form, so it rendered the section — the one shape that
        was numbered, and the one shape a person never sees. Same hole as the missing
        `eyeLineCommentBox` one commit earlier: a prop every real caller supplies, omitted here.
      */
      questionsForm: createElement(AttestationForm, {
        questions: ATTESTATION_QUESTIONS,
        answers: new Map(),
        identified: true,
        onAnswer: async () => null,
      } as never),
      eyeLineCommentBox: (line: { rubricId: string; ordinal: number }) =>
        createElement(
          'div',
          { className: 'respond', 'data-line': line.rubricId },
          createElement('span', { className: 'respond-label' }, 'Record the merchant’s plan for this'),
          createElement('textarea', { className: 'input respond-t' }),
        ),
      commentBox: (_f: unknown, _o?: number, reference?: string) =>
        createElement(
          'div',
          { className: 'respond' },
          createElement('span', { className: 'respond-label' }, `Respond to ${reference ?? ''}`),
          createElement('textarea', { className: 'input respond-t' }),
        ),
    });

  it('renders all five sections, so a sixth cannot arrive unnoticed', () => {
    /*
      The trip-wire. This number is not interesting in itself — what it does is fail when the report
      grows a section, so the person who added it reads the file that explains why numbering is not
      automatic.
    */
    const m = markup();
    const sections = [
      /class="panel stop-panel/.test(m),
      /data-section="notmet"/.test(m),
      /class="panel eye-panel"/.test(m),
      /data-section="questions"/.test(m),
      /data-section="review"/.test(m),
    ];
    expect(sections.filter(Boolean)).toHaveLength(5);
  });

  it('paints each number exactly once, even where a row carries a response box', () => {
    /*
      The bug this is written for. An eye-test line and its box each drew from the sequence with the
      same key, so the number was right and was painted twice — 68 chips over 66 numbers, with 6 and
      7 doubled. Not an inflated sequence; a repeated one, which reads as two things to point at.
    */
    const numbers = numbersIn(markup());
    expect(new Set(numbers).size, 'a number is painted more than once').toBe(numbers.length);
  });

  it('gives every referenceable row exactly one chip', () => {
    const m = markup();
    const chips = numbersIn(m).length;
    const rows = Object.values(ROW_SELECTORS).reduce(
      (total, pattern) => total + [...m.matchAll(pattern)].length,
      0,
    );

    // Not vacuous: all three kinds must actually be present in this render.
    for (const [kind, pattern] of Object.entries(ROW_SELECTORS)) {
      expect([...m.matchAll(pattern)].length, `no ${kind} rows rendered`).toBeGreaterThan(0);
    }
    expect(chips, 'a referenceable row rendered without a number').toBe(rows);
  });

  it('numbers the operational questions, continuing the pool', () => {
    const m = markup();
    const attNumbers = [...m.matchAll(/<span class="ref-n att-n">(\d+)<\/span>/g)].map((x) => Number(x[1]));
    expect(attNumbers.length).toBeGreaterThan(0);
    // After the eye test, which is after the findings — no restart anywhere.
    const eyeNumbers = [...m.matchAll(/<span class="ref-n eye-n">(\d+)<\/span>/g)].map((x) => Number(x[1]));
    expect(Math.min(...attNumbers)).toBeGreaterThan(Math.max(...eyeNumbers));
    expect(numbersIn(m)).toEqual(Array.from({ length: numbersIn(m).length }, (_, i) => i + 1));
  });
});

describe('a response box on every eye-test line (D-249)', () => {
  const withBoxes = (): string =>
    render(REPORTS[0]![1], {
      eyeTest: EYE_TEST,
      eyeLineCommentBox: (line: { rubricId: string; ordinal: number; number: number }) =>
        createElement(
          'div',
          { className: 'respond', 'data-line': line.rubricId, 'data-ordinal': line.ordinal },
          createElement('span', { className: 'ref-n' }, String(line.number)),
          createElement('span', { className: 'respond-label' }, 'Your plan for this'),
          createElement('textarea', { className: 'input respond-t' }),
        ),
    });

  it('gives every line its own box, keyed to that line', () => {
    const markup = withBoxes();
    for (const line of ['EYE-01', 'EYE-02', 'EYE-03']) {
      expect(markup, `${line} has no box`).toContain(`data-line="${line}"`);
    }
    // The stored key is the rubric id's number, not the display number.
    expect(markup).toContain('data-ordinal="1"');
    expect(markup).toContain('data-ordinal="3"');
  });

  it('gives a CLEAR line one too, because the box is optional and the reader decides', () => {
    // D-067: every box is optional, always. A line a merchant has nothing to add to costs them
    // nothing; a line they DO want to answer and cannot is the failure worth avoiding.
    const markup = withBoxes();
    const clearLine = /data-verdict="clear"[\s\S]*?<\/li>/.exec(markup)?.[0] ?? '';
    expect(clearLine).toContain('respond');
  });

  it('keeps the boxes inside the eye-test panel, not in a findings section', () => {
    /*
      The D-196 line that survives the revision. A per-line box does not promote a verdict to a
      finding — what keeps it an impression is that it renders here, under this band, beside the
      verdict word, and is counted by nothing.
    */
    const markup = withBoxes();
    const panel = /<section class="panel eye-panel">[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
    expect(panel).toContain('data-line="EYE-01"');
    expect(panel).toContain('eye-list');
    // And the verdict vocabulary is untouched.
    for (const word of ['concern', 'clear', 'cannot tell']) {
      expect(panel).toContain(word);
    }
  });

  it('renders no box where the caller supplies none, which is the print path', () => {
    const markup = render(REPORTS[0]![1], { eyeTest: EYE_TEST });
    expect(markup).not.toContain('data-line=');
  });

  it('leaks no operator identity (D-233)', () => {
    expect(withBoxes()).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe('createNumbering', () => {
  it('allocates in call order and is idempotent', () => {
    const n = createNumbering();
    const a = {} as never;
    const b = {} as never;
    expect(n.forFinding(a)).toBe(1);
    expect(n.forEyeLine('EYE-01')).toBe(2);
    expect(n.forFinding(b)).toBe(3);
    // Asked again, the same answers — a re-render must not renumber.
    expect(n.forFinding(a)).toBe(1);
    expect(n.forEyeLine('EYE-01')).toBe(2);
    expect(n.count).toBe(3);
  });

  it('keeps findings and eye lines in one pool', () => {
    const n = createNumbering();
    n.forFinding({} as never);
    // Not 1: the eye line continues the sequence rather than starting its own.
    expect(n.forEyeLine('EYE-04')).toBe(2);
  });
});

describe('eyeLineOrdinal — the stored key', () => {
  it('is the rubric id’s own number, not the display number', () => {
    // Stable across runs where the display number moves with the report's contents, which is why
    // a reply written against EYE-07 reads back against EYE-07 on the next screening.
    expect(eyeLineOrdinal('EYE-07')).toBe(7);
    expect(eyeLineOrdinal('EYE-14')).toBe(14);
  });

  it('throws on an id it cannot parse rather than collapsing every line onto one key', () => {
    // Silently returning 0 would file every merchant's plan under the same impression.
    expect(() => eyeLineOrdinal('EYE')).toThrow(/has no stored ordinal/);
    expect(() => eyeLineOrdinal('GATE-002')).toThrow(/has no stored ordinal/);
  });

  it('cannot collide with a rule comment’s key', () => {
    /*
      Not because the numbers differ — EYE-07 and a rule's ordinal 7 are both `7` — but because the
      rows sit on different axes. `merchant_comment_is_about_one_thing` (0050) makes `rule_id` and
      `subject` mutually exclusive, so a line reply has `subject='eye-test'` and no rule id, and a
      finding reply has a rule id and no subject. The ordinal only ever discriminates within one.
    */
    const migration = readFileSync('supabase/migrations/0050_eye_test_comment.sql', 'utf8');
    expect(migration).toContain('check ((rule_id is null) <> (subject is null))');
    // And the write path carries the ordinal for subject rows, which is what makes this need no
    // migration of its own.
    expect(migration).toContain('and ordinal is not distinct from p_ordinal');
    expect(migration).toMatch(/insert into public\.merchant_comments[\s\S]*ordinal[\s\S]*subject/);
  });
});
