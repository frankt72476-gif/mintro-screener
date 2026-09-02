/**
 * The upload queue: claiming, and what a request looks like when it is over.
 *
 * The distinction under test throughout is between **a document that could not be read** and **an
 * upload that failed**. The first is a recorded outcome on a version and a `done` request (D-092);
 * the second is a `failed` request. Collapsing them hides a re-requestable scan behind a queue
 * error, and an operator who cannot see that a scan failed to read will not re-request it.
 */

import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { claimNextUpload, runUpload, type UploadRequest } from '../src/uploadJob.js';
import type { IngestStore, NewVersion, SlotRow, SlotState, StoredVersion } from '../src/ingest.js';
import type { WorkerSupabase } from '../src/store/supabase.js';

async function pdfBytes(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(`Business Legal Name: ${text}`, { x: 50, y: 700, size: 11, font });
  return doc.save();
}

interface Recorded {
  table: string;
  patch: Record<string, unknown>;
  eq: Record<string, unknown>;
}

/**
 * The smallest thing that answers the PostgREST calls these functions make.
 *
 * Deliberately minimal — a richer fake would be modelling Supabase rather than testing against it,
 * and a rich fake is how you end up testing the fake. The SQL semantics are covered separately, in
 * `test/schema/`, against a real Postgres.
 */
function fakeSupabase(options: {
  queued?: UploadRequest[];
  claimWins?: boolean;
  staged?: Uint8Array | null;
  /**
   * The roster row the claim re-reads (D-230, 0069).
   *
   * Defaults to an active analyst holding the capability, because that is what every test here
   * other than the gate's own is about. `null` stands for a person whose row could not be found at
   * all, which the gate treats as not holding it.
   */
  requester?: { can_run_documents_check: boolean; status: string; active: boolean } | null;
}): { supabase: WorkerSupabase; writes: Recorded[] } {
  const writes: Recorded[] = [];
  const queued = options.queued ?? [];
  const claimWins = options.claimWins ?? true;
  const requester =
    options.requester === undefined
      ? { can_run_documents_check: true, status: 'active', active: true }
      : options.requester;

  const from = (table: string): Record<string, unknown> => {
    /*
      The roster read the capability gate makes.

      Its own branch rather than another case in the chain below: the queue builder answers
      `.limit()` and a bare await with queue rows, and threading a second shape through it would make
      both harder to read than the two are apart. Still minimal — one select, one eq, one
      maybeSingle, which is exactly what `holdsCapability` issues.
    */
    if (table === 'analysts') {
      const roster = {
        select: () => roster,
        eq: () => roster,
        maybeSingle: async () => ({ data: requester, error: null }),
      };
      return roster as unknown as Record<string, unknown>;
    }

    const builder: Record<string, unknown> = {};
    let pendingPatch: Record<string, unknown> | null = null;
    const eq: Record<string, unknown> = {};

    const chain = {
      select: () => chain,
      or: () => chain,
      order: () => chain,
      limit: async () => ({ data: queued.slice(0, 1), error: null }),
      update(patch: Record<string, unknown>) {
        pendingPatch = patch;
        return chain;
      },
      eq(column: string, value: unknown) {
        eq[column] = value;
        return chain;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        // A bare `await` on the builder — the shape `runUpload`'s close uses.
        if (pendingPatch !== null) writes.push({ table, patch: pendingPatch, eq: { ...eq } });
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };

    (chain as unknown as { select: (s?: string) => unknown }).select = (): unknown => ({
      ...chain,
      limit: async () => {
        if (pendingPatch !== null) {
          writes.push({ table, patch: pendingPatch, eq: { ...eq } });
          return { data: claimWins ? queued.slice(0, 1) : [], error: null };
        }
        return { data: queued.slice(0, 1), error: null };
      },
      or: () => chain.select(),
      order: () => chain.select(),
      eq: (c: string, v: unknown) => {
        eq[c] = v;
        return chain.select();
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (pendingPatch !== null) writes.push({ table, patch: pendingPatch, eq: { ...eq } });
        return Promise.resolve({ data: claimWins ? queued.slice(0, 1) : [], error: null }).then(resolve);
      },
    });

    Object.assign(builder, chain);
    return builder;
  };

  const supabase = {
    bucket: 'documents',
    client: {
      from,
      storage: {
        from: () => ({
          async download() {
            const staged = options.staged;
            if (staged === undefined || staged === null) {
              return { data: null, error: { message: 'Object not found' } };
            }
            return { data: { arrayBuffer: async () => staged.buffer.slice(0) }, error: null };
          },
          async upload() {
            return { error: null };
          },
        }),
      },
    },
  } as unknown as WorkerSupabase;

  return { supabase, writes };
}

const REQUEST: UploadRequest = {
  id: 'up-1',
  package_id: 'pkg-1',
  slot_id: 'slot-1',
  replaces_document_id: null,
  staging_key: 'pkg-1/staging/abc',
  original_filename: 'ein-letter.pdf',
  status: 'queued',
  claimed_at: null,
  requested_by: 'analyst-1',
};

function fakeStore(overrides: Partial<IngestStore> = {}): IngestStore {
  const slot: SlotRow = {
    id: 'slot-1',
    packageId: 'pkg-1',
    slotKey: 'ein_letter',
    requiredCount: 1,
    state: 'missing',
    reason: null,
  };
  let versions = 0;
  const base: IngestStore = {
    async getSlot() { return slot; },
    async findVersionByContent() { return null; },
    async getCachedExtraction() { return null; },
    async putCachedExtraction() { /* no cache in these tests */ },
    async putObject() { /* stored */ },
    async createDocument() { return 'doc-1'; },
    async latestVersionOf() { return null; },
    async insertVersion(row: NewVersion): Promise<StoredVersion> {
      versions += 1;
      return { id: `ver-${versions}`, documentId: row.documentId, version: row.version, sha256: row.sha256 };
    },
    async countLiveDocuments() { return 1; },
    async setSlotState(_id: string, _state: SlotState) { /* recorded elsewhere */ },
  };
  return { ...base, ...overrides };
}

describe('claiming', () => {
  it('takes the oldest queued request', async () => {
    const { supabase } = fakeSupabase({ queued: [REQUEST] });
    const claimed = await claimNextUpload(supabase, 60_000);
    expect(claimed?.id).toBe('up-1');
  });

  it('returns null rather than throwing when the queue is empty', async () => {
    const { supabase } = fakeSupabase({ queued: [] });
    // "The queue is empty" and "I could not read the queue" are different states, and conflating
    // them is D-036. Empty is an answer.
    expect(await claimNextUpload(supabase, 60_000)).toBeNull();
  });

  it('comes back empty-handed when another worker won the race', async () => {
    const { supabase } = fakeSupabase({ queued: [REQUEST], claimWins: false });
    // The claim is a compare-and-swap: if the status moved since the read, the update matches
    // nothing and this worker moves on rather than doing the work twice.
    expect(await claimNextUpload(supabase, 60_000)).toBeNull();
  });

  /*
    The fourth gate, end to end on the claim (D-230, 0069).

    The job was queued while its requester held Documents Check — `document_uploads_insert` said so
    at the time, correctly. The owner then revoked it. Nothing in the first three gates can see
    this: the nav item and the route guard decided at a different moment, and the insert policy has
    already run. The worker re-reads at claim, and this is that.
  */
  it('ABANDONS a queued job whose requester lost the capability, and records why', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { supabase, writes } = fakeSupabase({
      queued: [REQUEST],
      requester: { can_run_documents_check: false, status: 'active', active: true },
    });

    const claimed = await claimNextUpload(supabase, 60_000);
    log.mockRestore();

    // No job comes back, so nothing downstream can run it — `runUpload` is unreachable for this row.
    expect(claimed).toBeNull();

    /*
      And the row is terminal with a reason on it, rather than left `running` for the stale reclaim
      to pick up again in five minutes. A revocation that produced a job retrying forever would be a
      gate that generated work instead of stopping it.
    */
    const refusal = writes.find((w) => w.patch['status'] === 'refused');
    expect(refusal, 'the refused row was never written').toBeDefined();
    expect(refusal!.table).toBe('document_uploads');
    expect(refusal!.eq['id']).toBe('up-1');
    expect(refusal!.patch['error']).toMatch(/no longer has Documents Check/);
    expect(refusal!.patch['finished_at']).toEqual(expect.any(String));
  });

  it('claims normally when the capability is still held, so the test above is a denial', async () => {
    // The other half of the pair. Without it, "returns null" would be satisfied by a claim that
    // never worked at all.
    const { supabase, writes } = fakeSupabase({
      queued: [REQUEST],
      requester: { can_run_documents_check: true, status: 'active', active: true },
    });
    expect((await claimNextUpload(supabase, 60_000))?.id).toBe('up-1');
    expect(writes.find((w) => w.patch['status'] === 'refused')).toBeUndefined();
  });
});

describe('a document that could not be read is a done request', () => {
  it('closes as done and points at the version, for an unsupported type', async () => {
    const html = new Uint8Array(Buffer.from('<!doctype html><html></html>', 'utf8'));
    const { supabase, writes } = fakeSupabase({ staged: html });

    await runUpload(supabase, REQUEST, { store: fakeStore() });

    const close = writes.find((w) => w.table === 'document_uploads');
    expect(close?.patch['status']).toBe('done');
    expect(close?.patch['document_version_id']).toBe('ver-1');
    // The *document* is unsupported; the *upload* worked. An operator sees a row they can
    // re-request against, not a queue error with nothing behind it.
    expect(close?.patch['error']).toBeUndefined();
  });

  it('closes as done for a readable document', async () => {
    const { supabase, writes } = fakeSupabase({ staged: await pdfBytes('Northwind Peptides LLC') });
    await runUpload(supabase, REQUEST, { store: fakeStore() });
    expect(writes.find((w) => w.table === 'document_uploads')?.patch['status']).toBe('done');
  });

  it('closes as done when the bytes were already in the package', async () => {
    const { supabase, writes } = fakeSupabase({ staged: await pdfBytes('Northwind Peptides LLC') });
    await runUpload(supabase, REQUEST, {
      store: fakeStore({
        async findVersionByContent() {
          return { id: 'ver-existing', documentId: 'doc-existing', version: 1, sha256: 'x'.repeat(64) };
        },
      }),
    });

    const close = writes.find((w) => w.table === 'document_uploads');
    // A duplicate is a success: the request points at the version already holding those bytes
    // rather than inventing a second one (D-091).
    expect(close?.patch['status']).toBe('done');
    expect(close?.patch['document_version_id']).toBe('ver-existing');
  });
});

describe('a request that itself went wrong is a failed request', () => {
  it('records why when the staged bytes are missing', async () => {
    const { supabase, writes } = fakeSupabase({ staged: null });

    await runUpload(supabase, REQUEST, { store: fakeStore() });

    const close = writes.find((w) => w.table === 'document_uploads');
    expect(close?.patch['status']).toBe('failed');
    expect(String(close?.patch['error'])).toMatch(/staged bytes are missing/);
    expect(close?.patch['finished_at']).toBeTruthy();
  });

  it('records why when the slot has gone', async () => {
    const { supabase, writes } = fakeSupabase({ staged: await pdfBytes('x') });

    await runUpload(supabase, REQUEST, {
      store: fakeStore({ async getSlot() { return null; } }),
    });

    const close = writes.find((w) => w.table === 'document_uploads');
    expect(close?.patch['status']).toBe('failed');
    expect(String(close?.patch['error'])).toMatch(/does not exist/);
  });

  it('never leaves a request in running', async () => {
    for (const staged of [null, await pdfBytes('x')]) {
      const { supabase, writes } = fakeSupabase({ staged });
      await runUpload(supabase, REQUEST, { store: fakeStore() });
      const close = writes.find((w) => w.table === 'document_uploads');
      // A row stuck in `running` with no record is the one state this queue exists to make
      // impossible — it is a scan that silently never happened, wearing a different table name.
      expect(['done', 'failed']).toContain(close?.patch['status']);
    }
  });
});
