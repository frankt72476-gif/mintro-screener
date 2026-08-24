/**
 * Ingest: receive, hash, detect, convert, extract, persist, resolve.
 *
 * Runs as a queued job on the worker, never in a serverless function (D-094). There is **no time
 * budget, no per-invocation cap and no second click** — the surveyed app's 12-second loop, its
 * four-document ceiling and its one-escalation-per-run rule are all timeout accounting for a
 * ~26 s proxy limit we do not have.
 *
 * The orchestration is here and the SQL is behind `IngestStore`, so the order of operations — the
 * part that has to be right — is testable without standing up a database. The order is
 * load-bearing in two places and both are called out where they happen.
 */

import { extract, EXTRACTOR_VERSION, sha256, sniff, type ExtractionResult } from '@mintro/extraction';
import type { PageImager, VisionClient } from '@mintro/extraction';
import { slotDefinition } from '@mintro/ruleset';

/** Slot states. Six, not five — D-078 as amended by D-107. */
export type SlotState =
  | 'satisfied'
  | 'not_provided'
  | 'waived'
  | 'superseded'
  | 'missing'
  | 'not_evaluable';

export interface SlotRow {
  readonly id: string;
  readonly packageId: string;
  readonly slotKey: string;
  readonly requiredCount: number | null;
  readonly state: SlotState;
  readonly reason: string | null;
}

export interface StoredVersion {
  readonly id: string;
  readonly documentId: string;
  readonly version: number;
  readonly sha256: string;
}

export interface NewVersion {
  readonly documentId: string;
  readonly packageId: string;
  readonly version: number;
  readonly supersedes: string | null;
  readonly sha256: string;
  readonly bytes: number;
  readonly detectedType: string;
  readonly storageKey: string;
  readonly originalSha256: string | null;
  readonly originalMediaType: string | null;
  readonly originalStorageKey: string | null;
  readonly originalFilename: string | null;
  readonly outcome: ExtractionResult['outcome'];
  readonly outcomeReason: string | null;
  readonly extraction: ExtractionResult;
}

export interface IngestStore {
  getSlot(slotId: string): Promise<SlotRow | null>;
  /** Dedup is content, not filename (D-091). Scoped to the package, matching the unique index. */
  findVersionByContent(packageId: string, contentHash: string): Promise<StoredVersion | null>;
  getCachedExtraction(contentHash: string, extractorVersion: string): Promise<ExtractionResult | null>;
  putCachedExtraction(contentHash: string, extractorVersion: string, result: ExtractionResult): Promise<void>;
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  createDocument(packageId: string, slotId: string): Promise<string>;
  latestVersionOf(documentId: string): Promise<StoredVersion | null>;
  insertVersion(row: NewVersion): Promise<StoredVersion>;
  /** Documents on a slot whose newest version is not superseded. Drives count satisfaction. */
  countLiveDocuments(slotId: string): Promise<number>;
  setSlotState(slotId: string, state: SlotState, reason: string | null): Promise<void>;
}

/** Converts HEIC to JPEG. Injected so the pipeline can be exercised without a codec (D-104). */
export interface HeicConverter {
  (bytes: Uint8Array): Promise<Uint8Array>;
}

export interface IngestDeps {
  readonly store: IngestStore;
  readonly pageImage?: PageImager;
  readonly vision?: VisionClient;
  /** Absent means HEIC resolves to `unsupported` with a reason — recorded, never silent (D-092). */
  readonly convertHeic?: HeicConverter;
}

export interface IngestRequest {
  readonly packageId: string;
  readonly slotId: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
  /**
   * Replace a specific document rather than add another to the slot.
   *
   * Absent, an upload is a **new document** — three bank statements are three documents, not three
   * versions of one. Present, it is a **new version** of that document with a `supersedes` pointer
   * and the prior version left readable (D-002, D-097).
   */
  readonly replacesDocumentId?: string;
}

export type IngestResult =
  | {
      readonly kind: 'ingested';
      readonly documentId: string;
      readonly versionId: string;
      readonly version: number;
      readonly outcome: ExtractionResult['outcome'];
      readonly outcomeReason: string | null;
      readonly extractionWasCached: boolean;
      readonly converted: boolean;
      readonly slotState: SlotState;
    }
  | {
      /** These exact bytes are already in this package. Not an error, and not a second read. */
      readonly kind: 'duplicate';
      readonly documentId: string;
      readonly versionId: string;
      readonly slotState: SlotState;
    };

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function objectKey(packageId: string, contentHash: string, suffix: string): string {
  // Content-addressed and package-scoped. The key is a fact about the bytes, so a re-upload
  // resolves to the same object rather than a second copy of it.
  return `${packageId}/${contentHash}${suffix}`;
}

/**
 * Resolve a slot's state from what it now holds.
 *
 * Deliberately narrow: this only ever moves a slot between `missing`, `satisfied` and
 * `not_evaluable`. `not_provided` and `waived` are operator decisions carrying a reason, and an
 * upload must never quietly clear one — if a slot was waived and a document arrives, that is a
 * conversation, not a state transition.
 */
export function resolveSlotState(slot: SlotRow, liveDocuments: number): SlotState {
  if (slot.state === 'not_provided' || slot.state === 'waived') return slot.state;

  // Unknown count. Not zero, not one: we do not know how many to expect, so we cannot say any are
  // absent (D-107). `missing` would assert we know what to chase.
  if (slot.requiredCount === null) return 'not_evaluable';

  return liveDocuments >= slot.requiredCount ? 'satisfied' : 'missing';
}

/**
 * Ingest one file.
 *
 * Never throws for anything about the *document* — an unreadable scan, an unsupported type and an
 * encrypted PDF are all recorded outcomes (D-092). It throws only when the *request* is wrong: an
 * unknown slot, or bytes that belong to another package.
 */
export async function ingestDocument(request: IngestRequest, deps: IngestDeps): Promise<IngestResult> {
  const { store } = deps;

  const slot = await store.getSlot(request.slotId);
  if (slot === null) throw new IngestError(`slot ${request.slotId} does not exist`);
  if (slot.packageId !== request.packageId) {
    throw new IngestError(`slot ${request.slotId} does not belong to package ${request.packageId}`);
  }

  // 1 — hash what arrived, before anything touches it. This is the merchant's submission and it
  // is what constraint 3 requires be retained, whatever we later derive from it.
  const receivedHash = sha256(request.bytes);
  const receivedType = sniff(request.bytes);

  // 2 — convert HEIC, and keep the original (D-104). packages/extraction stays format-pure and
  // never sees HEIC: making its contract true is this layer's job, not its own.
  let content = request.bytes;
  let contentType = receivedType;
  let converted = false;
  let originalStorageKey: string | null = null;
  let originalHash: string | null = null;
  let originalMediaType: string | null = null;

  if (receivedType === 'heic') {
    if (deps.convertHeic === undefined) {
      // No codec configured. Still an outcome with a reason, still visible, still chaseable —
      // the M0 behaviour, which D-104 records as correct until the conversion exists.
      return await recordUnconvertible(request, slot, receivedHash, deps);
    }
    content = await deps.convertHeic(request.bytes);
    converted = true;
    originalHash = receivedHash;
    originalMediaType = 'image/heic';
    originalStorageKey = objectKey(request.packageId, receivedHash, '.heic');
    contentType = sniff(content);
    if (contentType !== 'jpeg' && contentType !== 'png') {
      throw new IngestError(`HEIC conversion produced ${contentType}, not an image the extractor accepts`);
    }
  }

  const contentHash = sha256(content);

  // 3 — dedup on content (D-091). The same bytes twice are one document, and the second upload
  // costs no extraction at all — not a cache hit, no work.
  const existing = await store.findVersionByContent(request.packageId, contentHash);
  if (existing !== null) {
    const live = await store.countLiveDocuments(request.slotId);
    const state = resolveSlotState(slot, live);
    await store.setSlotState(request.slotId, state, slot.reason);
    return { kind: 'duplicate', documentId: existing.documentId, versionId: existing.id, slotState: state };
  }

  // 4 — extract, cache first (D-096). A package re-run after one new upload must not re-read the
  // other eight, and the cache is durable because a worker restart between the two is normal.
  const cached = await store.getCachedExtraction(contentHash, EXTRACTOR_VERSION);
  let extraction: ExtractionResult;
  let extractionWasCached = false;
  if (cached !== null) {
    extraction = { ...cached, cached: true };
    extractionWasCached = true;
  } else {
    extraction = await extract(content, request.filename, {
      ...(deps.pageImage === undefined ? {} : { pageImage: deps.pageImage }),
      ...(deps.vision === undefined ? {} : { vision: deps.vision }),
    });
    await store.putCachedExtraction(contentHash, EXTRACTOR_VERSION, extraction);
  }

  // 5 — objects before rows. A stored object with no row is orphaned bytes; a row pointing at an
  // object that was never written is a document the report cannot show. Only one of those is
  // recoverable, so the unrecoverable one is the order that never happens.
  await store.putObject(
    objectKey(request.packageId, contentHash, suffixFor(contentType)),
    content,
    CONTENT_TYPES[contentType] ?? 'application/octet-stream',
  );
  if (originalStorageKey !== null) {
    await store.putObject(originalStorageKey, request.bytes, 'image/heic');
  }

  // 6 — a new document, or a new version of a named one.
  let documentId: string;
  let version = 1;
  let supersedes: string | null = null;
  if (request.replacesDocumentId !== undefined) {
    documentId = request.replacesDocumentId;
    const previous = await store.latestVersionOf(documentId);
    if (previous === null) throw new IngestError(`document ${documentId} has no version to replace`);
    version = previous.version + 1;
    supersedes = previous.id;
  } else {
    documentId = await store.createDocument(request.packageId, request.slotId);
  }

  const stored = await store.insertVersion({
    documentId,
    packageId: request.packageId,
    version,
    supersedes,
    sha256: contentHash,
    bytes: content.byteLength,
    detectedType: contentType,
    storageKey: objectKey(request.packageId, contentHash, suffixFor(contentType)),
    originalSha256: originalHash,
    originalMediaType,
    originalStorageKey,
    originalFilename: request.filename,
    outcome: extraction.outcome,
    outcomeReason: extraction.reason,
    extraction,
  });

  // 7 — resolve the slot last, from what the package now holds.
  const live = await store.countLiveDocuments(request.slotId);
  const slotState = resolveSlotState(slot, live);
  await store.setSlotState(request.slotId, slotState, slot.reason);

  return {
    kind: 'ingested',
    documentId,
    versionId: stored.id,
    version,
    outcome: extraction.outcome,
    outcomeReason: extraction.reason,
    extractionWasCached,
    converted,
    slotState,
  };
}

function suffixFor(type: string): string {
  switch (type) {
    case 'pdf': return '.pdf';
    case 'jpeg': return '.jpg';
    case 'png': return '.png';
    case 'gif': return '.gif';
    case 'webp': return '.webp';
    default: return '.bin';
  }
}

/**
 * A HEIC that arrived with no converter configured.
 *
 * Recorded as a document version with outcome `unsupported`, not dropped — the operator has to be
 * able to see it and re-request, which is the whole of D-092. The bytes are stored too: they are
 * the merchant's submission whether or not we can read them.
 */
async function recordUnconvertible(
  request: IngestRequest,
  slot: SlotRow,
  contentHash: string,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { store } = deps;
  const existing = await store.findVersionByContent(request.packageId, contentHash);
  if (existing !== null) {
    const live = await store.countLiveDocuments(request.slotId);
    const state = resolveSlotState(slot, live);
    return { kind: 'duplicate', documentId: existing.documentId, versionId: existing.id, slotState: state };
  }

  const key = objectKey(request.packageId, contentHash, '.heic');
  await store.putObject(key, request.bytes, 'image/heic');
  const documentId = await store.createDocument(request.packageId, request.slotId);

  const reason =
    'heic: no HEIC converter is configured on this worker; the file was stored but not read (D-104)';
  const result: ExtractionResult = {
    outcome: 'unsupported',
    reason,
    pages: [],
    values: [],
    hash: contentHash,
    extractor_version: EXTRACTOR_VERSION,
    cached: false,
    detected_type: 'heic',
  };

  const stored = await store.insertVersion({
    documentId,
    packageId: request.packageId,
    version: 1,
    supersedes: null,
    sha256: contentHash,
    bytes: request.bytes.byteLength,
    detectedType: 'heic',
    storageKey: key,
    originalSha256: null,
    originalMediaType: null,
    originalStorageKey: null,
    originalFilename: request.filename,
    outcome: 'unsupported',
    outcomeReason: reason,
    extraction: result,
  });

  const live = await store.countLiveDocuments(request.slotId);
  const slotState = resolveSlotState(slot, live);
  await store.setSlotState(request.slotId, slotState, slot.reason);

  return {
    kind: 'ingested',
    documentId,
    versionId: stored.id,
    version: 1,
    outcome: 'unsupported',
    outcomeReason: reason,
    extractionWasCached: false,
    converted: false,
    slotState,
  };
}

export { slotDefinition };
