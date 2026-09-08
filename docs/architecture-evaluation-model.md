# Architecture — D-256 evaluation model

Written against read-only discovery of the repo on 2026-09-08. Follows D-256,
docs/angle-set-design.md and docs/report-layout-design.md. For ratification before any cluster
starts.

## The fact that shapes this

The repo already has half of Layer 2. `packages/engine/src/eyetest.ts` asks a vision model
(claude-sonnet-5, rubric `rules/eyetest.json` 2.2.0) rubric questions over screenshots and page
text, stores answers in `public.eye_tests` (0049), and renders them in `EyeTestPanel`
(ReportView.tsx:1173). Its docblock says it produces observations, never findings, never a verdict.
Its vocabulary is `concern | cannot_tell`, and it deliberately carries no rule id.

That is the angle model with the conclusion removed, built under D-001. D-256 puts the conclusion
back. So the ruling is: the eye test is not replaced and not extended. It becomes one input to
the draft generator, its outcomes cited as evidence under angle 1 (who the site is talking to)
and angle 7 (consistency), and its panel leaves the report. The rubric keeps running unchanged.

Everything else below is new alongside the existing engine, not a rewrite of it.

## Components

### 1. Rule tiering (data only)

`rules/ruleset.json` gains two fields per rule:

- `tier`: `legality | routing | evidence`
- `weight`: `heavy | ordinary` (evidence tier only)

`enforcement` (auto_fail / review_only) stays in data for the validator and the run engine; it
stops being rendered. Two rules are added: an explicit outcome-claim rule (legality; "lose 20 lbs
in 30 days" shape, text match) and a suggestive lifestyle-claim rule (heavy evidence). PROD-008
narrows to explicit disease claims (legality); its implied form moves to the new lifestyle rule.
Version 3.1.0 → 3.2.0. D-041 untouched: no clause text changes except the PROD-008 split, which
takes its clause from the standards §5 sentence it already quotes.

The `packages/ruleset` validator asserts every rule carries a tier, every evidence rule carries a
weight, and the legality set is exactly the ratified five plus the outcome-claim rule.

### 2. Angle set as data

New file `rules/angles.json`, versioned (1.0.0), mirroring how `rules/eyetest.json` carries the
rubric and its model. Contents: the seven angles (id, title, question, reasoning, the rule ids and
eye-test item ids that feed each), the six routing conditions (id, label, the rule ids that
observe it, `observable: true|false`), the five-position spectrum vocabulary, and `model:
"claude-opus-5"`. The prompt is built from this file, never hand-written in code. Changing an
angle is a data change with a version bump.

### 3. Draft generator (worker job)

New `apps/worker/src/evaluateJob.ts`, modelled on `eyeTestJob.ts`: raw fetch to the Messages API,
key from `ANTHROPIC_API_KEY`, model from `angles.json`. No SDK, matching the repo.

Inputs, all loaded from the finished run, never re-fetched: the findings with their evidence keys,
the eye-test outcomes, the captured page text for every rendered page, the rule set and angle set
versions. Output is a single JSON document against a fixed schema:

```
{
  placement: { spectrum, recommended, paragraph },
  legality:  { clean, items: [{ruleId, evidenceKey}] },
  routing:   [{ conditionId, status: met|not_met|not_observable, citations }],
  angles:    [{ angleId, lean, paragraph, citations, nothingObserved? }],
  shoreUps:  [{ text, citation }]
}
```

Every `citation` is a finding id, an evidence key, or an eye-test item id from this run. Sentences
inside a paragraph that carry no citation must be wrapped as `[inference: ...]`.

A validator runs before anything is stored and rejects the draft if: any citation does not exist
in the run; any uncited sentence lacks the inference marker; legality is not clean but
`recommended` is not `referred_out`; `shoreUps` is non-empty for a consumer-side spectrum
position; any text mentions price, cost, basis points or fees. Rejection is recorded and the job
retries once with the validator's message appended; a second rejection is stored as a failed
draft the operator can see.

Input hash (sha256 of the inputs) is stored with the draft, so a regenerated draft over the same
run is comparable and a draft over changed inputs is detectable.

### 4. Storage

Two tables, two migrations, following `NNNN_snake_case`:

- `0075_evaluation_drafts.sql` — one row per run at a time. Columns: run_id, angles_version,
  ruleset_version, model, input_sha256, content jsonb, validator_status, validator_message,
  created_at, edited_at, edited_by. Mutable: the operator edits it and regeneration replaces it.
  This is the one deliberately mutable object in the system, and it is never rendered outside the
  operator UI.
- `0076_evaluations.sql` — published versions. Columns: run_id, version (1..n), content jsonb,
  published_at, published_by, draft_input_sha256. Append-only under the existing
  `reject_mutation()` trigger, same as findings. Publishing copies the draft into a new row; the
  draft row is then deleted. Earlier versions remain readable.

The run row is untouched by any of this. D-002's trigger on `runs` and the append-only triggers on
findings and evidence stay exactly as they are. The evaluation is a separate artifact that cites
into an immutable run.

No `observations` table in v1. Unbound observations are produced inside the draft as cited or
inference-marked sentences, which is what the angle memo asked for. An engine-side heuristic
observation layer (shipping-scope statements, wholesale mentions, age mismatches) is a later
cluster if the drafts show the model missing them.

### 5. Operator UI

In `App.tsx` Screener, the `stage === 'report'` branch gains an evaluation editor above the
existing ReportView. New component `EvaluationEditor.tsx`: five editable regions matching layout
sections 1 to 5, citation chips resolving through the existing `EvidenceAccess.urlFor` (signed
URLs, same as `Screenshot`), inference sentences visibly marked, validator status shown.

Actions on the editor: **Regenerate draft**, **Publish**. Publish re-runs the validator on the
edited content, inserts the `evaluations` row, deletes the draft, and enqueues the capture job.

Gating: publishing is a capability, owner-granted, like `canSubmitToIqwallet` in
`homeShape.ts` and `0069_capability_gates.sql`. New `current_admin_can_publish_evaluation()`
resolved from `auth.uid()`. Business question for Frank below.

### 6. Report rendering and capture

New `EvaluationReport.tsx` renders sections 1 to 5 from a published evaluation, then mounts the
existing findings rendering (GroupedFindings, EvidenceSlip, NotCheckedSection) beneath as
sections 6 and 7. Masthead is rewritten per the layout memo; the count line and the auto_fail /
review_only labels are removed. `AttestationSection`, `CommentPane`, `EyeTestPanel`,
`MerchantResponse` and `Participation` are not mounted. Not deleted.

`captureJob.ts` loads the latest published evaluation alongside the run. No published evaluation
means no capture, and `send.ts` already refuses to compose without a capture (send.ts:97), so a
draft cannot be sent by construction. `assertCapturable` gains the check.

`MerchantRoute` (the tokenized merchant link) is left routable but the invite job stops being
offered from the UI.

### 7. Tests

The web test suite locks the old layout hard: counting, numbering, partition, sections,
stoppingSentence, solicitation, attestationSection, respondZone. Ruling: tests that lock the
evidence appendix (requirement heading, evidence slip, vocabulary, readability, ligatures,
anchors) keep their meaning and move under the new layout. Tests that lock the masthead count,
the attestation prominence, the stopping sentence and the merchant respond zone are retired with a
one-line note naming D-256. New tests: the draft validator against each rejection rule, the
evaluations trigger against UPDATE and DELETE, capture refusal without a published evaluation,
and the price-word check.

`copy.test.ts` (worker) asserts the verdict copy for a real run; it will need the masthead
sentence swapped and the count assertion removed.

### 8. Configuration

`ANTHROPIC_API_KEY` is already on Fly (DEPLOY.md:354-359) and, as discovery noted, missing from
the env table at DEPLOY.md:601-618. Add it there in the first cluster; it is a pre-existing gap
this work now depends on.

## Clusters, in order

1. **Tiering.** ruleset.json 3.2.0, two new rules, PROD-008 split, validator. Data and tests only.
   Nothing renders differently.
2. **Generator.** angles.json, evaluateJob, validator, 0075/0076, a CLI (`bin/evaluate.ts <runId>`)
   that writes a draft and prints it. Run it against the five real runs and CoMo. Read the drafts
   before building any UI on them.
3. **Editor and publish.** EvaluationEditor, capability gate, publish path.
4. **Report.** EvaluationReport, capture gating, dormant sections, test retirement, masthead.
5. **Deferred.** Engine-side heuristic observations; prompt caching; removal of dormant
   attestation and invite code as its own decision.

Cluster 2 is the one that tells us whether the angle set works. If the drafts read badly against
real sites, the fix is in angles.json and the prompt, before a line of UI exists.

## Business question for Frank

Who may publish. Any signed-in Mintro analyst, or owner-granted like IQwallet submission? The
published evaluation carries Mintro's determination and an operator's name. I would gate it, but
that is a staffing call.

## Decision records to write

D-257 eye test becomes draft input, panel leaves the report. D-258 evaluation as a separate
artifact: mutable draft, append-only published versions, run untouched. D-259 rule tiering.
D-260 draft validator rules, including the price-word rejection. D-261 test retirement list.
