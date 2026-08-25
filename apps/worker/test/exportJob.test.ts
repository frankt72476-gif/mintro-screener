/**
 * The export job (D-130, P6).
 *
 * Two properties matter more than the rest, and both are about where the archive lands.
 *
 * **It is staged outside the package prefix.** The purge reconciliation walks `{packageId}/` and
 * refuses on anything it cannot account for, so an archive parked there would block every purge of
 * the package it was taken for — the export making the purge impossible.
 *
 * **An archive that could not be recorded is removed.** A staged copy of every document body, under
 * a key no row points at, is the worst artifact this job could leave behind.
 */

import { describe, expect, it, vi } from 'vitest';
import { EXPORT_PREFIX, runExport, claimNextExportDiscard, runExportDiscard } from '../src/exportJob.js';

const PKG = 'pkg-1';
const REQUEST = { id: 'req-1', package_id: PKG, requested_by: 'analyst-1' };

const BODY = new TextEncoder().encode('%PDF-1.4 body');

/** Rows the job reads, and a record of every update it writes. */
function harness(over: { recordError?: string; uploadError?: string; noBody?: boolean; signError?: string } = {}) {
  const updates: Record<string, unknown>[] = [];
  const uploaded: { key: string; bytes: number }[] = [];
  const removed: string[][] = [];

  const rows: Record<string, Record<string, unknown>[]> = {
    packages: [{ id: PKG, merchant_id: 'm-1', processor_key: 'p', template_version: 'documents-1' }],
    slots: [{ id: 's-1', state: 'satisfied', reason: null, required_count: 1 }],
    documents: [{ id: 'd-1' }],
    document_versions: [{
      id: 'v-1', storage_key: `${PKG}/a.pdf`, sha256: 'a'.repeat(64),
      original_storage_key: null, original_sha256: null,
    }],
    document_uploads: [],
    package_slot_removals: [],
    document_runs: [],
    document_findings: [],
    document_report_sends: [],
    document_retrievals: [],
  };

  const client = {
    rpc: vi.fn(async () => (over.recordError === undefined
      ? { data: 'export-1', error: null }
      : { data: null, error: { message: over.recordError } })),
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () => ({ data: { id: 'm-1', legal_name: 'Acme LLC', domain: 'acme.example' }, error: null }),
        update: (fields: Record<string, unknown>) => {
          updates.push(fields);
          return { eq: async () => ({ error: null }) };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        download: async () => (over.noBody === true
          ? { data: null, error: { message: 'not found' } }
          : { data: { arrayBuffer: async () => BODY.buffer.slice(0) }, error: null }),
        upload: async (key: string, bytes: Uint8Array) => {
          if (over.uploadError !== undefined) return { data: null, error: { message: over.uploadError } };
          uploaded.push({ key, bytes: bytes.length });
          return { data: { path: key }, error: null };
        },
        createSignedUrl: async (key: string) => (over.signError !== undefined
          ? { data: null, error: { message: over.signError } }
          : { data: { signedUrl: `https://example.test/signed/${key}` }, error: null }),
        remove: async (keys: string[]) => {
          removed.push([...keys]);
          return { data: null, error: null };
        },
      }),
    },
  } as never;

  return { client, updates, uploaded, removed };
}

const deps = (client: never) => ({
  client,
  browser: null as never,
  origin: 'http://localhost:0',
  bucket: 'documents',
});

describe('the archive is staged where the purge will not trip over it', () => {
  it('puts it under exports/, never under the package prefix', async () => {
    const h = harness();
    await runExport(REQUEST, deps(h.client));
    expect(h.uploaded).toHaveLength(1);
    expect(h.uploaded[0]?.key).toBe(`${EXPORT_PREFIX}/${REQUEST.id}.tar`);
    // An archive under `{packageId}/` is an object the reconciliation cannot account for, so it
    // would refuse — the export making the purge it exists for impossible.
    expect(h.uploaded[0]?.key.startsWith(`${PKG}/`)).toBe(false);
  });

  it('records the request as done, pointing at what it produced', async () => {
    const h = harness();
    await runExport(REQUEST, deps(h.client));
    const done = h.updates.find((u) => u['status'] === 'done');
    expect(done?.['export_id']).toBe('export-1');
    expect(done?.['storage_key']).toBe(`${EXPORT_PREFIX}/${REQUEST.id}.tar`);
    expect(Number(done?.['bytes'])).toBeGreaterThan(0);
  });

  it('mints a download link, because the browser cannot read the bucket', async () => {
    const h = harness();
    await runExport(REQUEST, deps(h.client));
    const done = h.updates.find((u) => u['status'] === 'done');
    // `authenticated` has no select on the documents bucket. Without this the row says `done` and
    // the file is unreachable — which is what shipped, and what 0041 was written for.
    expect(String(done?.['download_url'])).toContain(`${EXPORT_PREFIX}/${REQUEST.id}.tar`);
    expect(done?.['download_expires_at']).toBeDefined();
    // And the durable half beside it. The sweep nulls the URL once it lapses (D-132), so without
    // this the row would end up with no record that a link was ever handed out — and the
    // constraint that a finished export was fetchable would have nothing to read.
    expect(done?.['download_issued_at']).toBeDefined();
  });

  it('fails rather than finishing with an archive nobody can fetch', async () => {
    const h = harness({ signError: 'signing is off' });
    await runExport(REQUEST, deps(h.client));
    expect(h.updates.find((u) => u['status'] === 'done')).toBeUndefined();
    expect(h.updates.find((u) => u['status'] === 'failed')?.['error']).toMatch(/could not be made downloadable/);
    // And the unreachable archive does not stay in the bucket.
    expect(h.removed).toEqual([[`${EXPORT_PREFIX}/${REQUEST.id}.tar`]]);
  });
});

describe('an archive nothing points at is removed', () => {
  it('deletes the staged copy when the export cannot be recorded', async () => {
    const h = harness({ recordError: 'the export does not match the package' });
    await runExport(REQUEST, deps(h.client));
    // A staged copy of every document body, under a key no row points at, is the worst artifact
    // this job could leave.
    expect(h.removed).toEqual([[`${EXPORT_PREFIX}/${REQUEST.id}.tar`]]);
    expect(h.updates.find((u) => u['status'] === 'failed')?.['error']).toMatch(/could not be recorded/);
  });

  it('fails the request rather than throwing at the loop', async () => {
    const h = harness({ uploadError: 'bucket full' });
    await runExport(REQUEST, deps(h.client));
    expect(h.updates.find((u) => u['status'] === 'failed')?.['error']).toMatch(/could not stage the archive/);
  });

  it('fails when a document body cannot be read, rather than exporting without it', async () => {
    const h = harness({ noBody: true });
    await runExport(REQUEST, deps(h.client));
    // The builder refuses; the job records why. An export that quietly skipped a body becomes a
    // purge that deletes the only copy of it.
    expect(h.updates.find((u) => u['status'] === 'failed')?.['error']).toMatch(/is not in storage/);
    expect(h.uploaded).toEqual([]);
  });
});

describe('discarding a staged archive', () => {
  it('removes the object and records that it went', async () => {
    const h = harness();
    await runExportDiscard({ id: 'req-1', storage_key: 'exports/req-1.tar' }, {
      client: h.client, bucket: 'documents',
    });
    expect(h.removed).toEqual([['exports/req-1.tar']]);
    expect(h.updates.find((u) => u['discarded_at'] !== undefined)).toBeDefined();
  });

  it('does not record a discard that storage refused', async () => {
    const client = {
      from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      storage: { from: () => ({ remove: async () => ({ error: { message: 'denied' } }) }) },
    } as never;
    // Otherwise the row says the copy is gone while it is still in the bucket — the most
    // misleading state this table could be in.
    await expect(runExportDiscard({ id: 'req-1', storage_key: 'exports/req-1.tar' }, { client, bucket: 'documents' }))
      .rejects.toThrow(/could not discard/);
  });

  it('claims only finished, undiscarded requests', async () => {
    const seen: string[] = [];
    const client = {
      from: () => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          not: (col: string) => { seen.push(`not:${col}`); return chain; },
          is: (col: string) => { seen.push(`is:${col}`); return chain; },
          eq: (col: string) => { seen.push(`eq:${col}`); return chain; },
          limit: async () => ({ data: [], error: null }),
        };
        return chain;
      },
    } as never;
    await claimNextExportDiscard(client);
    // Asked for, not yet done, and finished. A queued request has no staged copy to remove.
    expect(seen).toEqual(['not:discard_requested_at', 'is:discarded_at', 'eq:status']);
  });
});
