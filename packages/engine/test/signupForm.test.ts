/**
 * The sign-up form checks (D-048).
 *
 * GATE-004 and GATE-005 are both `expect: present`, which is the dangerous direction for hard
 * constraint 9: **failing to locate the subject reads as "missing"**, and produces either a false
 * failure or a review queue full of merchants who complied in wording nobody anticipated.
 *
 * The tests that matter most here are the ones using deliberately unanticipated wording. A check
 * that passes only the well-worded fixtures is the check this project keeps having to rewrite.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '@mintro/ruleset';
import {
  checkSignupAcknowledgement,
  checkSignupResearchField,
  isAccountField,
  additionalFields,
  NO_SIGNUP_FORM,
  type FormField,
  type SignupForm,
} from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');
const rule = (id: string): RuleOfType<'dom_assert'> => {
  const found = ruleset.rules.find((r: Rule) => r.id === id);
  if (found === undefined || found.type !== 'dom_assert') throw new Error(`no dom_assert rule ${id}`);
  return found;
};

const GATE_004 = rule('GATE-004');
const GATE_005 = rule('GATE-005');

function field(partial: Partial<FormField> & { type: string }): FormField {
  return {
    name: '',
    required: false,
    label: '',
    autocomplete: '',
    options: [],
    selector: 'form > input',
    ...partial,
  };
}

function form(fields: readonly FormField[], overrides: Partial<SignupForm> = {}): SignupForm {
  return {
    found: true,
    locatedBy: 'form containing a password input',
    url: 'https://shop.example/account/register',
    fields,
    candidateForms: 1,
    ...overrides,
  };
}

/** The fields every account form has, and which say nothing about research status. */
const ACCOUNT_FIELDS: readonly FormField[] = [
  field({ type: 'email', name: 'customer[email]', label: 'Email', autocomplete: 'email', required: true }),
  field({ type: 'password', name: 'customer[password]', label: 'Password', autocomplete: 'new-password', required: true }),
  field({ type: 'text', name: 'customer[first_name]', label: 'First name', autocomplete: 'given-name' }),
  field({ type: 'text', name: 'customer[last_name]', label: 'Last name', autocomplete: 'family-name' }),
];

describe('a form that was never located', () => {
  it('is not_evaluable for both rules, never "no checkbox present"', () => {
    for (const [id, check] of [
      ['GATE-004', () => checkSignupAcknowledgement(GATE_004, NO_SIGNUP_FORM)],
      ['GATE-005', () => checkSignupResearchField(GATE_005, NO_SIGNUP_FORM)],
    ] as const) {
      const finding = check();
      expect(finding.state, id).toBe('not_evaluable');
      // The check ran; the site did not present a form the crawl reached. That is a fact about
      // the merchant, not a gap in Mintro (D-044).
      expect(finding.notEvaluableKind, id).toBe('not_exposed');
    }
  });
});

describe('GATE-004 — the acknowledgement checkbox', () => {
  it('passes when a required checkbox names an agreement document', () => {
    const finding = checkSignupAcknowledgement(
      GATE_004,
      form([
        ...ACCOUNT_FIELDS,
        field({ type: 'checkbox', name: 'agree', label: 'I Agree to the Terms and Conditions', required: true }),
      ]),
    );

    expect(finding.state).toBe('pass');
    // It read the wording; it did not open the document. The finding says so (D-018).
    expect(finding.note).toContain('the document it links to was not followed');
  });

  /**
   * The constraint-9 case, and the reason this check enumerates checkboxes structurally.
   *
   * A merchant whose required checkbox reads "I confirm I have read the conditions of sale" is
   * found, quoted, and sent to a person. A check that located the checkbox by matching "I Agree"
   * would have reported this merchant as having no acknowledgement at all.
   */
  it('finds a required checkbox worded in a way nobody anticipated', () => {
    const finding = checkSignupAcknowledgement(
      GATE_004,
      form([
        ...ACCOUNT_FIELDS,
        field({
          type: 'checkbox',
          name: 'confirm_research',
          label: 'I confirm these materials are for laboratory use and I accept the conditions of sale',
          required: true,
        }),
      ]),
    );

    // 'conditions' is in the agreement vocabulary, so this one passes — but the point is that it
    // was *located* without matching the rule's near_text at all.
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('laboratory use');
  });

  it('sends a required checkbox with unrecognisable wording to review, quoting it', () => {
    const finding = checkSignupAcknowledgement(
      GATE_004,
      form([
        ...ACCOUNT_FIELDS,
        field({ type: 'checkbox', name: 'ack', label: 'I am a qualified buyer', required: true }),
      ]),
    );

    expect(finding.state).toBe('review');
    // Never reported as absent. It exists, it is required, and its wording is a human's call.
    expect(finding.note).toContain('I am a qualified buyer');
    expect(finding.note).toContain('judgment about its wording');
  });

  it('reports a checkbox that is present but optional, which is the thing the clause forbids', () => {
    const finding = checkSignupAcknowledgement(
      GATE_004,
      form([
        ...ACCOUNT_FIELDS,
        field({ type: 'checkbox', name: 'agree', label: 'I agree to the Terms', required: false }),
      ]),
    );

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('none of them required');
  });

  it('says the form was read when it carried no checkbox at all', () => {
    const finding = checkSignupAcknowledgement(GATE_004, form(ACCOUNT_FIELDS));

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('carried no checkbox');
    // D-018: the finding is worded to the surface actually examined, and names what was on it.
    expect(finding.note).toContain('4 field(s) were observed');
    expect(finding.note).toContain('shop.example/account/register');
  });
});

describe('GATE-005 — research status, asked for as a requirement', () => {
  /**
   * It never passes, and that is the finding.
   *
   * Whether a field *asks about research status* cannot be established without reading its label,
   * and a check that read labels would miss every merchant who worded it differently. So it
   * reports what the form contains and a person decides — the posture D-020 set for OFFS-006.
   */
  it('never returns pass, whatever the form contains', () => {
    const forms = [
      form([...ACCOUNT_FIELDS, field({ type: 'select', name: 'research_status', label: 'Research status', required: true, options: ['Academic', 'Industry'] })]),
      form([...ACCOUNT_FIELDS, field({ type: 'text', name: 'intended_use', label: 'Intended use', required: true })]),
      form(ACCOUNT_FIELDS),
    ];

    for (const candidate of forms) {
      expect(checkSignupResearchField(GATE_005, candidate).state).not.toBe('pass');
    }
  });

  it('names a required field beyond the account set as the candidate', () => {
    const finding = checkSignupResearchField(
      GATE_005,
      form([
        ...ACCOUNT_FIELDS,
        field({
          type: 'select',
          name: 'buyer_category',
          label: 'Which best describes you?',
          required: true,
          options: ['Academic researcher', 'Industry', 'Other'],
        }),
      ]),
    );

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('Which best describes you?');
    expect(finding.note).toContain('Academic researcher');
    expect(finding.note).toContain('1 required field(s) beyond');
  });

  it('says so when the field exists but is optional — the clause names that exact case', () => {
    const finding = checkSignupResearchField(
      GATE_005,
      form([
        ...ACCOUNT_FIELDS,
        field({ type: 'select', name: 'buyer_category', label: 'Research area', options: ['A', 'B'] }),
      ]),
    );

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('none of them is required');
  });

  it('notes free text where the rule prefers a fixed choice', () => {
    const finding = checkSignupResearchField(
      GATE_005,
      form([...ACCOUNT_FIELDS, field({ type: 'text', name: 'intended_use', label: 'Intended use', required: true })]),
    );

    expect(finding.note).toContain('free text rather than a fixed choice');
    expect(finding.note).toContain('unconstrained');
  });

  it('lists every field when the form carried only account fields', () => {
    const finding = checkSignupResearchField(GATE_005, form(ACCOUNT_FIELDS));

    expect(finding.state).toBe('review');
    expect(finding.note).toContain('only fields used to create an account');
    // The full inventory is the evidence. A reader can see what the form asked for rather than
    // what this code recognised — including a research field disguised as something else.
    for (const label of ['Email', 'Password', 'First name', 'Last name']) {
      expect(finding.note).toContain(label);
    }
  });
});

describe('classifying a field is structural, never by its label', () => {
  it('reads the autofill token and the input type, which are standards not prose', () => {
    expect(isAccountField(field({ type: 'text', autocomplete: 'given-name' }))).toBe(true);
    expect(isAccountField(field({ type: 'email' }))).toBe(true);
    expect(isAccountField(field({ type: 'password' }))).toBe(true);
    expect(isAccountField(field({ type: 'text', name: 'customer[last_name]' }))).toBe(true);
  });

  it('does not classify a field by what it is called on screen', () => {
    // Labelled exactly like an account field, but carrying none of the structural signals.
    const disguised = field({ type: 'select', name: 'q7', label: 'Email', options: ['Yes', 'No'] });
    expect(isAccountField(disguised)).toBe(false);
  });

  /**
   * `organization` counts as an account field on purpose.
   *
   * GATE-005 expects presence, so a narrow baseline would read an ordinary "Company" box as the
   * research-status field and produce a false pass. A generous one produces a review with the
   * whole form quoted, which is the safe direction for a rule a person resolves.
   */
  it('treats company as an ordinary account field, erring towards review', () => {
    const company = field({ type: 'text', name: 'company', label: 'Company', autocomplete: 'organization' });
    expect(isAccountField(company)).toBe(true);
    expect(additionalFields(form([...ACCOUNT_FIELDS, company]))).toHaveLength(0);
  });

  it('leaves checkboxes to GATE-004 rather than counting them as research fields', () => {
    const box = field({ type: 'checkbox', name: 'agree', label: 'I agree', required: true });
    expect(additionalFields(form([...ACCOUNT_FIELDS, box]))).toHaveLength(0);
  });
});
