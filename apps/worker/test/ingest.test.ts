/**
 * The ingest pipeline's order of operations, tested without a database.
 *
 * The fake store counts what it is asked to do, which is what makes the cost rules assertable:
 * "the same bytes twice cost one extraction" and "a package re-run after one new upload re-reads
 * nothing" are counts here, not intentions.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { EXTRACTOR_VERSION, sha256, type ExtractionResult } from '@mintro/extraction';
import {
  ingestDocument,
  resolveSlotState,
  type IngestStore,
  type NewVersion,
  type SlotRow,
  type SlotState,
  type StoredVersion,
} from '../src/ingest.js';

async function pdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(`Business Legal Name: ${text}`, { x: 50, y: 700, size: 11, font });
  page.drawText('EIN: 47-2841903', { x: 50, y: 675, size: 11, font });
  return doc.save();
}

function heic(): Uint8Array {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(24, 0);
  header.write('ftyp', 4, 'ascii');
  header.write('heic', 8, 'ascii');
  header.write('heicmif1', 16, 'ascii');
  return new Uint8Array(header);
}

interface Counts {
  extractionsWritten: number;
  objectsWritten: number;
  documentsCreated: number;
}

function fakeStore(slots: SlotRow[]): {
  store: IngestStore;
  counts: Counts;
  versions: (NewVersion & { id: string })[];
  slotStates: Map<string, { state: SlotState; reason: string | null }>;
  objects: Map<string, Uint8Array>;
  cache: Map<string, ExtractionResult>;
} {
  const counts: Counts = { extractionsWritten: 0, objectsWritten: 0, documentsCreated: 0 };
  const versions: (NewVersion & { id: string })[] = [];
  const documents = new Map<string, { packageId: string; slotId: string }>();
  const slotStates = new Map<string, { state: SlotState; reason: string | null }>();
  const objects = new Map<string, Uint8Array>();
  const cache = new Map<string, ExtractionResult>();
  const byId = new Map(slots.map((s) => [s.id, s]));

  let nextDoc = 0;
  let nextVersion = 0;

  const store: IngestStore = {
    async getSlot(slotId) {
      const slot = byId.get(slotId);
      if (slot === undefined) return null;
      const override = slotStates.get(slotId);
      return override === undefined ? slot : { ...slot, state: override.state, reason: override.reason };
    },
    async findVersionByContent(packageId, contentHash) {
      const hit = versions.find((v) => v.packageId === packageId && v.sha256 === contentHash);
      return hit === undefined ? null : { id: hit.id, documentId: hit.documentId, version: hit.version, sha256: hit.sha256 };
    },
    async getCachedExtraction(hash, version) {
      return cache.get(`${hash}:${version}`) ?? null;
    },
    async putCachedExtraction(hash, version, result) {
      counts.extractionsWritten++;
      cache.set(`${hash}:${version}`, result);
    },
    async putObject(key, bytes) {
      counts.objectsWritten++;
      objects.set(key, bytes);
    },
    async createDocument(packageId, slotId) {
      counts.documentsCreated++;
      const id = `doc-${++nextDoc}`;
      documents.set(id, { packageId, slotId });
      return id;
    },
    async latestVersionOf(documentId) {
      const all = versions.filter((v) => v.documentId === documentId).sort((a, b) => b.version - a.version);
      const top = all[0];
      return top === undefined ? null : { id: top.id, documentId, version: top.version, sha256: top.sha256 };
    },
    async insertVersion(row) {
      const id = `ver-${++nextVersion}`;
      versions.push({ ...row, id });
      const stored: StoredVersion = { id, documentId: row.documentId, version: row.version, sha256: row.sha256 };
      return stored;
    },
    async countLiveDocuments(slotId) {
      const ids = [...documents.entries()].filter(([, d]) => d.slotId === slotId).map(([id]) => id);
      return ids.length;
    },
    async setSlotState(slotId, state, reason) {
      slotStates.set(slotId, { state, reason });
    },
  };

  return { store, counts, versions, slotStates, objects, cache };
}


/**
 * Stands in for the one gate (D-114). Everything reaching the vision client comes through here —
 * a converted HEIC included, which is the point: the gate is where the size and orientation
 * constraints live, so nothing can arrive at the model having skipped them.
 */
function fakePageImager(): { fn: (b: Uint8Array, n: number) => Promise<{ media_type: 'image/jpeg'; bytes: Uint8Array; width: number; height: number }>; sawBytes: Uint8Array[] } {
  const sawBytes: Uint8Array[] = [];
  return {
    sawBytes,
    fn: async (bytes) => {
      sawBytes.push(bytes);
      return { media_type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1500, height: 1000 };
    },
  };
}

const PKG = 'pkg-1';
const slot = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: 'slot-1',
  packageId: PKG,
  slotKey: 'ein_letter',
  requiredCount: 1,
  state: 'missing',
  reason: null,
  ...over,
});

describe('dedup: the same bytes twice are one document', () => {
  it('does not extract a second time and does not create a second document', async () => {
    const fake = fakeStore([slot()]);
    const bytes = await pdf('Northwind Peptides LLC');

    const first = await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'a.pdf', bytes }, { store: fake.store });
    const second = await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'again.pdf', bytes }, { store: fake.store });

    expect(first.kind).toBe('ingested');
    expect(second.kind).toBe('duplicate');
    expect(fake.counts.documentsCreated).toBe(1);
    expect(fake.versions).toHaveLength(1);
    // Not "one cache hit" — no second read of any kind. Dedup happens before extraction.
    expect(fake.counts.extractionsWritten).toBe(1);
  });

  it('dedups on content, not on filename (D-091)', async () => {
    const fake = fakeStore([slot()]);
    const bytes = await pdf('Northwind Peptides LLC');
    await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'scan.pdf', bytes }, { store: fake.store });
    const again = await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'Scan 1 (2).pdf', bytes }, { store: fake.store });
    expect(again.kind).toBe('duplicate');
  });
});

describe('cache: re-running a package after one new upload re-reads nothing', () => {
  it('extracts once per distinct document across a re-run', async () => {
    const fake = fakeStore([slot({ requiredCount: 9 })]);
    const nine = await Promise.all(Array.from({ length: 9 }, (_, i) => pdf(`Merchant ${i}`)));

    for (const bytes of nine) {
      await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'x.pdf', bytes }, { store: fake.store });
    }
    expect(fake.counts.extractionsWritten).toBe(9);

    // A tenth document arrives. The other nine are already in the package and already cached.
    const tenth = await pdf('Merchant 10');
    await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'x.pdf', bytes: tenth }, { store: fake.store });
    expect(fake.counts.extractionsWritten).toBe(10);
  });

  it('serves a cached extraction for the same content in a different package', async () => {
    const fake = fakeStore([
      slot({ id: 'slot-a', packageId: 'pkg-a' }),
      slot({ id: 'slot-b', packageId: 'pkg-b' }),
    ]);
    const bytes = await pdf('Northwind Peptides LLC');

    await ingestDocument({ packageId: 'pkg-a', slotId: 'slot-a', filename: 'a.pdf', bytes }, { store: fake.store });
    const second = await ingestDocument({ packageId: 'pkg-b', slotId: 'slot-b', filename: 'a.pdf', bytes }, { store: fake.store });

    // Same bytes, different package: a new immutable record is written, and it is written from a
    // cache hit rather than a second read. The cache serves results *into* a record; it never
    // makes two packages share one (D-096).
    expect(second.kind).toBe('ingested');
    if (second.kind === 'ingested') expect(second.extractionWasCached).toBe(true);
    expect(fake.counts.extractionsWritten).toBe(1);
    expect(fake.versions).toHaveLength(2);
  });

  it('keys the cache on extractor version as well as content', async () => {
    const fake = fakeStore([slot()]);
    const bytes = await pdf('Northwind Peptides LLC');
    await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'a.pdf', bytes }, { store: fake.store });
    expect([...fake.cache.keys()]).toEqual([`${sha256(bytes)}:${EXTRACTOR_VERSION}`]);
  });
});

describe('supersession: a replacement is a new version', () => {
  it('chains to the prior version and leaves it in place', async () => {
    const fake = fakeStore([slot()]);
    const first = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'v1.pdf', bytes: await pdf('Northwind Peptides LLC') },
      { store: fake.store },
    );
    if (first.kind !== 'ingested') throw new Error('expected an ingest');

    const second = await ingestDocument(
      {
        packageId: PKG,
        slotId: 'slot-1',
        filename: 'v2.pdf',
        bytes: await pdf('Northwind Peptides LLC (corrected)'),
        replacesDocumentId: first.documentId,
      },
      { store: fake.store },
    );
    if (second.kind !== 'ingested') throw new Error('expected an ingest');

    expect(second.documentId).toBe(first.documentId);
    expect(second.version).toBe(2);
    expect(fake.versions[1]?.supersedes).toBe(first.versionId);
    // Both rows are still there, and the first one's object was never overwritten.
    expect(fake.versions).toHaveLength(2);
    expect(fake.counts.documentsCreated).toBe(1);
    expect(fake.objects.size).toBe(2);
  });

  it('an upload without a replacement target is a new document, not a new version', async () => {
    const fake = fakeStore([slot({ slotKey: 'bank_statement', requiredCount: 3 })]);
    for (const month of ['January', 'February', 'March']) {
      await ingestDocument(
        { packageId: PKG, slotId: 'slot-1', filename: `${month}.pdf`, bytes: await pdf(month) },
        { store: fake.store },
      );
    }
    // Three statements are three documents. Treating them as versions of one would make the
    // count unsatisfiable and would say the merchant replaced January with March.
    expect(fake.counts.documentsCreated).toBe(3);
    expect(fake.versions.every((v) => v.version === 1)).toBe(true);
  });
});

describe('slot state', () => {
  it('satisfies a slot only when the count is met', async () => {
    const fake = fakeStore([slot({ slotKey: 'bank_statement', requiredCount: 3 })]);
    const states: SlotState[] = [];
    for (const month of ['January', 'February', 'March']) {
      const r = await ingestDocument(
        { packageId: PKG, slotId: 'slot-1', filename: `${month}.pdf`, bytes: await pdf(month) },
        { store: fake.store },
      );
      states.push(r.slotState);
    }
    // `missing` is the only state meaning chase this (D-078), and 1-of-3 is chase this.
    expect(states).toEqual(['missing', 'missing', 'satisfied']);
  });

  /**
   * The reason the sixth state exists. Owner Photo ID takes its count from the application's
   * ownership section; until that is read the count is unknown, and unknown is not zero.
   */
  it('reports not_evaluable, never missing, when the required count is unknown', () => {
    const unknown = slot({ slotKey: 'owner_photo_id', requiredCount: null });
    expect(resolveSlotState(unknown, 0)).toBe('not_evaluable');
    expect(resolveSlotState(unknown, 2)).toBe('not_evaluable');
    // Specifically not `missing`: missing asserts we know what to chase.
    expect(resolveSlotState(unknown, 0)).not.toBe('missing');
  });

  it('becomes evaluable once the count is known', () => {
    expect(resolveSlotState(slot({ slotKey: 'owner_photo_id', requiredCount: 2 }), 1)).toBe('missing');
    expect(resolveSlotState(slot({ slotKey: 'owner_photo_id', requiredCount: 2 }), 2)).toBe('satisfied');
  });

  it('an upload never quietly clears an operator decision', async () => {
    const fake = fakeStore([slot({ state: 'waived', reason: 'processor_confirmed_not_required' })]);
    const result = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'a.pdf', bytes: await pdf('Northwind') },
      { store: fake.store },
    );
    // A waived slot receiving a document is a conversation, not a state transition.
    expect(result.slotState).toBe('waived');
    expect(fake.slotStates.get('slot-1')?.reason).toBe('processor_confirmed_not_required');
  });
});

describe('every file resolves to a recorded outcome (D-092)', () => {
  it('records an unsupported type as a document, visible and chaseable', async () => {
    const fake = fakeStore([slot()]);
    const html = new Uint8Array(Buffer.from('<!doctype html><html><body>404</body></html>', 'utf8'));

    const result = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'statement.pdf', bytes: html },
      { store: fake.store },
    );

    expect(result.kind).toBe('ingested');
    if (result.kind !== 'ingested') throw new Error('unreachable');
    expect(result.outcome).toBe('unsupported');
    expect(result.outcomeReason).toMatch(/html/);
    // It exists as a row an operator can see. A silent skip would leave the slot looking simply
    // empty, which is indistinguishable from nobody having uploaded anything.
    expect(fake.versions).toHaveLength(1);
    expect(fake.versions[0]?.outcome).toBe('unsupported');
  });

  it('records an encrypted PDF as encrypted, not unreadable', async () => {
    const fake = fakeStore([slot()]);
    const { encryptedPdf } = await import('../../../packages/extraction/test/fixtures.js');

    const result = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'statement.pdf', bytes: encryptedPdf() },
      { store: fake.store },
    );

    if (result.kind !== 'ingested') throw new Error('unreachable');
    expect(result.outcome).toBe('encrypted');
    expect(result.outcomeReason).toMatch(/password/i);
  });

  it('stores the bytes even when it cannot read them', async () => {
    const fake = fakeStore([slot()]);
    const html = new Uint8Array(Buffer.from('<!doctype html><html></html>', 'utf8'));
    await ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'x.pdf', bytes: html }, { store: fake.store });
    expect(fake.objects.size).toBe(1);
  });
});

describe('HEIC through the pipeline (D-104)', () => {
  it('converts, extracts the JPEG, and retains the original', async () => {
    const fake = fakeStore([slot({ slotKey: 'owner_photo_id', requiredCount: 1 })]);
    const original = heic();
    const jpeg = new Uint8Array(Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'));

    const result = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'IMG_4021.HEIC', bytes: original },
      {
        store: fake.store,
        convertHeic: async () => jpeg,
        pageImage: fakePageImager().fn,
        vision: async () => ({ text: JSON.stringify({ fields: [] }) }),
      },
    );

    if (result.kind !== 'ingested') throw new Error('unreachable');
    expect(result.converted).toBe(true);
    expect(result.outcome).toBe('extracted');

    const row = fake.versions[0];
    // The stored, readable content is the JPEG…
    expect(row?.detectedType).toBe('jpeg');
    expect(row?.sha256).toBe(sha256(jpeg));
    // …and the submission is retained beside it. Constraint 3: a report citing a value must point
    // at what the merchant sent, not only at a rendering we made from it.
    expect(row?.originalSha256).toBe(sha256(original));
    expect(row?.originalMediaType).toBe('image/heic');
    expect(row?.originalStorageKey).toMatch(/\.heic$/);
    expect(fake.objects.size).toBe(2);
  });

  it('packages/extraction never receives HEIC', async () => {
    const fake = fakeStore([slot()]);
    const seen: string[] = [];
    const imager = fakePageImager();
    await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'IMG.HEIC', bytes: heic() },
      {
        store: fake.store,
        convertHeic: async (bytes) => {
          seen.push('converter');
          expect(bytes[4]).toBe(0x66); // 'f' of ftyp — the converter gets the HEIC
          return new Uint8Array(Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'));
        },
        pageImage: imager.fn,
        vision: async () => ({ text: JSON.stringify({ fields: [] }) }),
      },
    );
    expect(seen).toEqual(['converter']);
    // The extractor's contract is "a PDF or one of four image types". Making that true is ingest's
    // job, and the recorded detected_type is the proof it was done before the handoff.
    expect(fake.versions[0]?.detectedType).toBe('jpeg');
    // And the converted JPEG still went through the gate rather than straight to the model — a
    // converted HEIC is a phone photograph, so it is exactly the case D-114 exists for.
    expect(imager.sawBytes).toHaveLength(1);
  });

  it('records HEIC as unsupported-with-reason when no converter is configured', async () => {
    const fake = fakeStore([slot()]);
    const result = await ingestDocument(
      { packageId: PKG, slotId: 'slot-1', filename: 'IMG.HEIC', bytes: heic() },
      { store: fake.store },
    );

    if (result.kind !== 'ingested') throw new Error('unreachable');
    expect(result.outcome).toBe('unsupported');
    expect(result.outcomeReason).toMatch(/no HEIC converter is configured/);
    // Stored, visible, chaseable — the M0 behaviour D-104 records as correct until the conversion
    // exists, rather than a silent drop.
    expect(fake.objects.size).toBe(1);
    expect(fake.versions).toHaveLength(1);
  });
});

describe('the request is validated even though the document never is', () => {
  it('throws for an unknown slot', async () => {
    const fake = fakeStore([]);
    await expect(
      ingestDocument({ packageId: PKG, slotId: 'nope', filename: 'a.pdf', bytes: await pdf('x') }, { store: fake.store }),
    ).rejects.toThrow(/does not exist/);
  });

  it('throws when the slot belongs to another package', async () => {
    const fake = fakeStore([slot({ packageId: 'other' })]);
    await expect(
      ingestDocument({ packageId: PKG, slotId: 'slot-1', filename: 'a.pdf', bytes: await pdf('x') }, { store: fake.store }),
    ).rejects.toThrow(/does not belong to package/);
  });
});
