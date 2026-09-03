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
import { resolveAttestations, STATE_LABEL, type StoredAttestation } from '@mintro/engine';
import { AttestationSection, NotCheckedSection } from '../src/components/Attestations.js';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));
const QUESTIONS = RULESET.attestations;

/*
  Every assertion in this file is about a run where the questions were actually put (D-199).

  The section now varies on that: where no comment link was transmitted it may not claim the
  questions were asked, and where the commentary read failed it may not claim either way. Those
  three renderings are held apart in `attestationAsking.test.ts`. This file is the asked case, and
  it says so rather than relying on a default.
*/
const render = (stored: readonly StoredAttestation[] = [], invited = true): string =>
  renderToStaticMarkup(
    createElement(AttestationSection, {
      attestations: resolveAttestations(QUESTIONS, stored),
      invited,
    }),
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
    /*
      Read from the shared label set (D-175).

      This listed `pass / fail / review / not evaluable` — the words the report used *then*. After
      the relabelling it would have gone on guarding vocabulary nothing renders, passing because it
      was looking for the wrong thing rather than because the boundary held.

      Word boundaries, because "met" is a substring of ordinary English and a bare `toContain` would
      fail on a question that happened to use it.
    */
    const rendered = text(render([answered('ban-list', 'Yes.')]));
    for (const label of Object.values(STATE_LABEL)) {
      expect(rendered, label).not.toMatch(new RegExp(`\b${label}\b`, 'i'));
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
    // "Standards", not "Programme" (D-141). The `programme` key stays — it is a rule-set identifier,
    // and D-060's logic is that an identifier is not something an underwriter reads. The label is.
    expect(rendered).toContain('Standards');
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
    // Both halves, still. Either alone misleads, and that has not changed.
    expect(rendered).toContain('not observable by Mintro and was not stated by the merchant');
    expect(rendered).toContain('nothing in this report speaks to it');
  });

  /*
    Reversed by D-167, and the guarantee it was protecting is kept.

    This asserted the sentence once per unanswered question — on the reference runs, nineteen
    identical paragraphs in one section. The defect it guards against is an unanswered row
    rendering as an empty space, and that is still guarded below: the row keeps its mark, its
    question and its authority. What moved is the *meaning*, which a reader learns once and then
    read eighteen more times, which is what teaches someone to skip a section.
  */
  it('states the meaning once for the section, not once per question', () => {
    const markup = render([answered('ban-list', 'Yes.')]);
    const occurrences = markup.split('not observable by Mintro').length - 1;
    expect(occurrences).toBe(1);
  });

  it('still never renders an unanswered row as a blank', () => {
    const rendered = text(render([answered('ban-list', 'Yes.')]));
    // The row carries its mark and its question; only the repeated paragraph is gone.
    expect(rendered).toContain('Not answered');
    expect(rendered).toContain('Has any acquirer, processor or platform terminated you?');
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
    // Marked identically to every other unanswered question: no check, no statement, no coverage.
    expect(rendered).toContain('Not answered');
  });
});

describe('a row with no answer reads as not answered (D-253)', () => {
  it('says nothing about why the box is empty', () => {
    /*
      The reverse of what this asserted. It required *"The merchant declined to answer this
      question"* and that the row not render as unanswered. The ruling that replaced it: a blank has
      too many real shades to be split without claiming to know which one it is.
    */
    const rendered = text(render([declined('shipping-to-clinics')]));
    expect(rendered).not.toContain('declined');
    expect(rendered).not.toContain('chose not to');
    // And it reads as the one thing it is.
    expect(rendered).toContain('Not answered');
  });

  /**
   * Unchanged in substance: the report states what it has and draws no conclusion from it (D-001).
   * It now has less — a blank rather than a refusal — and characterises that no further.
   */
  it('draws no conclusion from the blank', () => {
    const rendered = text(render([declined('shipping-to-clinics')])).toLowerCase();
    for (const word of ['should', 'recommend', 'suggests', 'concerning', 'red flag', 'refusal to']) {
      expect(rendered).not.toContain(word);
    }
  });

  it('counts it among the unanswered, with no third figure', () => {
    const rendered = text(render([declined('shipping-to-clinics'), answered('ban-list', 'Yes.')]));
    expect(rendered).toContain(`1 answered · ${QUESTIONS.length - 1} not answered`);
    expect(rendered).not.toContain('declined');
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
   * The published standards make this one necessary: off-site marketing is the area they treat as
   * highest risk and the one FDA is named over, and a crawl finds the links without following them.
   * Rendered verbatim from the rule set, because a paraphrase is where a boundary softens (D-018).
   *
   * **The guard is that the statement names FDA, not that it uses any particular sentence.** It used
   * to assert `'FDA is'`, which is a fragment of the old combined guidelines' phrasing — *"where FDA
   * is actively looking"* — and that wording is deliberately not carried into the re-based corpus. An
   * assertion on the phrasing would either force the old sentence back or be deleted as stale on the
   * next rewording; an assertion on the name survives both, and the name is what the boundary is for.
   * Who a reader is told is looking at the surface Mintro does not examine is the whole point of
   * declaring it.
   */
  it('states that Mintro does not follow or read social media accounts', () => {
    const rendered = notChecked();
    expect(rendered).toContain('does not follow or read the social media accounts');
    expect(rendered, 'the boundary must still name FDA').toContain('FDA');
  });

  it('renders every item in the rule set, verbatim', () => {
    const rendered = notChecked();
    for (const item of RULESET.not_checked) {
      expect(rendered).toContain(item.subject);
      expect(rendered).toContain(item.why);
    }
  });
});
