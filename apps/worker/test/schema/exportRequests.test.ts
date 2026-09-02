/**
 * The export queue (D-130, P6, migration 0040).
 *
 * `package_exports` is the anchor the entire purge gate reads — an approval requires a verified
 * export, and a verification requires an export row to compare against. So the one thing an
 * operator must not be able to write is a finished export request pointing at an export nobody
 * built, and that is what most of this file is about.
 *
 * The other half is `record_export_for_request`, which exists because `service_role` has no
 * `auth.uid()` and fails `is_analyst()`. It takes its authority from the request row instead, and
 * it gets no easier ride on the counts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;
let analyst: string;

beforeAll(async () => {
  db = await createSchema();
  const [user] = await db.query<{ id: string }>(
    `insert into auth.users (email) values ('exports@example.com') returning id`,
  );
  await db.query(`insert into public.analysts (id, email, status, org_id) values ($1, 'exports@example.com', 'active', (select id from public.organizations where type = 'host'))`, [user!.id]);
  analyst = user!.id;
  await db.actAs(analyst);
  // Supabase grants `authenticated` everything on `public` and our migrations revoke; PGlite has no
  // such bootstrap, so the policy is only the thing under test once the grant exists.
  await db.exec(`grant select, insert on public.document_export_requests to authenticated`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function asAnalyst<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

/** A package with one slot, one document and one version, so the counts are not all zero. */
async function seedPackage(): Promise<string> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`exp-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version, created_by, org_id)
     values ($1, 'iqwallet', 'documents-1', $2, (select org_id from public.analysts where id = $2)) returning id`,
    [merchant!.id, analyst],
  );
  const [slot] = await db.query<{ id: string }>(
    `insert into public.slots (package_id, slot_key, required_count, state)
     values ($1, 'ein_letter', 1, 'missing') returning id`,
    [pkg!.id],
  );
  const [doc] = await db.query<{ id: string }>(
    `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
    [pkg!.id, slot!.id],
  );
  await db.query(
    `insert into public.document_versions
       (document_id, package_id, version, sha256, bytes, detected_type, storage_key, outcome)
     values ($1, $2, 1, $3, 10, 'pdf', $4, 'extracted')`,
    [doc!.id, pkg!.id, 'a'.repeat(64), `${pkg!.id}/a.pdf`],
  );
  return pkg!.id;
}

const TRUE_COUNTS = {
  slots: 1, documents: 1, document_versions: 1, document_uploads: 0, slot_removals: 0,
  document_runs: 0, document_findings: 0, report_sends: 0, retrievals: 0,
};

async function queued(packageId: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.document_export_requests (package_id, requested_by) values ($1, $2) returning id`,
    [packageId, analyst],
  );
  return row!.id;
}

describe('an operator may ask for an export and may not answer for one', () => {
  it('queues a request under their own name', async () => {
    const packageId = await seedPackage();
    expect(await asAnalyst(() => db.attempt(
      `insert into public.document_export_requests (package_id, requested_by) values ($1, $2)`,
      [packageId, analyst],
    ))).toBeNull();
  });

  /*
    The one that matters.

    `package_exports` is the anchor the purge gate reads. An operator who could write a finished
    request naming an export id could record an export that was never built — and every check
    downstream reads that row as though something happened.
  */
  it('cannot write a finished request', async () => {
    const packageId = await seedPackage();
    const error = await asAnalyst(() => db.attempt(
      `insert into public.document_export_requests (package_id, requested_by, status, storage_key)
       values ($1, $2, 'done', 'exports/made-up.tar')`,
      [packageId, analyst],
    ));
    expect(error).toMatch(/row-level security/);
  });

  it('cannot name a storage key on a queued request either', async () => {
    const packageId = await seedPackage();
    expect(await asAnalyst(() => db.attempt(
      `insert into public.document_export_requests (package_id, requested_by, storage_key)
       values ($1, $2, 'exports/made-up.tar')`,
      [packageId, analyst],
    ))).toMatch(/row-level security/);
  });

  it('cannot update a request at all', async () => {
    const id = await queued(await seedPackage());
    expect(await asAnalyst(() => db.attempt(
      `update public.document_export_requests set status = 'done' where id = $1`, [id],
    ))).toMatch(/permission denied/);
  });

  it('and a done request has to point at something', async () => {
    const id = await queued(await seedPackage());
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    /*
      A `done` row with no export is a request that claims success and cannot show for what.

      The download link is supplied so this isolates the constraint it names: without it
      `finished_exports_are_fetchable` (0041) fires first, and the test would pass for the wrong
      reason while saying it checked the other one.
    */
    expect(await db.attempt(
      `update public.document_export_requests
          set status = 'done', download_url = 'https://example.test/a.tar',
              download_issued_at = now() where id = $1`,
      [id],
    )).toMatch(/finished_exports_have_an_export/);
  });
});

describe('the worker records the export against the request', () => {
  async function running(packageId: string): Promise<string> {
    const id = await queued(packageId);
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    return id;
  }

  it('attributes it to whoever asked, not to the worker', async () => {
    const packageId = await seedPackage();
    const id = await running(packageId);
    const [row] = await db.query<{ record_export_for_request: string }>(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb) as record_export_for_request`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    );
    const [stored] = await db.query<{ exported_by: string }>(
      `select exported_by from public.package_exports where id = $1`,
      [row!.record_export_for_request],
    );
    // `service_role` has no auth.uid() and fails is_analyst() — the guard working. The authority
    // comes from the request row, which only an analyst could have created.
    expect(stored?.exported_by).toBe(analyst);
  });

  it('checks the counts exactly as the browser path does', async () => {
    const packageId = await seedPackage();
    const id = await running(packageId);
    const error = await db.attempt(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb)`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify({ ...TRUE_COUNTS, document_versions: 0 })],
    );
    // One derivation, shared (D-125). The worker gets a different way of proving who asked, and no
    // easier ride on whether the export is complete.
    expect(error).toMatch(/document_versions: exported 0, database holds 1/);
  });

  it('refuses a request that is not running', async () => {
    const id = await queued(await seedPackage());
    expect(await db.attempt(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb)`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    )).toMatch(/is queued, not running/);
  });
});

describe('the staged copy is discardable and the record is not', () => {
  async function done(packageId: string): Promise<string> {
    const id = await queued(packageId);
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    const [row] = await db.query<{ record_export_for_request: string }>(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb) as record_export_for_request`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    );
    await db.query(
      `update public.document_export_requests
          set status = 'done', export_id = $2, storage_key = $3, bytes = 100,
              download_url = $4, download_expires_at = now() + interval '2 hours',
              download_issued_at = now(), finished_at = now()
        where id = $1`,
      // The link the worker mints (0041). A finished request with no way to fetch the archive is
      // the defect that migration exists for, and the schema refuses one.
      [id, row!.record_export_for_request, `exports/${id}.tar`, `https://example.test/${id}.tar`],
    );
    return id;
  }

  it('lets an analyst ask for the staged archive to go', async () => {
    const id = await done(await seedPackage());
    expect(await db.attempt(`select public.request_export_discard($1)`, [id])).toBeNull();
    const [row] = await db.query<{ discard_requested_at: string | null }>(
      `select discard_requested_at from public.document_export_requests where id = $1`, [id],
    );
    expect(row?.discard_requested_at).not.toBeNull();
  });

  it('refuses to discard something that is not a finished export', async () => {
    const id = await queued(await seedPackage());
    // Never silently: a queued request has no staged copy, and saying nothing would read as done.
    expect(await db.attempt(`select public.request_export_discard($1)`, [id]))
      .toMatch(/not a finished, undiscarded export/);
  });

  it('keeps everything but the discard frozen once finished', async () => {
    const id = await done(await seedPackage());
    // The row is why an operator has a copy. Rewriting which export it produced would rewrite that.
    expect(await db.attempt(
      `update public.document_export_requests set storage_key = 'exports/elsewhere.tar' where id = $1`, [id],
    )).toMatch(/only the discard and the link may still change/);
  });

  it('and is never deleted', async () => {
    const id = await done(await seedPackage());
    expect(await db.attempt(`delete from public.document_export_requests where id = $1`, [id]))
      .toMatch(/never deleted/);
  });

  it('records that the copy went without touching the export', async () => {
    const id = await done(await seedPackage());
    await db.query(`select public.request_export_discard($1)`, [id]);
    expect(await db.attempt(
      `update public.document_export_requests set discarded_at = now() where id = $1`, [id],
    )).toBeNull();

    const [row] = await db.query<{ export_id: string; discarded_at: string }>(
      `select export_id, discarded_at from public.document_export_requests where id = $1`, [id],
    );
    // The staged archive is gone and the anchor row still exists — which is the whole point: the
    // export happened, and the second copy of the PII did not have to outlive the download.
    expect(row?.export_id).not.toBeNull();
    expect(row?.discarded_at).not.toBeNull();
  });

  it('will not record a discard nobody asked for', async () => {
    const id = await done(await seedPackage());
    expect(await db.attempt(
      `update public.document_export_requests set discarded_at = now() where id = $1`, [id],
    )).toMatch(/discarded_exports_were_asked_to_be/);
  });
});

describe('a finished export was fetchable at some point', () => {
  it('refuses a done request with no export behind it', async () => {
    const id = await queued(await seedPackage());
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    // What shipped: `done`, an archive staged, and an operator with no way to reach it. The row is
    // the promise that a copy is available, so it has to be able to keep it.
    expect(await db.attempt(
      `update public.document_export_requests
          set status = 'done', export_id = null, storage_key = $2, download_issued_at = now()
        where id = $1`,
      [id, `exports/${id}.tar`],
    )).toMatch(/finished_exports_have_an_export/);
  });

  it('allows a done request with no link once the copy is discarded', async () => {
    const packageId = await seedPackage();
    const id = await queued(packageId);
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    const [row] = await db.query<{ record_export_for_request: string }>(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb) as record_export_for_request`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    );
    // A discarded archive has no link and should not: there is nothing left to fetch, and the
    // export record stays regardless.
    expect(await db.attempt(
      `update public.document_export_requests
          set status = 'done', export_id = $2, storage_key = $3,
              discard_requested_at = now(), discarded_at = now(), finished_at = now()
        where id = $1`,
      [id, row!.record_export_for_request, `exports/${id}.tar`],
    )).toBeNull();
  });
});

describe('the link may be cleared and never repointed (D-132)', () => {
  async function fetchable(): Promise<string> {
    const packageId = await seedPackage();
    const id = await queued(packageId);
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    const [row] = await db.query<{ record_export_for_request: string }>(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb) as record_export_for_request`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    );
    await db.query(
      `update public.document_export_requests
          set status = 'done', export_id = $2, storage_key = $3, bytes = 100,
              download_url = 'https://example.test/one.tar',
              download_expires_at = now() - interval '1 hour',
              download_issued_at = now() - interval '3 hours', finished_at = now()
        where id = $1`,
      [id, row!.record_export_for_request, `exports/${id}.tar`],
    );
    return id;
  }

  it('lets the sweep null a lapsed link', async () => {
    const id = await fetchable();
    expect(await db.attempt(
      `update public.document_export_requests set download_url = null where id = $1`, [id],
    )).toBeNull();
  });

  it('refuses a link swapped for another one', async () => {
    const id = await fetchable();
    // Nulling can only take a download away. Repointing would send an operator at a different
    // archive while the row still names the export it was taken for.
    expect(await db.attempt(
      `update public.document_export_requests set download_url = 'https://elsewhere.test/x.tar' where id = $1`,
      [id],
    )).toMatch(/may be cleared, not repointed/);
  });

  it('refuses an expiry moved rather than cleared', async () => {
    const id = await fetchable();
    expect(await db.attempt(
      `update public.document_export_requests set download_expires_at = now() + interval '1 day' where id = $1`,
      [id],
    )).toMatch(/may be cleared, not moved/);
  });

  it('keeps download_issued_at frozen, because it is the record', async () => {
    const id = await fetchable();
    // The URL is transient; that one was issued, and when, is what survives. Editing it would
    // rewrite the only remaining evidence that an operator was handed a copy.
    expect(await db.attempt(
      `update public.document_export_requests set download_issued_at = now() where id = $1`, [id],
    )).toMatch(/only the discard and the link may still change/);
  });

  it('still satisfies the constraint once the link is gone', async () => {
    const id = await fetchable();
    await db.query(`update public.document_export_requests set download_url = null where id = $1`, [id]);
    const [row] = await db.query<{ download_url: string | null; download_issued_at: string }>(
      `select download_url, download_issued_at from public.document_export_requests where id = $1`, [id],
    );
    // `finished_exports_were_fetchable` reads the durable fact, so a nulled link does not put the
    // row in violation — which the old constraint would have.
    expect(row?.download_url).toBeNull();
    expect(row?.download_issued_at).not.toBeNull();
  });
});

describe('a verified copy asks for the staged one to go (D-132)', () => {
  async function withExport(): Promise<{ requestId: string; exportId: string }> {
    const packageId = await seedPackage();
    const id = await queued(packageId);
    await db.query(`update public.document_export_requests set status = 'running' where id = $1`, [id]);
    const [row] = await db.query<{ record_export_for_request: string }>(
      `select public.record_export_for_request($1, $2, $3, 100, $4::jsonb) as record_export_for_request`,
      [id, 'a'.repeat(64), 'b'.repeat(64), JSON.stringify(TRUE_COUNTS)],
    );
    await db.query(
      `update public.document_export_requests
          set status = 'done', export_id = $2, storage_key = $3, bytes = 100,
              download_url = 'https://example.test/one.tar',
              download_expires_at = now() + interval '2 hours',
              download_issued_at = now(), finished_at = now()
        where id = $1`,
      [id, row!.record_export_for_request, `exports/${id}.tar`],
    );
    return { requestId: id, exportId: row!.record_export_for_request };
  }

  const discardRequested = async (id: string): Promise<boolean> => {
    const [row] = await db.query<{ discard_requested_at: string | null }>(
      `select discard_requested_at from public.document_export_requests where id = $1`, [id],
    );
    return row?.discard_requested_at !== null;
  };

  it('asks after a matched read_back', async () => {
    const { requestId, exportId } = await withExport();
    await db.query(`select public.record_export_verification($1, 'read_back', repeat('b', 64), 12)`, [exportId]);
    // Evidence rather than a timer: the archive is on the operator's disk and has been hashed
    // member by member, so the staged copy is redundant.
    expect(await discardRequested(requestId)).toBe(true);
  });

  it('asks after a matched reupload', async () => {
    const { requestId, exportId } = await withExport();
    await db.query(`select public.record_export_verification($1, 'reupload', repeat('b', 64), 12)`, [exportId]);
    expect(await discardRequested(requestId)).toBe(true);
  });

  it('never after a declared hash', async () => {
    const { requestId, exportId } = await withExport();
    await db.query(`select public.record_export_verification($1, 'declared', repeat('b', 64), 0)`, [exportId]);
    // A typed hash proves somebody read a string. Discarding on it would remove the only copy on
    // the strength of an operator's typing.
    expect(await discardRequested(requestId)).toBe(false);
  });

  it('never after a mismatch', async () => {
    const { requestId, exportId } = await withExport();
    await db.query(`select public.record_export_verification($1, 'read_back', repeat('f', 64), 3)`, [exportId]);
    // The copy on disk is not the archive. Removing the staged one would leave nothing correct.
    expect(await discardRequested(requestId)).toBe(false);
  });
});
