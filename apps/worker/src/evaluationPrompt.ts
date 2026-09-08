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

import type { AngleSet } from '@mintro/ruleset';
import type { EvaluationPage } from './evaluationPages.js';

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
    "citations": [{"kind": "angle", "ref": "<angle id>"}]
  },
  "legality": { "clean": true, "items": [{"ruleId": "...", "evidenceKey": "..."}] },
  "routing": [{"conditionId": "...", "status": "met | not_met | not_observable", "citations": []}],
  "angles": [{
    "angleId": "...",
    "lean": "research | neutral | consumer",
    "paragraph": "...",
    "citations": [{"kind": "finding | evidence | eye_test", "ref": "..."}],
    "nothingObserved": false
  }],
  "shoreUps": [{"text": "...", "citation": {"kind": "finding | evidence | eye_test", "ref": "..."}}]
}`;

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

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
    const key = finding.evidenceKey === null ? '' : ` evidence=${finding.evidenceKey}`;
    lines.push(
      `- finding ${finding.id} ${finding.ruleId}${heavy} state=${finding.state}${key}\n` +
        `    ${finding.title}: ${finding.note}`,
    );
  }
  for (const verdict of eye) {
    const saw = verdict.saw === undefined ? '' : ` — ${verdict.saw}`;
    lines.push(`- eye_test ${verdict.id} verdict=${verdict.verdict}${saw}`);
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

  parts.push(
    section(
      'Citing',
      'Every claim rests on something. A citation is one of:\n' +
        '- `{"kind":"finding","ref":"<finding id>"}` — a finding from this run, listed below.\n' +
        '- `{"kind":"evidence","ref":"<evidence key>"}` — a stored capture, for an observation ' +
        'bound to no rule.\n' +
        '- `{"kind":"eye_test","ref":"EYE-nn"}` — an eye-test verdict, listed below.\n' +
        '- `{"kind":"angle","ref":"<angle id>"}` — **placement only**. The placement names at ' +
        'least two distinct angles that drove it.\n\n' +
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
        `Recommended placement is one of: ${angles.placements.join(', ')}.`,
    ),
  );

  const angleBlocks = angles.angles.map((angle, index) => {
    return (
      `### Angle ${index + 1}: ${angle.title} (\`${angle.id}\`)\n\n` +
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
        '`not_observable` is not a soft `not_met` — it means the storefront cannot show it.\n\n' +
        angles.routingConditions
          .map((condition) => {
            const observed =
              condition.ruleIds.length === 0
                ? `answered by the ${condition.source ?? 'application'}, not the site`
                : `observed by ${condition.ruleIds.join(', ')}`;
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
            .map((v) => `- ${v.id} ${v.verdict}${v.saw === undefined ? '' : ` — ${v.saw}`}\n    ${v.question}`)
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

  parts.push(
    section(
      'Answer',
      `Reply with JSON only, in exactly this shape:\n\n${ANSWER_SCHEMA}\n\n` +
        'Every angle appears, in the order above, even one that observed nothing — set ' +
        '`nothingObserved` and say so in the paragraph. Every routing condition appears.',
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
