/**
 * The sign-up form checks — GATE-004 and GATE-005 (D-048).
 *
 * Pure: a rule plus a `SignupForm` in, a finding out. The form is located in the worker by its
 * password field and arrives here as plain data, so both checks are testable from a fixture.
 *
 * ## Constraint 9 is the whole design
 *
 * Both rules are `expect: present`, and that direction is the dangerous one: **failing to locate
 * the subject reads as "missing", which produces a false failure or a review queue full of
 * merchants who complied in wording nobody anticipated.**
 *
 * So the structure decides what exists, and the wording only ever decides how confident the
 * finding is among forms where the structure was found:
 *
 *   - Whether a required checkbox exists is decided by `type` and `required` — attributes, not prose.
 *   - Whether a field beyond the standard account set exists is decided by `autocomplete` and
 *     `type` against the W3C autofill vocabulary, which is a standard rather than merchant copy.
 *   - Every field observed is named in the finding, whatever it is labelled, so a reader can see
 *     what the form actually asked for rather than what this code recognised.
 *
 * A form that could not be located is `not_evaluable`, never "no checkbox present".
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { FormField, SignupForm } from '../page.js';
import { notEvaluable, satisfied, violation, type Evidence, type Finding } from '../findings.js';

/**
 * The standard account-creation vocabulary, from the HTML autofill spec plus the field types a
 * sign-up form uses to make an account.
 *
 * Deliberately **generous**. Anything in here is treated as an ordinary account field and is not
 * counted as evidence that research status was asked for. Since GATE-005 expects presence, a
 * narrow baseline would classify ordinary fields as the research field and produce a false
 * `pass`; a generous one produces a review with the whole form quoted, which is the safe
 * direction for a `review_only` rule.
 *
 * `organization` is in here for exactly that reason. A merchant may well use "Company" as their
 * research-status field — and if they do, this reports the form in full and a person decides,
 * rather than this code deciding on a guess.
 */
const ACCOUNT_AUTOCOMPLETE = new Set([
  'email',
  'username',
  'new-password',
  'current-password',
  'name',
  'given-name',
  'family-name',
  'additional-name',
  'nickname',
  'honorific-prefix',
  'honorific-suffix',
  'tel',
  'tel-national',
  'tel-country-code',
  'organization',
  'organization-title',
  'street-address',
  'address-line1',
  'address-line2',
  'address-line3',
  'address-level1',
  'address-level2',
  'country',
  'country-name',
  'postal-code',
  'bday',
]);

/** Field `name`/`id` fragments the major platforms use for the same set. */
const ACCOUNT_NAME_HINTS = [
  'email',
  'password',
  'passwd',
  'pwd',
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'fullname',
  'full_name',
  'username',
  'user_login',
  'phone',
  'tel',
  'address',
  'city',
  'state',
  'zip',
  'postcode',
  'postal',
  'country',
  'company',
  'organization',
];

/** Wording that identifies an agreement document. Used only to grade confidence — see below. */
const AGREEMENT_WORDS = [
  'terms',
  'conditions',
  'agreement',
  'agree',
  'policy',
  'policies',
  'privacy',
  'disclaimer',
];

/**
 * True when a field is part of making an account rather than something the merchant added.
 *
 * Structural signals only: the autofill token, the input type, and the platform's own field
 * naming. None of these is prose a merchant writes for a human to read.
 */
export function isAccountField(field: FormField): boolean {
  if (field.autocomplete !== '' && ACCOUNT_AUTOCOMPLETE.has(field.autocomplete)) return true;
  if (field.type === 'password' || field.type === 'email' || field.type === 'tel') return true;

  const name = field.name.toLowerCase();
  if (name === '') return false;
  return ACCOUNT_NAME_HINTS.some((hint) => name.includes(hint));
}

/** Fields the merchant added beyond making an account. GATE-005's candidates. */
export function additionalFields(form: SignupForm): readonly FormField[] {
  return form.fields.filter(
    (field) => !isAccountField(field) && field.type !== 'checkbox' && field.type !== 'hidden',
  );
}

/** Every checkbox in the form, whatever it is labelled. GATE-004's subject. */
export function checkboxes(form: SignupForm): readonly FormField[] {
  return form.fields.filter((field) => field.type === 'checkbox');
}

/** A short, quotable description of a field, for finding text. */
function describeField(field: FormField): string {
  const label = field.label.trim() === '' ? '(no visible label)' : `"${trim(field.label, 90)}"`;
  const name = field.name === '' ? '' : ` [${field.name}]`;
  const options = field.options.length === 0 ? '' : ` — options: ${field.options.slice(0, 6).join(', ')}`;
  return `${label}${name} (${field.type}${field.required ? ', required' : ', optional'})${options}`;
}

const trim = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Evidence for a finding read off the sign-up form. */
function formEvidence(form: SignupForm, matched?: string): readonly Evidence[] {
  return [
    {
      kind: 'rendered_page',
      sourceUrl: form.url,
      sourceSha256: '',
      evidenceKey: '',
      capturedAt: new Date().toISOString(),
      ...(matched === undefined ? {} : { matchedValue: matched }),
    },
  ];
}

/**
 * A form that was never located, for either rule.
 *
 * `not_exposed`, not `no_check_built`: the check exists and ran, and what stopped it was the
 * merchant's site not presenting a sign-up form the crawl could reach (D-044). The attempts made
 * are carried on the form context and reported by the worker.
 */
function unlocated(rule: RuleOfType<'dom_assert'>, form: SignupForm): Finding {
  return notEvaluable(
    rule,
    form.locatedBy === ''
      ? 'no account-creation form was reached: no page carrying a password field was found at the account paths tried'
      : `no account-creation form was reached. The closest page found was ${form.locatedBy}`,
    'rendered_page',
    'not_exposed',
    form.url === '' ? [] : formEvidence(form),
  );
}

/**
 * GATE-004 — a required acknowledgement before an account is created.
 *
 * **The structure decides whether a required checkbox exists.** Wording only decides whether the
 * finding can pass or must go to a person:
 *
 *   - required checkbox whose label names an agreement document → `pass`
 *   - required checkbox worded some other way → `review`, with the label quoted verbatim
 *   - checkboxes present but none required → `review`, all of them listed
 *   - no checkbox at all → `review`, and the note says the form was read and carried none
 *
 * A merchant whose checkbox reads "I confirm I have read the conditions of sale" is therefore
 * surfaced with their own wording rather than missed, which is what constraint 9 asks for.
 */
export function checkSignupAcknowledgement(
  rule: RuleOfType<'dom_assert'>,
  form: SignupForm,
): Finding {
  if (!form.found) return unlocated(rule, form);

  const boxes = checkboxes(form);
  const required = boxes.filter((box) => box.required);

  if (required.length === 0) {
    const note =
      boxes.length === 0
        ? `The sign-up form at ${form.url} was read in full and carried no checkbox. ` +
          `${form.fields.length} field(s) were observed: ${form.fields.map(describeField).join('; ')}.`
        : `The sign-up form at ${form.url} carried ${boxes.length} checkbox(es), none of them required: ` +
          `${boxes.map(describeField).join('; ')}.`;

    return violation(
      rule,
      note,
      'rendered_page',
      formEvidence(form, boxes.length === 0 ? undefined : boxes.map(describeField).join('; ')),
    );
  }

  const agreeing = required.filter((box) =>
    AGREEMENT_WORDS.some((word) => box.label.toLowerCase().includes(word)),
  );

  if (agreeing.length > 0) {
    return satisfied(
      rule,
      `A required checkbox on the sign-up form at ${form.url} refers to an agreement document: ` +
        `${agreeing.map(describeField).join('; ')}. Its wording was read; the document it links to was not followed.`,
      'rendered_page',
      formEvidence(form, agreeing.map((box) => box.label).join(' · ')),
    );
  }

  // Required, but worded in a way this check cannot tie to an agreement. That is a judgment
  // about wording, which is what `review_only` is for — not a reason to report it as absent.
  return violation(
    rule,
    `The sign-up form at ${form.url} carried ${required.length} required checkbox(es), none of whose ` +
      `wording names an agreement document: ${required.map(describeField).join('; ')}. ` +
      `Whether any of them acknowledges the terms is a judgment about its wording.`,
    'rendered_page',
    formEvidence(form, required.map((box) => box.label).join(' · ')),
  );
}

/**
 * GATE-005 — research status asked for, and asked for as a requirement.
 *
 * **This check never returns `pass`, and that is deliberate.** It can establish structurally that
 * a field exists and that it is required; it cannot establish that a field *asks about research
 * status* without reading its label, and a check that read labels would miss every merchant who
 * worded it differently — the population the rule exists to find (constraint 9).
 *
 * So it reports what the form contains and a person decides, which is what `review_only` means.
 * This is the same posture as OFFS-006 (D-020): surface the candidate, never judge the wording.
 *
 * The finding still distinguishes the cases that matter, and names every field either way:
 *
 *   - a required field beyond the standard account set → the candidate, quoted
 *   - such a field present but optional → named, with the fact that it is optional, which is
 *     precisely what the clause prohibits
 *   - only standard account fields → said plainly, with the full inventory as the evidence
 */
export function checkSignupResearchField(
  rule: RuleOfType<'dom_assert'>,
  form: SignupForm,
): Finding {
  if (!form.found) return unlocated(rule, form);

  const additional = additionalFields(form);
  const inventory = form.fields.map(describeField).join('; ');
  const preferred = rule.params.prefer_types ?? [];

  if (additional.length === 0) {
    return violation(
      rule,
      `The sign-up form at ${form.url} carried only fields used to create an account. ` +
        `All ${form.fields.length} field(s) observed: ${inventory}. ` +
        `No field beyond that set was present to identify research status.`,
      'rendered_page',
      formEvidence(form, inventory),
    );
  }

  const required = additional.filter((field) => field.required);
  const freetext = additional.filter(
    (field) => preferred.length > 0 && !preferred.includes(field.type),
  );

  const shape =
    rule.params.note_if_freetext === true && freetext.length > 0
      ? ` ${freetext.length} of them ${freetext.length === 1 ? 'is' : 'are'} free text rather than a fixed choice ` +
        `(${preferred.join(', ')}), so what a buyer may enter is unconstrained.`
      : '';

  const note =
    required.length > 0
      ? `The sign-up form at ${form.url} carried ${required.length} required field(s) beyond those used to ` +
        `create an account: ${required.map(describeField).join('; ')}.${shape} ` +
        `Whether any of them identifies research status is a judgment about its wording. ` +
        `All ${form.fields.length} field(s) observed: ${inventory}.`
      : `The sign-up form at ${form.url} carried ${additional.length} field(s) beyond those used to create ` +
        `an account, and none of them is required: ${additional.map(describeField).join('; ')}.${shape} ` +
        `All ${form.fields.length} field(s) observed: ${inventory}.`;

  return violation(rule, note, 'rendered_page', formEvidence(form, inventory));
}
