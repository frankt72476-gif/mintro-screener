/**
 * The prompt, built from `rules/angles.json` and the run (D-260).
 *
 * **Every question, every guardrail and the spectrum vocabulary come from the file.** Nothing here
 * writes an angle, and a reader wanting to know what the model was asked reads `angles.json`, not
 * this module. That is hard constraint 1 applied to a prompt: changing what the evaluation asks is
 * a data change with a version bump, not an edit to a template literal somebody has to diff.
 *
 * What this module owns is the *shape* — the order of the sections, the JSON schema the answer must
 * take, and how the run's evidence is laid out. Those are engineering decisions and they belong in
 * code.
 *
 * ## The guardrails travel verbatim
 *
 * They are strings in the file and they reach the model as strings. Paraphrasing them here would
 * mean the ratified wording and the sent wording were two things that happen to agree — the defect
 * this repository has now hit in four different places.
 */

import {
  PLACEMENT_BY_SPECTRUM,
  SPECTRUM_IDS,
  type AngleSet,
  type LimitedSection,
} from '@mintro/ruleset';
import type { EvaluationPage } from './evaluationPages.js';
import { toHandle, type HandleMap } from './evaluationHandles.js';
import type { DraftLegality } from '@mintro/engine';

/** One finding, as the model sees it. Ids are what a citation points at. */
export interface PromptFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly title: string;
  readonly state: string;
  readonly note: string;
  readonly evidenceKey: string | null;
  readonly evaluationTier: string;
  readonly weight?: string;
}

/** One eye-test verdict, as the model sees it. */
export interface PromptEyeVerdict {
  readonly id: string;
  readonly question: string;
  readonly verdict: string;
  readonly saw?: string;
}

export interface PromptInputs {
  readonly merchantDomain: string;
  readonly rulesetVersion: string;
  readonly findings: readonly PromptFinding[];
  readonly eyeTest: readonly PromptEyeVerdict[];
  /** Present when the eye test did not run. Stated, never left silent. */
  readonly eyeTestAbsence?: string;
  readonly pages: readonly EvaluationPage[];
  readonly truncations: readonly string[];
  /** Appended on a retry. The validator's own words, unedited. */
  readonly retryMessage?: string;
  /**
   * Short ids the model reads and writes in place of uuids and storage keys.
   *
   * Every id rendered below goes through this, so the prompt and the answer schema cannot
   * disagree about what the model is allowed to cite.
   */
  readonly handles: HandleMap;
  /**
   * The legality block, computed from the run.
   *
   * Shown so the model can echo it back and annotate it. It is not asked for and cannot be
   * changed — `validateDraft` refuses a draft whose block differs.
   */
  readonly legality: DraftLegality;
}

/**
 * The answer schema, spelled out for the model.
 *
 * Written here rather than generated from the types, deliberately: this is prose the model reads,
 * and a generated schema would carry TypeScript's vocabulary into a prompt. The types and this stay
 * in step because `validateDraft` refuses anything that drifts, which is a stronger guarantee than
 * a shared generator and does not pretend the two are one artifact.
 */
export const ANSWER_SCHEMA = `{
  "placement": {
    "spectrum": "one of the spectrum ids",
    "recommended": "referred_out | international | domestic",
    "paragraph": "one paragraph placing the business and naming the angles that drove it",
    "citations": [{"kind": "angle", "ref": "A3"}]
  },
  "legality": { "clean": true, "items": [
    {"ruleId": "CATG-003", "state": "fail", "evidenceKey": "E7", "note": "one sentence"},
    {"ruleId": "CATG-004", "state": "not_evaluable", "evidenceKey": "", "note": "one sentence"}
  ] },
  "routing": [{"conditionId": "...", "status": "met | not_met | not_observable", "citations": []}],
  "angles": [{
    "angleId": "A3",
    "lean": "research | neutral | consumer",
    "paragraph": "...",
    "citations": [{"kind": "finding | evidence | eye_test", "ref": "F12"}],
    "nothingObserved": false
  }],
  "shoreUps": [{"text": "...", "citation": {"kind": "finding | evidence | eye_test", "ref": "F12"}}]
}`;

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

/**
 * What each limited section is called in the prompt.
 *
 * Presentation, so it lives in code — the file names sections by the id the schema uses, and a
 * reader of `angles.json` should not have to pick a heading for a document they never see. The ids
 * themselves come from `LIMITED_SECTIONS`, so a section added to the vocabulary and forgotten here
 * fails to compile rather than rendering `undefined` into a prompt.
 */
const LIMIT_LABELS: Record<LimitedSection, string> = {
  placement: 'The placement paragraph',
  angle: 'Each angle paragraph',
  shoreUp: 'Each shore-up',
  legalityNote: 'Each legality note',
};

/** Findings grouped under the angle that reads them, so the model sees what feeds what. */
function evidenceForAngle(angleId: string, angles: AngleSet, inputs: PromptInputs): string {
  const angle = angles.angles.find((a) => a.id === angleId);
  if (angle === undefined) return '(no angle)';

  const ruleIds = new Set(angle.ruleIds);
  const rows = inputs.findings.filter((f) => ruleIds.has(f.ruleId));
  const items = new Set(angle.eyeTestItemIds);
  const eye = inputs.eyeTest.filter((v) => items.has(v.id));

  const lines: string[] = [];
  for (const finding of rows) {
    const heavy = finding.weight === 'heavy' ? ' [HEAVY]' : '';
    const handle = toHandle(inputs.handles, 'finding', finding.id);
    const key =
      finding.evidenceKey === null
        ? ''
        : ` evidence=${toHandle(inputs.handles, 'evidence', finding.evidenceKey)}`;
    lines.push(
      `- finding ${handle} ${finding.ruleId}${heavy} state=${finding.state}${key}\n` +
        `    ${finding.title}: ${finding.note}`,
    );
  }
  for (const verdict of eye) {
    const saw = verdict.saw === undefined ? '' : ` — ${verdict.saw}`;
    const handle = toHandle(inputs.handles, 'eye_test', verdict.id);
    lines.push(`- eye_test ${handle} verdict=${verdict.verdict}${saw}`);
  }

  /*
    An angle that declares no evidence is cross-cutting, not empty.

    Angle 7 has no rules of its own by design — it sets everything the other six found against the
    site's own research-only statements. The previous rendering gave it the same
    "(nothing observed)" line an angle with a genuinely blank run would get, which is false about
    this angle and points the model straight at `nothingObserved: true`. Those are two different
    facts and they must not share a sentence.

    Which rules carry the research-only statements is named in the angle's own `notes`, in the data.
    Spelling the ids out here would be rule knowledge in the prompt builder — hard constraint 1 —
    and would go stale the first time the disclosure rules moved.
  */
  if (angle.ruleIds.length === 0 && angle.eyeTestItemIds.length === 0) {
    return (
      'This angle declares no evidence of its own, and that is not the same as nothing having been ' +
      'observed. Draw on the angles above: take the items you cited there and set them against the ' +
      "site's own research-only statements, named in this angle's Notes. Cite from both sides of " +
      'each contradiction — the item that contradicts and the statement it contradicts. Set ' +
      '`nothingObserved` here only if the angles above produced nothing to set against anything.'
    );
  }

  return lines.length === 0 ? '- (nothing observed feeds this angle on this run)' : lines.join('\n');
}

/**
 * The whole prompt.
 *
 * Order is deliberate: what the job is, the guardrails, the vocabulary, the angles with their
 * evidence, the routing conditions, the page text, then the schema. The guardrails sit near the top
 * because they bound everything after them, and the schema sits last because it is the thing the
 * model is holding when it starts writing.
 */
export function buildPrompt(angles: AngleSet, inputs: PromptInputs): string {
  const parts: string[] = [];

  parts.push(
    section(
      'What you are doing',
      `You are evaluating the storefront at ${inputs.merchantDomain} to answer one question: what ` +
        'is this business, actually. Not how many checklist items it misses — a genuine research ' +
        'supplier with a missing registration gate and a consumer retailer with the right ' +
        'disclaimers can score the same, and they are not the same business.\n\n' +
        'You reason through seven angles, place the business on a spectrum, and state where it can ' +
        'be placed today. A Mintro operator reviews and edits everything you write before it ' +
        'leaves. Nothing you produce reaches anyone unreviewed.',
    ),
  );

  parts.push(section('Rules you must follow', angles.guardrails.map((g) => `- ${g}`).join('\n')));

  /*
    Length, from the file (angle set 1.1.0).

    Both halves come from `limits` — the count and the rule beside it. Writing either here would put
    a number in the prompt that the ratified file does not know about, which is the paraphrased-
    guardrail defect in a different shape: the sent length and the ratified length would be two
    things that happen to agree.

    The rule matters as much as the count. The first real draft ran to roughly 1,100 words with each
    angle opening by re-summarising the business, and seven 80-word angles that do the same thing are
    shorter and just as repetitive.
  */
  parts.push(
    section(
      'Length',
      'These are limits, not targets. A section with little to say is short.\n\n' +
        angles.limits
          .map((limit) => `- **${LIMIT_LABELS[limit.section]}** — at most ${limit.maxWords} words. ${limit.rule}`)
          .join('\n'),
    ),
  );

  parts.push(
    section(
      'Citing',
      'Every claim rests on something. Cite by the short handle printed beside each item below — ' +
        'never by any other name for it.\n\n' +
        '- `{"kind":"finding","ref":"F12"}` — a finding from this run.\n' +
        '- `{"kind":"evidence","ref":"E7"}` — a stored capture, for an observation bound to ' +
        'no rule.\n' +
        '- `{"kind":"eye_test","ref":"Y3"}` — an eye-test verdict.\n' +
        '- `{"kind":"angle","ref":"A5"}` — **placement only**. The placement names at ' +
        'least two distinct angles that drove it.\n\n' +
        'Use only handles that appear in this document. There are no others.\n\n' +
        '**Cite a finding only where it is listed.** An angle cites the findings printed under ' +
        'that angle, and a routing row cites the findings that observe that condition — named ' +
        'beside it below. A finding listed under another angle belongs to that angle, and citing ' +
        'it here offers the reader support this section does not have. Legality findings are the ' +
        'exception and may be cited anywhere. The placement, and any angle listed with no ' +
        'findings of its own, may cite from the whole run.\n\n' +
        'A sentence that rests on reasoning rather than on a capture is wrapped ' +
        '`[inference: ...]`. A paragraph that cites nothing must be marked throughout. Do not hedge ' +
        'instead of marking — "appears to" is not a declaration.',
    ),
  );

  parts.push(
    section(
      'The spectrum, and where you may place it',
      `${angles.spectrum.map((s) => `- \`${s.id}\` — ${s.label}`).join('\n')}\n\n` +
        `Placement is a judgment across the angles, not a sum of leans. Two strong consumer angles ` +
        `can outweigh five neutral ones.\n\n` +
        `Recommended placement is one of: ${angles.placements.join(', ')}.\n\n` +
        /*
          Vocabulary guidance, not a relaxation of the rule.

          The placement paragraph summarises the angles, and angle 3's subject is the merchant's
          pricing posture — so the model reaches for "pricing" there naturally, and the price rule
          refuses it. The rule is right: this section says where Mintro will place a merchant, and
          "the pricing does not work for domestic" is exactly what D-256 forbids. What a word list
          cannot see is whose pricing is meant.

          So the model is given words that carry the same meaning and cannot be misread. Steering
          the wording costs nothing; widening the rule would let a real cost comparison through.
        */
        '**In this paragraph, do not use the words price, pricing, cost, fee, discount or rate.** ' +
        "Describe the merchant's commerce as its **commercial posture**, **how it sells**, or its " +
        '**order structure**. Those say the same thing and cannot be read as a statement about what ' +
        'Mintro charges. The angle paragraphs are unrestricted — this applies to the placement only.',
    ),
  );

  /*
    The spectrum-to-placement rule, printed from the table the validator reads.

    Written out here rather than described in prose, because the model has to pick a value from it
    and a sentence saying "the consumer side cannot be domestic" leaves the middle three positions
    to inference. `validateDraft` refuses a draft that breaks it, so a prompt that only implied the
    rule would spend a retry teaching it.

    The unobservable conditions are named from the angle set for the same reason: which two the
    application answers is data, and a prompt that spelled them out would be a second copy to diff.
  */
  const application = angles.routingConditions.filter((condition) => !condition.observable);

  /*
    How a routing row is decided (D-273).

    Stated before the placement rules that read those rows, because a draft that gets the rows wrong
    gets the placement wrong for a reason nothing downstream can see. Run f6008fa9 wrote **Met** on
    `no_water_or_syringes` over three feeder rules, one of which was `not_evaluable` — the row
    announced a condition holds on evidence that established nothing about it.

    The validator refuses a row that disagrees with its feeders, so this is not advice: it is the
    rule the answer is checked against, said once here and enforced once there.
  */
  const attestationRows = angles.routingConditions.filter(
    (condition) => condition.attestationIsNotRegistration === true,
  );
  parts.push(
    section(
      'How a routing row is decided',
      'A row states what **its own rules observed**, and nothing more. Each condition names the ' +
        'rules that observe it; look at what those findings actually reached.\n\n' +
        '- **`met`** — every one of them is `pass`. That is the only thing that earns it.\n' +
        '- **`not_met`** — any one of them observed a violation (`fail` or `review`). A violation ' +
        'outranks an unobserved sibling: a rule that saw something saw something.\n' +
        '- **`not_observable`** — any one of them is `not_evaluable`, whatever the reason. ' +
        '`not_applicable` establishes as little about the condition as a timeout does. A row that ' +
        'said `met` here would report a condition holding on evidence that never touched it.\n\n' +
        'These are not judgements to weigh. Read the findings and say what they support; cite the ' +
        'ones you read.' +
        (attestationRows.length === 0
          ? ''
          : `\n\n**An attestation is not a registration.** Where this run reached the catalogue by ` +
            `affirming the site's own consent gate — ticking boxes about who the visitor is — and ` +
            `created no account, ${attestationRows
              .map((c) => `\`${c.id}\``)
              .join(', ')} is \`not_met\`. Getting past a gate without an account is that ` +
            'condition being observed **not** to hold. Only an account requirement the crawl ' +
            'actually met makes it `met`.'),
    ),
  );

  parts.push(
    section(
      'How far the spectrum lets you place it',
      `${SPECTRUM_IDS.map((id) => {
        const permitted = PLACEMENT_BY_SPECTRUM[id];
        return `- \`${id}\` — ${permitted.map((p) => `\`${p}\``).join(' or ')}`;
      }).join('\n')}\n\n` +
        'The spectrum is what the business **is**; the placement is what Mintro will do about it ' +
        'today. A placement above what the position allows is refused.\n\n' +
        '**`domestic` is the one that has to be earned.** Every routing condition this run can ' +
        'observe must be `met`. `not_observable` is not `met` — it means nobody has established the ' +
        'condition, and a recommendation resting on it would rest on nothing.\n\n' +
        `The only conditions that may stand \`not_observable\` under a \`domestic\` recommendation ` +
        `are the ${application.length} the application answers: ` +
        `${application.map((c) => `\`${c.id}\``).join(', ')}. Those are not on the public site, and ` +
        'refusing a placement because a storefront cannot show them would decline a merchant for a ' +
        'limit of our method. Recommending `domestic` over them says they must hold — say so in the ' +
        'paragraph.\n\n' +
        'If an observable condition is `not_met` or `not_observable`, recommend `international` and ' +
        'name the open conditions as the path.',
    ),
  );

  const angleBlocks = angles.angles.map((angle) => {
    /*
      The handle leads, and there is no ordinal.

      Handles are assigned from sorted ids, so `A1` is not "Angle 1". Printing both would put a
      mismatch in front of the model at every citation site — the sort of thing that produces a
      confident wrong reference. One name, used everywhere.
    */
    const handle = toHandle(inputs.handles, 'angle', angle.id);
    return (
      `### ${handle} — ${angle.title}\n\n` +
      `**Question:** ${angle.question}\n\n` +
      `**Reasoning:** ${angle.reasoning}\n\n` +
      `**Notes:** ${angle.notes}\n\n` +
      `**Evidence on this run:**\n${evidenceForAngle(angle.id, angles, inputs)}`
    );
  });
  parts.push(section('The seven angles', angleBlocks.join('\n\n')));

  parts.push(
    section(
      'Routing conditions',
      'State every one, including the ones that cannot be observed from a crawl. ' +
        '`not_observable` is not a soft `not_met` — it means the storefront cannot show it, so ' +
        'leave its citations empty. There is nothing that could bear on it, and a capture there ' +
        'reads as support for a status that has none.\n\n' +
        angles.routingConditions
          .map((condition) => {
            const observed =
              condition.ruleIds.length === 0
                ? `answered by the ${condition.source ?? 'application'}, not the site — cite nothing`
                : `cite only findings on ${condition.ruleIds.join(', ')}`;
            return `- \`${condition.id}\` — ${condition.label} (${observed})`;
          })
          .join('\n'),
    ),
  );

  const eyeBlock =
    inputs.eyeTestAbsence !== undefined
      ? `The eye test did not run on this run: ${inputs.eyeTestAbsence}\n` +
        'Say so where an angle would have rested on it. Do not infer from its absence.'
      : inputs.eyeTest.length === 0
        ? 'No eye-test verdicts are recorded for this run.'
        : inputs.eyeTest
            .map(
              (v) =>
                `- ${toHandle(inputs.handles, 'eye_test', v.id)} ${v.verdict}` +
                `${v.saw === undefined ? '' : ` — ${v.saw}`}\n    ${v.question}`,
            )
            .join('\n');
  parts.push(section('Eye-test verdicts', eyeBlock));

  const pageBlocks = inputs.pages.map((page) => {
    const cut = page.truncated ? ` (cut from ${page.originalLength} characters)` : '';
    const via = page.source === 'dom' ? '' : ` [text source: ${page.source}]`;
    const head = `--- ${page.surface} — ${page.sourceUrl}${cut}${via}`;
    if (page.source === 'none') {
      return `${head}\n(no text: ${page.problem ?? 'unavailable'})`;
    }
    return `${head}\n${page.text}`;
  });
  parts.push(
    section(
      'Page text',
      'Read from the run\'s stored captures. This is the rendered, visible text of each page.\n\n' +
        (pageBlocks.length === 0 ? '(no pages were read)' : pageBlocks.join('\n\n')),
    ),
  );

  if (inputs.truncations.length > 0) {
    parts.push(
      section(
        'What you were not shown',
        `${inputs.truncations.map((t) => `- ${t}`).join('\n')}\n\n` +
          'Declare this where it bears on an angle. An absence of observation is not an observation ' +
          'of absence.',
      ),
    );
  }

  /*
    The legality block, given rather than asked for.

    It decides the recommendation and is the first thing an underwriter reads, so it is computed
    from the findings and injected. The model returns it unchanged apart from one sentence per item
    — on run 9011b2d7, asked to assemble it, the model wrote `clean: true, items: []` over two
    legality rules that were never observed.
  */
  const legalityRows =
    inputs.legality.items.length === 0
      ? '(no legality rule failed or went unobserved on this run)'
      : inputs.legality.items
          .map(
            (item) =>
              `- \`${item.ruleId}\` — **${item.state}**` +
              `${item.evidenceKey === '' ? ' (no capture recorded)' : ` (${item.evidenceKey})`}`,
          )
          .join('\n');

  parts.push(
    section(
      'Legality — supplied, not yours to decide',
      `\`clean\`: **${inputs.legality.clean}** — meaning no legality violation was *observed*.\n\n` +
        `${legalityRows}\n\n` +
        'Return this block exactly as given. You may add a `note` of one sentence to any item, ' +
        'saying what it means for this merchant. You may not add an item, remove one, change a ' +
        "state, or change `clean`.\n\n" +
        /*
          The convention, stated.

          `evidenceKey` is required on every item and the row for an unobserved rule prints as
          "(no capture recorded)", which left the model to guess what to echo there. The empty
          string was the answer and nothing said so — so a guess became an invented handle, the
          decode refused it, and a whole retry went on a rule nobody had written down.
        */
        'An item shown as *(no capture recorded)* carries `"evidenceKey": ""` — the empty string. ' +
        'Not a handle, and not the field left out: the rule was never observed, so there is no ' +
        'capture to name. A handle invented there is refused and the draft comes back to you.\n\n' +
        '`not_evaluable` is not a pass and not a violation: the rule could not be observed at all. ' +
        'Say so where it bears on an angle rather than treating it as either.',
    ),
  );

  parts.push(
    section(
      'Answer',
      `Reply with JSON only, in exactly this shape:\n\n${ANSWER_SCHEMA}\n\n` +
        'Every angle appears, in the order above, even one that observed nothing — set ' +
        '`nothingObserved` and say so in the paragraph. Every routing condition appears. ' +
        '**An angle citing a rule marked [HEAVY] that failed cannot lean research.** Heavy ' +
        'evidence against the reading is what the lean answers to; lean neutral and say what the ' +
        'failure means. A `review` or a `not_evaluable` on a heavy rule does not bind the lean — ' +
        'neither is a failure. ' +
        'Refer to angles by their handle (`A1`, `A2`, …), exactly as headed above. '+
        'Return the legality block exactly as supplied, notes aside.',
    ),
  );

  if (inputs.retryMessage !== undefined) {
    parts.push(section('Your previous answer was refused', inputs.retryMessage));
  }

  return parts.join('\n\n');
}

/**
 * A rough input token count, for the dry run.
 *
 * Four characters per token is the usual English approximation and it is stated as an estimate
 * everywhere it is shown. A precise count needs the tokenizer, which needs a network call — and a
 * dry run that calls the API is not a dry run.
 */
export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
