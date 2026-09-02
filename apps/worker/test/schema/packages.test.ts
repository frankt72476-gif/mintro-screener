/**
 * The M1 schema, against a real Postgres.
 *
 * The guarantees here cannot be enforced from application code: `service_role` carries
 * `BYPASSRLS`, so the only thing that stops the worker overwriting a document version is a
 * trigger. These tests act as the worker — no RLS in the way — which is exactly the principal the
 * rules are aimed at.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;

beforeAll(async () => {
  db = await createSchema();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const HASH = (n: number): string => String(n).padStart(64, '0');

async function seedPackage(label = 'northwind'): Promise<{ merchantId: string; packageId: string }> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    /*
      The unique part goes in the label, not after the TLD (D-150).

      This appended the random suffix to a whole domain — `northwind.example-k3j2` — which is not a
      domain, and `merchants_domain_is_folded` correctly refuses it. Every other fixture in this
      suite already had it the right way round; this one was the outlier, and the constraint is what
      found it.
    */
    [`${label}-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version, created_by, org_id)
     values ($1, 'iqwallet', 'seed-2026-08-24', $2, (select org_id from public.analysts where id = $2)) returning id`,
    [merchant!.id, OWNER_ID],
  );
  return { merchantId: merchant!.id, packageId: pkg!.id };
}

async function seedSlot(packageId: string, over: Record<string, unknown> = {}): Promise<string> {
  const [slot] = await db.query<{ id: string }>(
    `insert into public.slots (package_id, slot_key, required_count, state)
     values ($1, $2, $3, $4) returning id`,
    [packageId, over['slot_key'] ?? 'ein_letter', over['required_count'] ?? 1, over['state'] ?? 'missing'],
  );
  return slot!.id;
}

async function seedVersion(
  packageId: string,
  slotId: string,
  hash: string,
  over: { version?: number; documentId?: string; supersedes?: string | null } = {},
): Promise<{ documentId: string; versionId: string }> {
  let documentId = over.documentId;
  if (documentId === undefined) {
    const [doc] = await db.query<{ id: string }>(
      `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
      [packageId, slotId],
    );
    documentId = doc!.id;
  }
  const [version] = await db.query<{ id: string }>(
    `insert into public.document_versions
       (document_id, package_id, version, supersedes, sha256, bytes, detected_type, storage_key, outcome, extraction)
     values ($1, $2, $3, $4, $5, 1024, 'pdf', $6, 'extracted', '{}'::jsonb) returning id`,
    [documentId, packageId, over.version ?? 1, over.supersedes ?? null, hash, `${packageId}/${hash}.pdf`],
  );
  return { documentId, versionId: version!.id };
}

describe('packages key to an application attempt, not a merchant', () => {
  it('allows two packages under one merchant with different templates', async () => {
    const { merchantId } = await seedPackage();
    const error = await db.attempt(
      `insert into public.packages (merchant_id, processor_key, template_version, created_by, org_id)
       values ($1, 'second-processor', 'seed-2026-08-24', $2, (select org_id from public.analysts where id = $2))`,
      [merchantId, OWNER_ID],
    );
    // A merchant declined by one processor and resubmitted to another is two packages, and
    // nothing about the first constrains the second.
    expect(error).toBeNull();
    const rows = await db.query(`select id from public.packages where merchant_id = $1`, [merchantId]);
    expect(rows).toHaveLength(2);
  });
});

describe('lifecycle', () => {
  it('permits the legal transitions', async () => {
    const { packageId } = await seedPackage();
    for (const next of ['submitted', 'reopened', 'submitted', 'archived', 'reopened', 'cancelled']) {
      const error = await db.attempt(
        `update public.packages set lifecycle = $1, archived_at = case when $1 = 'archived' then now() else null end where id = $2`,
        [next, packageId],
      );
      expect(error, `open → … → ${next}`).toBeNull();
    }
  });

  it('refuses a transition that is not in the machine', async () => {
    const { packageId } = await seedPackage();
    const error = await db.attempt(`update public.packages set lifecycle = 'reopened' where id = $1`, [packageId]);
    // A package that was never closed cannot be reopened. Without this the lifecycle column is
    // documentation rather than a constraint.
    expect(error).toMatch(/cannot move from open to reopened/);
  });

  it('refuses to delete a package, for service_role too (D-097)', async () => {
    const { packageId } = await seedPackage();
    const error = await db.attempt(`delete from public.packages where id = $1`, [packageId]);
    expect(error).toMatch(/packages are never deleted/);
  });

  it('will not let the retention clock run on an open package', async () => {
    const { packageId } = await seedPackage();
    const error = await db.attempt(`update public.packages set retention_started_at = now() where id = $1`, [packageId]);
    expect(error).toMatch(/retention_clock_runs_only_when_closed/);
  });
});

describe('documents are immutable and nothing is deleted', () => {
  it('refuses to update a version', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const { versionId } = await seedVersion(packageId, slotId, HASH(1));

    const error = await db.attempt(`update public.document_versions set bytes = 2048 where id = $1`, [versionId]);
    expect(error).toMatch(/append-only/);
  });

  it('refuses to delete a version', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const { versionId } = await seedVersion(packageId, slotId, HASH(2));

    const error = await db.attempt(`delete from public.document_versions where id = $1`, [versionId]);
    expect(error).toMatch(/append-only/);
  });

  it('keeps the supersedes chain intact and the prior version readable', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const first = await seedVersion(packageId, slotId, HASH(3));
    const second = await seedVersion(packageId, slotId, HASH(4), {
      documentId: first.documentId,
      version: 2,
      supersedes: first.versionId,
    });

    const rows = await db.query<{ id: string; version: number; supersedes: string | null; sha256: string }>(
      `select id, version, supersedes, sha256 from public.document_versions where document_id = $1 order by version`,
      [first.documentId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]?.supersedes).toBe(first.versionId);
    // The whole point of D-097 having no deletion path: "what did the first version of this
    // statement say" is answerable, and the answer is still in the table.
    expect(rows[0]?.sha256).toBe(HASH(3));
    expect(second.versionId).not.toBe(first.versionId);
  });

  it('refuses a first version that claims to supersede something', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const first = await seedVersion(packageId, slotId, HASH(5));
    const error = await db.attempt(
      `insert into public.document_versions
         (document_id, package_id, version, supersedes, sha256, bytes, detected_type, storage_key, outcome)
       values ($1, $2, 1, $3, $4, 1, 'pdf', 'k', 'extracted')`,
      [first.documentId, packageId, first.versionId, HASH(6)],
    );
    expect(error).toMatch(/first_version_supersedes_nothing/);
  });

  it('dedups on content within a package', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    await seedVersion(packageId, slotId, HASH(7));
    // The id comes back from RETURNING rather than a follow-up query. Two documents created in
    // one test share a `created_at` to the microsecond, so `order by created_at desc limit 1` is
    // a coin toss — and when it lost, the insert below collided on (document_id, version) and the
    // test passed for the wrong reason.
    const [doc] = await db.query<{ id: string }>(
      `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
      [packageId, slotId],
    );
    const dup = await db.attempt(
      `insert into public.document_versions
         (document_id, package_id, version, sha256, bytes, detected_type, storage_key, outcome)
       values ($1, $2, 1, $3, 1, 'pdf', 'k', 'extracted')`,
      [doc!.id, packageId, HASH(7)],
    );
    expect(dup).toMatch(/document_versions_package_content_idx/);
  });

  it('will not let a version claim a package its document does not belong to', async () => {
    const a = await seedPackage();
    const b = await seedPackage();
    const slotId = await seedSlot(a.packageId);
    const [doc] = await db.query<{ id: string }>(
      `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
      [a.packageId, slotId],
    );
    const error = await db.attempt(
      `insert into public.document_versions
         (document_id, package_id, version, sha256, bytes, detected_type, storage_key, outcome)
       values ($1, $2, 1, $3, 1, 'pdf', 'k', 'extracted')`,
      [doc!.id, b.packageId, HASH(8)],
    );
    // The denormalised package_id exists so dedup can be an index. The composite foreign key is
    // what keeps it honest without a trigger to remember.
    expect(error).toMatch(/foreign key|violates/i);
  });

  it('requires a reason for every outcome that is not extracted (D-092)', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const [doc] = await db.query<{ id: string }>(
      `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
      [packageId, slotId],
    );
    const error = await db.attempt(
      `insert into public.document_versions
         (document_id, package_id, version, sha256, bytes, detected_type, storage_key, outcome)
       values ($1, $2, 1, $3, 1, 'pdf', 'k', 'unreadable')`,
      [doc!.id, packageId, HASH(9)],
    );
    expect(error).toMatch(/outcome_reason_present_unless_extracted/);
  });

  it('requires a conversion to record both halves or neither', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const [doc] = await db.query<{ id: string }>(
      `insert into public.documents (package_id, slot_id) values ($1, $2) returning id`,
      [packageId, slotId],
    );
    const error = await db.attempt(
      `insert into public.document_versions
         (document_id, package_id, version, sha256, bytes, detected_type, storage_key, outcome, original_sha256)
       values ($1, $2, 1, $3, 1, 'jpeg', 'k', 'extracted', $4)`,
      [doc!.id, packageId, HASH(10), HASH(11)],
    );
    // Half a conversion record looks like a retained original with no way to find it.
    expect(error).toMatch(/conversion_is_recorded_completely/);
  });
});

describe('archived packages keep readable bodies (D-097)', () => {
  it('leaves every version in place through archival', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    await seedVersion(packageId, slotId, HASH(12));

    await db.query(`update public.packages set lifecycle = 'submitted', retention_started_at = now() where id = $1`, [packageId]);
    await db.query(`update public.packages set lifecycle = 'archived', archived_at = now() where id = $1`, [packageId]);

    const rows = await db.query<{ storage_key: string }>(
      `select storage_key from public.document_versions where package_id = $1`,
      [packageId],
    );
    // Archival is an access boundary, not a deletion event. The row and its storage key are still
    // there, which is the whole of what D-097 changed.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storage_key).toContain(HASH(12));
  });

  it('has no deletion path anywhere in the package record', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const { documentId, versionId } = await seedVersion(packageId, slotId, HASH(13));

    const deletions: { table: string; sql: string; params: unknown[] }[] = [
      { table: 'document_versions', sql: `delete from public.document_versions where id = $1`, params: [versionId] },
      { table: 'documents', sql: `delete from public.documents where id = $1`, params: [documentId] },
      { table: 'slots', sql: `delete from public.slots where id = $1`, params: [slotId] },
      { table: 'packages', sql: `delete from public.packages where id = $1`, params: [packageId] },
    ];
    for (const { table, sql, params } of deletions) {
      const error = await db.attempt(sql, params);
      expect(error, `${table} accepted a delete`).not.toBeNull();
    }
  });
});

describe('retrieval logging', () => {
  it('records who read an archived body, and cannot be edited afterwards', async () => {
    const { packageId } = await seedPackage();
    const slotId = await seedSlot(packageId);
    const { versionId } = await seedVersion(packageId, slotId, HASH(14));

    const [user] = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('analyst@example.test') returning id`,
    );
    await db.query(`insert into public.analysts (id, email, org_id) values ($1, 'analyst@example.test', (select id from public.organizations where type = 'host'))`, [user!.id]);
    await db.query(`update public.packages set lifecycle = 'submitted', retention_started_at = now() where id = $1`, [packageId]);
    await db.query(`update public.packages set lifecycle = 'archived', archived_at = now() where id = $1`, [packageId]);

    const [log] = await db.query<{ id: string }>(
      `insert into public.document_retrievals (document_version_id, package_id, analyst_id, package_lifecycle)
       values ($1, $2, $3, 'archived') returning id`,
      [versionId, packageId, user!.id],
    );

    const rows = await db.query<{ package_lifecycle: string; analyst_id: string }>(
      `select package_lifecycle, analyst_id from public.document_retrievals where package_id = $1`,
      [packageId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.package_lifecycle).toBe('archived');

    // The accountability a purge cannot offer: the record of who wanted it survives, and nobody
    // can quietly revise it afterwards.
    const edited = await db.attempt(`update public.document_retrievals set analyst_id = $1 where id = $2`, [user!.id, log!.id]);
    expect(edited).toMatch(/append-only/);
    const deleted = await db.attempt(`delete from public.document_retrievals where id = $1`, [log!.id]);
    expect(deleted).toMatch(/append-only/);
  });
});

describe('slot invariants', () => {
  it('accepts the six states and rejects a seventh', async () => {
    const { packageId } = await seedPackage();
    for (const state of ['satisfied', 'superseded', 'missing']) {
      const error = await db.attempt(
        `insert into public.slots (package_id, slot_key, required_count, state) values ($1, $2, 1, $3)`,
        [packageId, `k-${state}`, state],
      );
      expect(error, state).toBeNull();
    }
    const bad = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state) values ($1, 'k-bad', 1, 'partial')`,
      [packageId],
    );
    expect(bad).toMatch(/slots_state_check|violates check constraint/);
  });

  it('ties not_evaluable to an unknown count, in both directions', async () => {
    const { packageId } = await seedPackage();

    const ok = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state)
       values ($1, 'owner_photo_id', null, 'not_evaluable')`,
      [packageId],
    );
    expect(ok).toBeNull();

    // A known count cannot be not_evaluable — otherwise the sixth state becomes a general
    // "we would rather not say", and `missing` is what that is for.
    const withCount = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state)
       values ($1, 'k1', 2, 'not_evaluable')`,
      [packageId],
    );
    expect(withCount).toMatch(/not_evaluable_means_the_count_is_unknown/);

    // And an unknown count cannot claim to be satisfied.
    const unknownSatisfied = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state)
       values ($1, 'k2', null, 'satisfied')`,
      [packageId],
    );
    expect(unknownSatisfied).toMatch(/not_evaluable_means_the_count_is_unknown/);
  });

  it('requires a reason for not_provided and waived, and forbids one elsewhere', async () => {
    const { packageId } = await seedPackage();

    const missingReason = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state) values ($1, 'r1', 1, 'waived')`,
      [packageId],
    );
    expect(missingReason).toMatch(/reason_present_exactly_when_the_state_takes_one/);

    const strayReason = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, reason)
       values ($1, 'r2', 1, 'missing', 'merchant_declines')`,
      [packageId],
    );
    expect(strayReason).toMatch(/reason_present_exactly_when_the_state_takes_one/);

    const crossed = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, reason)
       values ($1, 'r3', 1, 'waived', 'merchant_declines')`,
      [packageId],
    );
    // A waived slot carrying a not-provided reason would read as "the requirement was removed
    // because the merchant refused", which is two different facts wearing one label (D-078).
    expect(crossed).toMatch(/reason_matches_its_state/);

    // A reason with nobody's name against it. D-129: an operator's judgement and a structural
    // consequence of a recorded answer produce the same row, and something has to say which.
    const anonymous = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, reason)
       values ($1, 'r4', 1, 'not_provided', 'new_business_no_processing_history')`,
      [packageId],
    );
    expect(anonymous).toMatch(/resolved_by_present_exactly_when_a_reason_is/);

    // And the reverse: an author against no reason, which would be a decision about nothing.
    const authorNoReason = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, resolved_by)
       values ($1, 'r5', 1, 'missing', 'operator')`,
      [packageId],
    );
    expect(authorNoReason).toMatch(/resolved_by_present_exactly_when_a_reason_is/);

    const good = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, reason, resolved_by)
       values ($1, 'r6', 1, 'not_provided', 'new_business_no_processing_history', 'operator')`,
      [packageId],
    );
    expect(good).toBeNull();
  });

  it('rejects free text where an enumeration is required (D-079)', async () => {
    const { packageId } = await seedPackage();
    const error = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, state, reason)
       values ($1, 'r5', 1, 'waived', 'looks fine to me')`,
      [packageId],
    );
    expect(error).toMatch(/slots_reason_check|violates check constraint/);
  });

  it('seeds a template slot once and permits named instances beside it', async () => {
    const { packageId } = await seedPackage();
    await db.query(
      `insert into public.slots (package_id, slot_key, required_count) values ($1, 'business_license', 1)`,
      [packageId],
    );
    const twice = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count) values ($1, 'business_license', 1)`,
      [packageId],
    );
    expect(twice).toMatch(/slots_identity_idx/);

    // Named instances are how "state pharmacy licence" sits beside "city business licence" (§4).
    // Each carries a count of 1 and the `added` origin — there are no variable-count slots (D-112).
    const named = await db.attempt(
      `insert into public.slots (package_id, slot_key, instance_label, required_count, origin)
       values ($1, 'business_license', 'state pharmacy', 1, 'added')`,
      [packageId],
    );
    expect(named).toBeNull();
  });

  it('ties the added origin to a name, in both directions (D-112)', async () => {
    const { packageId } = await seedPackage();

    const unnamed = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, origin)
       values ($1, 'business_license', 1, 'added')`,
      [packageId],
    );
    // An unlabelled added slot renders as "Business License: satisfied" on a package with two
    // licences, which tells an operator nothing.
    expect(unnamed).toMatch(/added_slots_are_named/);

    const namedTemplate = await db.attempt(
      `insert into public.slots (package_id, slot_key, instance_label, required_count, origin)
       values ($1, 'business_license', 'state pharmacy', 1, 'template')`,
      [packageId],
    );
    // And a template slot has no instance name: it came from the processor's required set, not
    // from a judgement about this merchant.
    expect(namedTemplate).toMatch(/added_slots_are_named/);
  });

  it('sets a grace exactly for monthly slots (D-113)', async () => {
    const { packageId } = await seedPackage();

    const monthlyWithoutGrace = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, coverage_monthly)
       values ($1, 'bank_statement', 3, true)`,
      [packageId],
    );
    expect(monthlyWithoutGrace).toMatch(/grace_is_set_exactly_for_monthly_slots/);

    const graceWithoutMonthly = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, coverage_grace_days)
       values ($1, 'voided_check', 1, 10)`,
      [packageId],
    );
    // A grace on a slot with no monthly rule is a number nothing reads — the shape of a setting
    // that looks configured and does nothing.
    expect(graceWithoutMonthly).toMatch(/grace_is_set_exactly_for_monthly_slots/);

    const good = await db.attempt(
      `insert into public.slots (package_id, slot_key, required_count, coverage_monthly, coverage_grace_days)
       values ($1, 'bank_statement', 3, true, 10)`,
      [packageId],
    );
    expect(good).toBeNull();
  });
});

describe('the extraction cache', () => {
  it('is keyed on content and extractor version together', async () => {
    await db.query(
      `insert into public.extractions (sha256, extractor_version, result) values ($1, '0.1.0', '{}'::jsonb)`,
      [HASH(20)],
    );
    const sameContentNewExtractor = await db.attempt(
      `insert into public.extractions (sha256, extractor_version, result) values ($1, '0.2.0', '{}'::jsonb)`,
      [HASH(20)],
    );
    // A version bump must miss rather than serve a result from an extractor no longer in the tree.
    expect(sameContentNewExtractor).toBeNull();

    const duplicate = await db.attempt(
      `insert into public.extractions (sha256, extractor_version, result) values ($1, '0.1.0', '{}'::jsonb)`,
      [HASH(20)],
    );
    expect(duplicate).toMatch(/duplicate key/);
  });

  it('is append-only', async () => {
    await db.query(
      `insert into public.extractions (sha256, extractor_version, result) values ($1, '0.1.0', '{}'::jsonb)`,
      [HASH(21)],
    );
    const error = await db.attempt(
      `update public.extractions set result = '{"x":1}'::jsonb where sha256 = $1`,
      [HASH(21)],
    );
    expect(error).toMatch(/append-only/);
  });
});
