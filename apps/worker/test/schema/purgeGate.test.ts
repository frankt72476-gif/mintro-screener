/**
 * The purge gate (D-130, P1).
 *
 * Four steps that will not run out of order — export, verify, approve, purge — and the ordering is
 * not a convention a caller follows. Each function refuses unless the one before it left a row in
 * the right state, and these tests are what say so.
 *
 * Nothing here deletes anything. This tier proves the *permission*; the executor that removes
 * objects comes later and is the dangerous half, which is exactly why the gate is proven first.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;
let analyst: string;
let approver: string;

const HASH = (n: number): string => String(n).padStart(64, '0');
const DIGEST = (n: number): string => String(n).padStart(64, 'a');

beforeAll(async () => {
  db = await createSchema();
  for (const [email, isApprover] of [['hand@example.com', false], ['frank@example.com', true]] as const) {
    const [user] = await db.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`, [email],
    );
    await db.query(
      `insert into public.analysts (id, email, purge_approver, org_id) values ($1, $2, $3, (select id from public.organizations where type = 'host'))`,
      [user!.id, email, isApprover],
    );
    if (isApprover) approver = user!.id; else analyst = user!.id;
  }
  await db.actAs(analyst);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** A package with one slot, one document and one version — enough for the counts to be non-trivial. */
async function seedPackage(): Promise<string> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`purge-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version, created_by, org_id)
     values ($1, 'iqwallet', 'documents-1', $2, (select org_id from public.analysts where id = $2)) returning id`,
    [merchant!.id, OWNER_ID],
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
     values ($1, $2, 1, $3, 2048, 'pdf', $4, 'extracted')`,
    [doc!.id, pkg!.id, HASH(1), `${pkg!.id}/${HASH(1)}.pdf`],
  );
  return pkg!.id;
}

/** The counts the database actually holds, as a correct caller would report them. */
const TRUE_COUNTS = {
  slots: 1,
  documents: 1,
  document_versions: 1,
  document_uploads: 0,
  slot_removals: 0,
  document_runs: 0,
  document_findings: 0,
  report_sends: 0,
  retrievals: 0,
};

const recordExport = (packageId: string, counts: object = TRUE_COUNTS, digest = DIGEST(1)) =>
  db.query<{ record_package_export: string }>(
    `select public.record_package_export($1, $2, $3, 4096, $4::jsonb) as record_package_export`,
    [packageId, digest, HASH(9), JSON.stringify(counts)],
  );

const verify = (exportId: string, method = 'read_back', observed = HASH(9)) =>
  db.query<{ record_export_verification: string }>(
    // Zero for `declared`, because nothing was examined and the schema refuses any other claim.
    `select public.record_export_verification($1, $2, $3, $4) as record_export_verification`,
    [exportId, method, observed, method === 'declared' ? 0 : 12],
  );

/** Export, verify, approve — the happy path, as a setup step for tests about what comes after. */
async function approved(packageId: string, digest = DIGEST(1)): Promise<string> {
  const [ex] = await recordExport(packageId, TRUE_COUNTS, digest);
  await verify(ex!.record_package_export);
  await db.actAs(approver);
  const [ap] = await db.query<{ approve_package_purge: string }>(
    `select public.approve_package_purge($1, $2, $3) as approve_package_purge`,
    [packageId, ex!.record_package_export, digest],
  );
  await db.actAs(analyst);
  return ap!.approve_package_purge;
}

const OBJECTS = (versionId: string) =>
  JSON.stringify([
    { kind: 'document_body', document_version_id: versionId, storage_key: 'p/body.pdf', sha256: HASH(1), bytes: 2048 },
    { kind: 'report_pdf', storage_key: 'r/report.pdf', bytes: 100 },
  ]);

const versionOf = async (packageId: string): Promise<string> => {
  const [v] = await db.query<{ id: string }>(
    `select id from public.document_versions where package_id = $1`, [packageId],
  );
  return v!.id;
};

describe('an export records what the database held, not what the caller says it did', () => {
  it('refuses an export whose counts disagree with the package', async () => {
    const packageId = await seedPackage();
    const error = await db.attempt(
      `select public.record_package_export($1, $2, $3, 4096, $4::jsonb)`,
      [packageId, DIGEST(1), HASH(9), JSON.stringify({ ...TRUE_COUNTS, document_versions: 0 })],
    );
    // The whole point of the correction in D-130: a manifest agreeing with itself proves nothing.
    // An exporter that thinks the package has no versions did not export the versions.
    expect(error).toMatch(/document_versions: exported 0, database holds 1/);
  });

  it('refuses an export that does not mention a table at all', async () => {
    const packageId = await seedPackage();
    const { slots: _slots, ...withoutSlots } = TRUE_COUNTS;
    const error = await db.attempt(
      `select public.record_package_export($1, $2, $3, 4096, $4::jsonb)`,
      [packageId, DIGEST(1), HASH(9), JSON.stringify(withoutSlots)],
    );
    // Silence is not zero. An unmentioned table is a table the exporter has no opinion about, and
    // treating that as "nothing to export" is how a partial export records as complete.
    expect(error).toMatch(/slots: exported nothing, database holds 1/);
  });

  /*
    Which side of the comparison ends up in the row.

    The first version of this passed the *correct* counts and asserted one of them came back — so it
    passed whether the function stored the database's numbers or echoed the caller's, because the
    two were identical by construction. Deliberately making the function store `p_counts` did not
    turn it red. A test that cannot fail is not evidence.

    The distinguishing input is a key the database does not know about: validation ignores it, so
    the call succeeds either way, and it survives into the row only if the caller's object was
    stored.
  */
  it('stores the database’s counts rather than the caller’s', async () => {
    const packageId = await seedPackage();
    const [row] = await recordExport(packageId, { ...TRUE_COUNTS, invented_table: 99 });
    const [stored] = await db.query<{ counts: Record<string, number>; exported_by: string }>(
      `select counts, exported_by from public.package_exports where id = $1`,
      [row!.record_package_export],
    );
    expect(stored?.counts['document_versions']).toBe(1);
    expect(Object.keys(stored?.counts ?? {}).sort()).toEqual(Object.keys(TRUE_COUNTS).sort());
    expect(stored?.counts['invented_table']).toBeUndefined();
    expect(stored?.exported_by).toBe(analyst);
  });
});

describe('a verification is a fact, and both outcomes are facts', () => {
  it('records a match', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    const [v] = await verify(ex!.record_package_export);
    expect(v?.record_export_verification).toBe('matched');
  });

  it('records a mismatch rather than raising', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    const [v] = await verify(ex!.record_package_export, 'read_back', HASH(7));
    // D-064: the failed send that wrote no row. Raising here would leave the most interesting
    // verification the only one with no trace.
    expect(v?.record_export_verification).toBe('mismatched');
    const [row] = await db.query<{ outcome: string }>(
      `select outcome from public.package_export_verifications where export_id = $1`,
      [ex!.record_package_export],
    );
    expect(row?.outcome).toBe('mismatched');
  });
});

describe('only an approver approves', () => {
  it('refuses an ordinary analyst', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    expect(error).toMatch(/only a purge approver/);
  });

  it('refuses a deactivated approver', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export);
    // Deactivation is the owner's act, or the service role's. 0058 refuses it from an ordinary
    // analyst's session, so this fixture step runs with no `auth.uid()` — which is what a
    // service-role write looks like, and what actually deactivates people.
    await db.actAs(null);
    await db.query(
      `update public.analysts set active = false, status = 'suspended' where id = $1`,
      [approver],
    );
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    // `is_purge_approver()` requires `active` as well as the flag — revoking access has to revoke
    // this too, or a departed approver keeps the one capability that cannot be undone.
    expect(error).toMatch(/only a purge approver/);
    await db.actAs(null);
    await db.query(
      `update public.analysts set active = true, status = 'active' where id = $1`,
      [approver],
    );
    await db.actAs(analyst);
  });

  it('records the approver, who is not the executor', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    await db.query(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(await versionOf(packageId))],
    );
    const [row] = await db.query<{ approved_by: string; purged_by: string }>(
      `select a.approved_by, p.purged_by from public.package_purges p
         join public.package_purge_approvals a on a.id = p.approval_id
        where p.approval_id = $1`,
      [approvalId],
    );
    // The same person today. Recorded separately so the day there are two is visible (D-130).
    expect(row?.approved_by).toBe(approver);
    expect(row?.purged_by).toBe(analyst);
  });
});

describe('approval requires a verified copy, and declared is not one', () => {
  it('refuses an export nobody verified', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    expect(error).toMatch(/no verified copy/);
    await db.actAs(analyst);
  });

  it('refuses a declared hash', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export, 'declared');
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    // Recordable and insufficient (D-130). This is the concrete meaning of "it must not be a
    // checkbox": the weakest mode exists so the record is honest, and it does not open the gate.
    expect(error).toMatch(/no verified copy/);
    await db.actAs(analyst);
  });

  it('refuses a verification that mismatched', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export, 'read_back', HASH(7));
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    expect(error).toMatch(/no verified copy/);
    await db.actAs(analyst);
  });

  it('refuses an export belonging to a different package', async () => {
    const mine = await seedPackage();
    const theirs = await seedPackage();
    const [ex] = await recordExport(theirs);
    await verify(ex!.record_package_export);
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [mine, ex!.record_package_export, DIGEST(1)],
    );
    // Otherwise one verified export authorises deleting any package.
    expect(error).toMatch(/belongs to a different package/);
    await db.actAs(analyst);
  });
});

describe('the digest binds the approval to a package that has not moved', () => {
  it('refuses to approve when the package changed since the export', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId, TRUE_COUNTS, DIGEST(1));
    await verify(ex!.record_package_export);
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(2)],
    );
    expect(error).toMatch(/has changed since this export was taken/);
    await db.actAs(analyst);
  });

  it('refuses to purge when the package changed since the approval', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId, DIGEST(1));
    const error = await db.attempt(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(2), OBJECTS(await versionOf(packageId))],
    );
    // Re-checked at purge and not only at approval: an approval can sit for a week, and the
    // package it was given for is the one that existed then (D-117's mechanism, D-130's use).
    expect(error).toMatch(/has changed since this purge was approved/);
  });
});

describe('one approval, one purge', () => {
  it('refuses a second purge against the same approval', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    const versionId = await versionOf(packageId);
    expect(await db.attempt(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(versionId)],
    )).toBeNull();

    const again = await db.attempt(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(versionId)],
    );
    // A unique constraint rather than a `consumed` flag, because this table is append-only and a
    // mutable flag would need the trigger relaxed to set it.
    expect(again).toMatch(/package_purges_approval_id_key|duplicate key/);
  });

  it('refuses a purge that names nothing', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    const error = await db.attempt(
      `select public.begin_package_purge($1, $2, '[]'::jsonb)`,
      [approvalId, DIGEST(1)],
    );
    // A reconciliation that found nothing is an executor bug. Recording it would put a row in the
    // ledger saying bodies went when they are still there.
    expect(error).toMatch(/at least one object/);
  });
});

describe('the purge record resolves the supersedes chain to a location', () => {
  it('carries the key, the hash and the export behind every purged body', async () => {
    const packageId = await seedPackage();
    const versionId = await versionOf(packageId);
    const approvalId = await approved(packageId);
    await db.query(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(versionId)],
    );

    // The question D-097 refused a purge over: "what did the first version of this statement say".
    // A reader follows the version to here and gets somewhere to look, not a dead end.
    const [row] = await db.query<{
      storage_key: string; sha256: string; manifest_sha256: string; kind: string;
    }>(
      `select o.storage_key, o.sha256, o.kind, e.manifest_sha256
         from public.purged_objects o
         join public.package_purges p on p.id = o.purge_id
         join public.package_purge_approvals a on a.id = p.approval_id
         join public.package_exports e on e.id = a.export_id
        where o.document_version_id = $1`,
      [versionId],
    );
    expect(row).toEqual({
      storage_key: 'p/body.pdf', sha256: HASH(1), kind: 'document_body', manifest_sha256: HASH(9),
    });
  });

  it('derives the planned totals from the rows, so summary and detail cannot disagree', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    await db.query(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(await versionOf(packageId))],
    );
    const [row] = await db.query<{ objects_planned: number; bytes_planned: string; actual: string }>(
      `select p.objects_planned, p.bytes_planned,
              (select count(*) from public.purged_objects where purge_id = p.id) as actual
         from public.package_purges p where p.approval_id = $1`,
      [approvalId],
    );
    expect(Number(row?.objects_planned)).toBe(Number(row?.actual));
    expect(Number(row?.bytes_planned)).toBe(2148);
  });

  it('refuses an object whose reference does not match its kind', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    const error = await db.attempt(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), JSON.stringify([
        // A body with no version to hang off: the chain would resolve to a row that cannot say
        // which document it belonged to.
        { kind: 'document_body', storage_key: 'p/orphan.pdf', bytes: 1 },
      ])],
    );
    expect(error).toMatch(/purged_object_reference_matches_its_kind/);
  });

  it('records staging copies and report PDFs, which have no version', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    const [slot] = await db.query<{ id: string }>(
      `select id from public.slots where package_id = $1`, [packageId],
    );
    const [upload] = await db.query<{ id: string }>(
      `insert into public.document_uploads (package_id, slot_id, staging_key, original_filename, requested_by)
       values ($1, $2, $3, 'x.pdf', $4) returning id`,
      [packageId, slot!.id, `${packageId}/staging/abc`, analyst],
    );
    const error = await db.attempt(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), JSON.stringify([
        { kind: 'upload_staging', upload_id: upload!.id, storage_key: `${packageId}/staging/abc`, bytes: 10 },
        { kind: 'report_pdf', storage_key: 'run/report.pdf', bytes: 20 },
      ])],
    );
    // The invisible second copy (D-130). A purge record that cannot express it is a record that
    // reads as complete while the same licence images are still in the bucket.
    expect(error).toBeNull();
    const kinds = await db.query<{ kind: string }>(
      `select o.kind from public.purged_objects o join public.package_purges p on p.id = o.purge_id
        where p.approval_id = $1 order by o.kind`,
      [approvalId],
    );
    expect(kinds.map((k) => k.kind)).toEqual(['report_pdf', 'upload_staging']);
  });
});

describe('every row in the gate is append-only', () => {
  it('refuses updates and deletes, for service_role too', async () => {
    const packageId = await seedPackage();
    const approvalId = await approved(packageId);
    await db.query(
      `select public.begin_package_purge($1, $2, $3::jsonb)`,
      [approvalId, DIGEST(1), OBJECTS(await versionOf(packageId))],
    );

    // These tests act as the worker, with nothing in the way — which is the principal the rule is
    // aimed at, since service_role carries BYPASSRLS and a policy would not stop it.
    for (const table of [
      'package_exports', 'package_export_verifications', 'package_purge_approvals',
      'package_purges', 'purged_objects',
    ]) {
      expect(await db.attempt(`update public.${table} set id = id`), `${table} update`)
        .toMatch(/append-only|not permitted/);
      expect(await db.attempt(`delete from public.${table} where true`), `${table} delete`)
        .toMatch(/append-only|not permitted/);
    }
  });
});

describe('hop 2 is an attestation, and the gate does not consult it', () => {
  it('records who said what, and where they say they put it', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    const error = await db.attempt(
      `select public.record_vault_attestation($1, $2, $3)`,
      [ex!.record_package_export, 'Mintro vault, offline drive 2', 'Copied and confirmed it opens.'],
    );
    expect(error).toBeNull();

    const [row] = await db.query<{ destination: string; statement: string; attested_by: string }>(
      `select destination, statement, attested_by from public.package_vault_attestations where export_id = $1`,
      [ex!.record_package_export],
    );
    expect(row?.destination).toBe('Mintro vault, offline drive 2');
    expect(row?.attested_by).toBe(analyst);
  });

  /*
    The separation, asserted rather than trusted to naming.

    An attestation is a person saying they moved a file. D-064 is the precedent for why it can never
    stand in for a check: a send returned 200, wrote no row, and one report reached a real recipient
    with nothing behind it, because "the mailer accepted it" and "it was transmitted" were one
    field. Here the two facts are two tables, and this is the test that says the gate reads only one.
  */
  it('does not let an attestation stand in for a verification', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await db.query(
      `select public.record_vault_attestation($1, 'the vault', 'It is in the vault.')`,
      [ex!.record_package_export],
    );

    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    expect(error).toMatch(/no verified copy/);
    await db.actAs(analyst);
  });

  it('is append-only like everything else in the gate', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await db.query(`select public.record_vault_attestation($1, 'v', 's')`, [ex!.record_package_export]);
    expect(await db.attempt(`update public.package_vault_attestations set destination = 'elsewhere'`))
      .toMatch(/append-only|not permitted/);
    expect(await db.attempt(`delete from public.package_vault_attestations where true`))
      .toMatch(/append-only|not permitted/);
  });
});

describe('a declared hash is recorded and does not open the gate', () => {
  it('writes a row that says exactly what happened', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    // The manifest hash typed back correctly. The database compares two strings and says `matched`,
    // which is true and is not the same as anybody having looked at an archive.
    const [v] = await verify(ex!.record_package_export, 'declared', HASH(9));
    expect(v?.record_export_verification).toBe('matched');

    const [row] = await db.query<{ method: string; outcome: string; members_checked: number }>(
      `select method, outcome, members_checked from public.package_export_verifications where export_id = $1`,
      [ex!.record_package_export],
    );
    expect(row).toEqual({ method: 'declared', outcome: 'matched', members_checked: 0 });
  });

  it('and the approval still refuses, even though the row says matched', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export, 'declared', HASH(9));
    await db.actAs(approver);
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    // This is the concrete meaning of "it must not be a checkbox". The weakest method exists so the
    // record is honest about what an operator did, and it does not authorise a deletion.
    expect(error).toMatch(/a declared hash is not one/);
    await db.actAs(analyst);
  });

  it('and a strong verification on the same export does open it', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    await verify(ex!.record_package_export, 'declared', HASH(9));
    await verify(ex!.record_package_export, 'read_back', HASH(9));
    await db.actAs(approver);
    // Both rows stand. The declared one is not deleted or overridden — it is a record of something
    // that happened, and the gate simply reads the other one.
    const error = await db.attempt(
      `select public.approve_package_purge($1, $2, $3)`,
      [packageId, ex!.record_package_export, DIGEST(1)],
    );
    expect(error).toBeNull();
    await db.actAs(analyst);
  });
});

describe('the record cannot overstate what was checked', () => {
  it('refuses a declared verification claiming it examined members', async () => {
    const packageId = await seedPackage();
    const [ex] = await recordExport(packageId);
    const error = await db.attempt(
      `select public.record_export_verification($1, 'declared', $2, 12)`,
      [ex!.record_package_export, HASH(9)],
    );
    // Otherwise the weakest method can present itself as the most thorough one, in the same column
    // a reader would use to tell them apart.
    expect(error).toMatch(/a_declared_hash_checks_nothing/);
  });
});

describe('the intent is written before anything is deleted', () => {
  /*
    The window P4 left open: delete, then record. A crash between them left the bytes gone and no
    row saying which — so the only account was an error message somebody had to have been watching
    for, and the `alreadyPurged` resumption depended on the step that failed.

    0039 splits it. `begin_package_purge` names the objects; the deletion happens outside the
    database; `complete_package_purge` says it finished. The interrupted state is a purge with no
    completion, and it is readable rather than reconstructed.
  */
  async function begun(packageId: string): Promise<{ purgeId: string; approvalId: string }> {
    const approvalId = await approved(packageId);
    const [row] = await db.query<{ begin_package_purge: string }>(
      `select public.begin_package_purge($1, $2, $3::jsonb) as begin_package_purge`,
      [approvalId, DIGEST(1), OBJECTS(await versionOf(packageId))],
    );
    return { purgeId: row!.begin_package_purge, approvalId };
  }

  it('names every object before any deletion could have happened', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    const objects = await db.query<{ storage_key: string }>(
      `select storage_key from public.purged_objects where purge_id = $1 order by storage_key`,
      [purgeId],
    );
    expect(objects.map((o) => o.storage_key)).toEqual(['p/body.pdf', 'r/report.pdf']);
    // And nothing says it finished.
    expect(await db.query(`select 1 from public.package_purge_completions where purge_id = $1`, [purgeId]))
      .toEqual([]);
  });

  it('an interrupted purge is readable as begun-and-not-complete', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    const [row] = await db.query<{ planned: number; completions: number }>(
      `select p.objects_planned as planned,
              (select count(*) from public.package_purge_completions c where c.purge_id = p.id)::int as completions
         from public.package_purges p where p.id = $1`,
      [purgeId],
    );
    // The state recovery looks for. Two rows and a missing third, rather than a person's memory.
    expect(row).toEqual({ planned: 2, completions: 0 });
  });

  it('completing it records who and how many', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    expect(await db.attempt(`select public.complete_package_purge($1, 2)`, [purgeId])).toBeNull();
    const [row] = await db.query<{ objects_removed: number; completed_by: string }>(
      `select objects_removed, completed_by from public.package_purge_completions where purge_id = $1`,
      [purgeId],
    );
    expect(row).toEqual({ objects_removed: 2, completed_by: analyst });
  });

  it('refuses to complete a purge that removed fewer than it named', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    // A completion row would say it finished. The intent row stays, which is what resumption reads.
    expect(await db.attempt(`select public.complete_package_purge($1, 1)`, [purgeId]))
      .toMatch(/named 2 object\(s\) and removed 1/);
  });

  it('completes once and only once', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    await db.query(`select public.complete_package_purge($1, 2)`, [purgeId]);
    expect(await db.attempt(`select public.complete_package_purge($1, 2)`, [purgeId]))
      .toMatch(/package_purge_completions_purge_id_key|duplicate key/);
  });

  it('and a completion cannot be rewritten or removed', async () => {
    const packageId = await seedPackage();
    const { purgeId } = await begun(packageId);
    await db.query(`select public.complete_package_purge($1, 2)`, [purgeId]);
    expect(await db.attempt(`update public.package_purge_completions set objects_removed = 0`))
      .toMatch(/append-only|not permitted/);
    expect(await db.attempt(`delete from public.package_purge_completions where true`))
      .toMatch(/append-only|not permitted/);
  });
});
