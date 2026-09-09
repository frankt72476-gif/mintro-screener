/**
 * Short, run-scoped handles for every id the model may cite (D-260, amended).
 *
 * `F1`, `E7`, `Y3`, `A5` stand in for a finding uuid, a 112-character evidence key, an eye-test
 * item id and an angle id. The model reads and writes handles; the real ids never reach it.
 *
 * ## Why
 *
 * The answer schema constrains citations to enums of the run's own ids, so a fabricated citation is
 * unrepresentable rather than merely refused. With real ids that schema was **10,437 bytes** for run
 * 9011b2d7 — 59 uuids and 38 evidence keys — and the API refused it twice:
 *
 *     Schema is too complex for compilation.
 *
 * Moving the enums into `$defs` removed the duplication and not the cause: the values still have to
 * exist once, and the evidence-key enum alone is over four kilobytes. Handles cut the same schema to
 * **4,328 bytes**, and take about 2.5 KB out of the prompt as a side effect.
 *
 * The guard survives the change intact. An invented `F99` is outside the enum exactly as an invented
 * uuid was, and `validateDraft` still runs — on the **real** ids, after decoding.
 *
 * ## Assignment is sorted, so it is reproducible
 *
 * Handles come from the run's ids sorted, which makes two drafts over one run comparable: the same
 * inputs produce the same handles, and `input_sha256` already promises the inputs were the same.
 *
 * Angles are sorted too, and that has one visible consequence: `A1` is not "Angle 1". Rather than
 * carry a mismatch the model has to keep straight, the prompt drops ordinal numbering entirely and
 * heads each block with its handle. A reader who needs the mapping has it stored on the draft.
 *
 * ## The mapping is stored with the draft
 *
 * A draft citing `F12` is unreadable without it, and a draft is re-read by an operator hours later
 * and by whoever reviews the published version afterwards. It is written to `evaluation_drafts`
 * (migration 0078) rather than recomputed, because recomputing it from a run that has since been
 * re-scanned would silently re-point every citation.
 */

import type { RunContext } from '@mintro/engine';

/** One namespace: real ids to handles and back. */
export interface Handles {
  readonly toHandle: ReadonlyMap<string, string>;
  readonly toId: ReadonlyMap<string, string>;
}

export interface HandleMap {
  readonly finding: Handles;
  readonly evidence: Handles;
  readonly eyeTest: Handles;
  readonly angle: Handles;
}

/** The stored form: one object per namespace, handle to real id. */
export interface StoredHandles {
  readonly finding: Record<string, string>;
  readonly evidence: Record<string, string>;
  readonly eye_test: Record<string, string>;
  readonly angle: Record<string, string>;
}

function assign(prefix: string, ids: Iterable<string>): Handles {
  const sorted = [...ids].sort();
  const toHandle = new Map<string, string>();
  const toId = new Map<string, string>();
  sorted.forEach((id, index) => {
    const handle = `${prefix}${index + 1}`;
    toHandle.set(id, handle);
    toId.set(handle, id);
  });
  return { toHandle, toId };
}

export function buildHandles(run: RunContext): HandleMap {
  return {
    finding: assign('F', run.findingIds),
    evidence: assign('E', run.evidenceKeys),
    eyeTest: assign('Y', run.eyeTestItemIds),
    angle: assign('A', run.angleIds),
  };
}

/** The namespace a citation kind draws on. */
function spaceFor(map: HandleMap, kind: string): Handles | null {
  if (kind === 'finding') return map.finding;
  if (kind === 'evidence') return map.evidence;
  if (kind === 'eye_test') return map.eyeTest;
  if (kind === 'angle') return map.angle;
  return null;
}

/** A real id as the model sees it, or the id unchanged when it has no handle. */
export function toHandle(map: HandleMap, kind: string, id: string): string {
  return spaceFor(map, kind)?.toHandle.get(id) ?? id;
}

/**
 * A handle back to the real id, or `null` when it is not one this run issued.
 *
 * Null rather than the input, deliberately. A handle the run did not issue is exactly the
 * fabrication this whole arrangement exists to catch, and passing it through unchanged would hand
 * `validateDraft` a string that looks like a real id and is not.
 */
export function toId(map: HandleMap, kind: string, handle: string): string | null {
  const space = spaceFor(map, kind);
  if (space === null) return null;
  return space.toId.get(handle) ?? null;
}

/**
 * A `RunContext` in handle space, for building the answer schema.
 *
 * `routingConditionIds` and `consumerSideSpectrum` pass through untouched: condition ids and
 * spectrum positions are already short, readable words, and replacing `registration_gate` with
 * `R1` would cost clarity and save nothing.
 */
export function handleContext(run: RunContext, map: HandleMap): RunContext {
  return {
    findingIds: new Set(map.finding.toId.keys()),
    evidenceKeys: new Set(map.evidence.toId.keys()),
    eyeTestItemIds: new Set(map.eyeTest.toId.keys()),
    angleIds: run.angleIds.map((id) => map.angle.toHandle.get(id) ?? id),
    routingConditionIds: run.routingConditionIds,
    consumerSideSpectrum: run.consumerSideSpectrum,
    placementBySpectrum: run.placementBySpectrum,
    /*
      The legality block travels in handle space too: the model echoes it, and its evidence keys
      have to be handles like every other id it sees. An item with no capture keeps its empty key.
    */
    legality: {
      clean: run.legality.clean,
      items: run.legality.items.map((item) => ({
        ...item,
        evidenceKey:
          item.evidenceKey === '' ? '' : (map.evidence.toHandle.get(item.evidenceKey) ?? item.evidenceKey),
      })),
    },
    observableConditionIds: run.observableConditionIds,
    knownHandles: run.knownHandles,
    /*
      The scope maps travel too, so the handle-space context is a faithful translation rather than a
      context with three fields left in the other alphabet.

      Nothing reads them here today — the answer schema constrains which ids exist, not which angle
      may cite which, and per-angle enums would put seven copies of the finding list in a document
      that was refused at ten kilobytes once already. Scope is `validateDraft`'s, on real ids. A
      half-translated context would be a trap for whatever reads this next.
    */
    heavyFailingFindingIds: mapIds(run.heavyFailingFindingIds, map, 'finding'),
    angleFindingIds: new Map(
      [...run.angleFindingIds].map(([angleId, ids]) => [
        map.angle.toHandle.get(angleId) ?? angleId,
        mapIds(ids, map, 'finding'),
      ]),
    ),
    conditionFindingIds: new Map(
      [...run.conditionFindingIds].map(([conditionId, ids]) => [
        conditionId,
        mapIds(ids, map, 'finding'),
      ]),
    ),
  };
}

/** A set of real ids as the handles that stand for them. */
function mapIds(ids: ReadonlySet<string>, map: HandleMap, kind: string): ReadonlySet<string> {
  return new Set([...ids].map((id) => toHandle(map, kind, id)));
}

export function storeHandles(map: HandleMap): StoredHandles {
  const asRecord = (handles: Handles): Record<string, string> =>
    Object.fromEntries([...handles.toId.entries()]);
  return {
    finding: asRecord(map.finding),
    evidence: asRecord(map.evidence),
    eye_test: asRecord(map.eyeTest),
    angle: asRecord(map.angle),
  };
}

/** What a decode could not resolve. Each one is a handle this run never issued. */
export interface UnknownHandle {
  readonly at: string;
  readonly kind: string;
  readonly handle: string;
}

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly unknown: readonly UnknownHandle[] };

interface RawCitation {
  readonly kind: string;
  readonly ref: string;
}

/**
 * Rewrites a draft from handle space into real ids.
 *
 * Returns the unresolved handles rather than throwing, and rather than leaving them in place: the
 * job turns them into the same kind of rejection message a bad citation already produces, so a
 * retry is told what it invented in the words it will understand.
 */
export function decodeDraft<T>(draft: T, map: HandleMap): DecodeResult<T> {
  const unknown: UnknownHandle[] = [];

  const citation = (raw: RawCitation, at: string): RawCitation => {
    const real = toId(map, raw.kind, raw.ref);
    if (real === null) {
      unknown.push({ at, kind: raw.kind, handle: raw.ref });
      return raw;
    }
    return { ...raw, ref: real };
  };

  const source = draft as Record<string, any>;
  const placement = source['placement'] as Record<string, any> | undefined;
  const legality = source['legality'] as Record<string, any> | undefined;
  const routing = source['routing'] as Record<string, any>[] | undefined;
  const angles = source['angles'] as Record<string, any>[] | undefined;
  const shoreUps = source['shoreUps'] as Record<string, any>[] | undefined;

  const decoded = {
    ...source,
    ...(placement === undefined
      ? {}
      : {
          placement: {
            ...placement,
            citations: (placement['citations'] ?? []).map((c: RawCitation, i: number) =>
              citation(c, `placement.citations[${i}]`),
            ),
          },
        }),
    ...(legality === undefined
      ? {}
      : {
          legality: {
            ...legality,
            items: (legality['items'] ?? []).map((item: Record<string, any>, i: number) => {
              // A `not_evaluable` legality rule recorded no capture, so it carries no handle either.
              if (String(item['evidenceKey'] ?? '') === '') return { ...item, evidenceKey: '' };
              const real = toId(map, 'evidence', String(item['evidenceKey']));
              if (real === null) {
                unknown.push({
                  at: `legality.items[${i}].evidenceKey`,
                  kind: 'evidence',
                  handle: String(item['evidenceKey']),
                });
                return item;
              }
              return { ...item, evidenceKey: real };
            }),
          },
        }),
    ...(routing === undefined
      ? {}
      : {
          routing: routing.map((row, i) => ({
            ...row,
            citations: (row['citations'] ?? []).map((c: RawCitation, j: number) =>
              citation(c, `routing[${i}].citations[${j}]`),
            ),
          })),
        }),
    ...(angles === undefined
      ? {}
      : {
          angles: angles.map((angle, i) => {
            const realAngle = toId(map, 'angle', String(angle['angleId']));
            if (realAngle === null) {
              unknown.push({ at: `angles[${i}].angleId`, kind: 'angle', handle: String(angle['angleId']) });
            }
            return {
              ...angle,
              ...(realAngle === null ? {} : { angleId: realAngle }),
              citations: (angle['citations'] ?? []).map((c: RawCitation, j: number) =>
                citation(c, `angles[${i}].citations[${j}]`),
              ),
            };
          }),
        }),
    ...(shoreUps === undefined
      ? {}
      : {
          shoreUps: shoreUps.map((shoreUp, i) => ({
            ...shoreUp,
            citation: citation(shoreUp['citation'] as RawCitation, `shoreUps[${i}].citation`),
          })),
        }),
  };

  return unknown.length > 0 ? { ok: false, unknown } : { ok: true, value: decoded as T };
}

/**
 * The unresolved handles, as a message a retry can act on.
 *
 * The kind moves to the end of the sentence. It read `is not a ${kind} handle in this run`, which
 * for the two kinds that begin with a vowel produced *"is not a evidence handle"* and *"is not a
 * eye_test handle"* — an article the interpolation cannot get right, in the one message whose whole
 * job is to be read carefully by a model being asked to try again.
 *
 * The wording now matches `unresolved_prose_handle` in the engine, which has always said *is not a
 * handle this run issued*. Two refusals for the same mistake said it two ways.
 */
export function unknownHandleMessage(unknown: readonly UnknownHandle[]): string {
  const lines = unknown.map(
    (u) => `- ${u.at}: '${u.handle}' is not a handle this run issued for ${u.kind}`,
  );
  return (
    `The previous draft used ${unknown.length} handle(s) this run did not issue. ` +
    'Cite only the handles listed against each angle, and return the whole document again:\n' +
    lines.join('\n')
  );
}
