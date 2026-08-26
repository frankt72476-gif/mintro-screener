/**
 * The attestation section as an underwriter reads it (D-134).
 *
 * Two requirements shape every assertion here.
 *
 * **Nothing in the section may read as an observation.** These are the merchant's statements about
 * things no crawl can see. The heading says so, the section sits outside the findings, and it
 * shares no class with `.find`. If any of those three slips, a reader can carry a statement
 * forward as though Mintro had confirmed it.
 *
 * **An unanswered question must say what it means.** Every question here exists because no rule
 * can answer it, and five of the nineteen have no rule of any kind behind them. So an unanswered
 * one means the requirement has no coverage in this document from any source. A blank cell beside
 * filled-in rows reads as *nothing to report*, which is the opposite. That is the difference
 * between a gap and a silence, and it is the thing this file exists to hold in place.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { parseRuleset } from '@mintro/ruleset';
import { resolveAttestations, type StoredAttestation } from '@mintro/engine';
import { AttestationSection, NotCheckedSection } from '../src/components/Attestations.js';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));
const QUESTIONS = RULESET.attestations;

const render = (stored: readonly StoredAttestation[] = []): string =>
  renderToStaticMarkup(
    createElement(AttestationSection, { attestations: resolveAttestations(QUESTIONS, stored) }),
  );

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

const answered = (questionId: string, body: string): StoredAttestation => ({
  questionId,
  outcome: 'answered',
  body,
  identifiedAs: 'ops@shop.example',
  submittedAt: '2026-08-26T10:00:00.000Z',
});

const declined = (questionId: string): StoredAttestation => ({
  questionId,
  outcome: 'declined',
  identifiedAs: 'ops@shop.example',
  submittedAt: '2026-08-26T10:00:00.000Z',
});

describe('the section says whose words these are', () => {
  it('is headed as stated by the merchant', () => {
    expect(text(render())).toContain('Stated by the merchant');
  });

  it('says plainly that Mintro observed none of it', () => {
    expect(text(render())).toContain('Nothing in this section was observed or verified by Mintro');
  });

  /**
   * The boundary is the heading and the separation, and this is the separation half. A row that
   * carried `find`, a state chip or a rule id would look like a finding whatever the heading said.
   */
  it('shares no class or furniture with an observed finding', () => {
    const markup = render([answered('ban-list', 'Yes.')]);
    expect(markup).not.toMatch(/class="[^"]*\bfind\b/);
    expect(markup).not.toMatch(/class="[^"]*\bstate\b/);
    expect(markup).not.toMatch(/class="[^"]*\bpip\b/);
    expect(markup).not.toMatch(/class="[^"]*\bslip\b/);
  });

  it('shows no rule id anywhere', () => {
    const markup = render([answered('ban-list', 'Yes.'), declined('prior-termination')]);
    expect(markup).not.toMatch(/[A-Z]{3,4}-\d{3}/);
  });

  /**
   * No pass, no fail, no review. The four states belong to observations, and borrowing one here
   * would say a statement had been assessed.
   */
  it('uses none of the four finding states', () => {
    const rendered = text(render([answered('ban-list', 'Yes.')])).toLowerCase();
    for (const state of ['pass', 'fail', 'review', 'not evaluable']) {
      expect(rendered).not.toContain(state);
    }
  });
});

describe('every question appears', () => {
  it('renders all nineteen even when nothing was answered', () => {
    const rendered = text(render());
    for (const question of QUESTIONS) {
      expect(rendered).toContain(question.question);
    }
  });

  it('states the authority and severity of each requirement', () => {
    const rendered = text(render());
    expect(rendered).toContain('Card network');
    expect(rendered).toContain('Programme');
    expect(rendered).toContain('Law');
  });
});

describe('an unanswered question is a gap, not a blank', () => {
  /**
   * The defect being guarded, in one assertion: an unanswered row rendering as an empty space.
   * It must carry both halves — Mintro could not observe it, *and* nobody stated it. Either alone
   * misleads: the first sounds like a tool limitation with the merchant off the hook, the second
   * like the merchant ignored something Mintro had otherwise covered.
   */
  it('says it was not observable by Mintro and not answered', () => {
    const rendered = text(render());
    expect(rendered).toContain('Not observable by Mintro, and not answered');
    expect(rendered).toContain('Nothing in this report speaks to this requirement');
  });

  it('says it once per unanswered question, not once for the section', () => {
    const markup = render([answered('ban-list', 'Yes.')]);
    const occurrences = markup.split('Not observable by Mintro').length - 1;
    expect(occurrences).toBe(QUESTIONS.length - 1);
  });

  it('is marked as not answered rather than left unlabelled', () => {
    expect(text(render())).toContain('Not answered');
  });

  /**
   * `prior-termination` is one of the five Table 2 rows with no rule of any kind behind it. An
   * unanswered row there is the case Frank named: no check, no statement, no coverage.
   */
  it('reads the same for a question no rule stands behind', () => {
    const rendered = text(render([answered('ban-list', 'Yes.')]));
    expect(rendered).toContain('Has any acquirer, processor or platform terminated you?');
    expect(rendered).toContain('Not observable by Mintro, and not answered');
  });
});

describe('a declination is reported as one', () => {
  it('says the merchant declined, and does not render it as unanswered', () => {
    const rendered = text(render([declined('shipping-to-clinics')]));
    expect(rendered).toContain('The merchant declined to answer this question');
    expect(rendered).toContain('Declined to answer');
  });

  /**
   * A refusal is informative and the report carries it without characterising it. No "which may
   * indicate", no adverse framing — the reader draws the conclusion (D-001).
   */
  it('draws no conclusion from the refusal', () => {
    const rendered = text(render([declined('shipping-to-clinics')])).toLowerCase();
    for (const word of ['should', 'recommend', 'suggests', 'concerning', 'red flag', 'refusal to']) {
      expect(rendered).not.toContain(word);
    }
  });

  it('distinguishes declining from never answering, in the counts', () => {
    const rendered = text(render([declined('shipping-to-clinics'), answered('ban-list', 'Yes.')]));
    expect(rendered).toContain(`1 answered · 1 declined · ${QUESTIONS.length - 2} not answered`);
  });
});

describe('an answer', () => {
  it('is quoted verbatim', () => {
    expect(text(render([answered('adult-signature', 'Yes — UPS adult signature, 21+.')]))).toContain(
      'Yes — UPS adult signature, 21+.',
    );
  });

  /**
   * "Identified themselves as", never "from". The address is self-declared and Mintro verifies
   * nothing about it — the same wording commentary is held to (D-063).
   */
  it('attributes it to a self-declared address, and says the address is self-declared', () => {
    const rendered = text(render([answered('adult-signature', 'Yes.')]));
    expect(rendered).toContain('identified themselves as ops@shop.example');
  });

  it('shows an earlier answer alongside the one that replaced it', () => {
    const rendered = text(
      render([
        { ...answered('coa-lab-accreditation', 'First answer.'), submittedAt: '2026-08-26T10:00:00.000Z' },
        { ...answered('coa-lab-accreditation', 'ISO 17025.'), submittedAt: '2026-08-26T11:00:00.000Z' },
      ]),
    );
    expect(rendered).toContain('ISO 17025.');
    expect(rendered).toContain('1 earlier answer');
  });
});

describe('what was not checked', () => {
  const notChecked = () =>
    text(renderToStaticMarkup(createElement(NotCheckedSection, { items: RULESET.not_checked })));

  /**
   * The programme's own guidelines make this one necessary: social media is where they say FDA is
   * actively looking, and a crawl finds the links without following them. Rendered verbatim from
   * the rule set, because a paraphrase is where a boundary softens (D-018, D-076).
   */
  it('states that Mintro does not follow or read social media accounts', () => {
    const rendered = notChecked();
    expect(rendered).toContain('does not follow or read the social media accounts');
    expect(rendered).toContain('FDA is');
  });

  it('renders every item in the rule set, verbatim', () => {
    const rendered = notChecked();
    for (const item of RULESET.not_checked) {
      expect(rendered).toContain(item.subject);
      expect(rendered).toContain(item.why);
    }
  });
});
