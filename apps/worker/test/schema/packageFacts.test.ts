/**
 * Migration 0034 — the three creation answers, against a real Postgres (D-129).
 *
 * These are functions, not DDL, and a `security definer` function is exactly the thing a
 * well-formed-SQL test cannot check: it parses whether or not `is_analyst()` is called, whether or
 * not the waive is narrowed to outstanding slots, whether or not the lifecycle guard fires. All
 * three are behaviour, and behaviour needs a database.
 *
 * They also stand in for 0033, which shipped with no schema-tier test at all — verified live and
 * nowhere else, so a change to it would have been caught by nothing in `npm run check`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;
let analystId: string;

beforeAll(async () => {
  db = await createSchema();
  const [user] = await db.query<{ id: string }>(
    `insert into auth.users (email) values ('facts@example.com') returning id`,
  );
  const [analyst] = await db.query<{ id: string }>(
    `insert into public.analysts (id, email) values ($1, 'facts@example.com') returning id`,
    [user!.id],
  );
  analystId = analyst!.id;
  await db.actAs(analystId);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** The two slots every test here needs: a conditional one to waive, and a required one to leave. */
const SLOTS = JSON.stringify([
  { slot_key: 'w8ben', origin: 'conditional', required_count: 1 },
  { slot_key: 'articles_of_incorporation', origin: 'conditional', required_count: 1 },
  { slot_key: 'ein_letter', origin: 'required', required_count: 1 },
]);

async function newMerchant(dba: string | null = null): Promise<string> {
  const [row] = await db.query<{ ensure_merchant: string }>(
    `select public.ensure_merchant($1, $2, $3) as ensure_merchant`,
    [`Acme ${Math.random().toString(36).slice(2)} LLC`, `m-${Math.random().toString(36).slice(2)}.example`, dba],
  );
  return row!.ensure_merchant;
}

async function newPackage(facts: {
  entityType?: string | null;
  hasProcessor?: boolean | null;
  usDomiciled?: boolean | null;
} = {}): Promise<string> {
  const merchantId = await newMerchant();
  const [row] = await db.query<{ create_document_package: string }>(
    `select public.create_document_package($1, 'default', $2::jsonb, '[]'::jsonb, $3, $4, $5)
       as create_document_package`,
    [
      merchantId,
      SLOTS,
      facts.entityType ?? null,
      facts.hasProcessor ?? null,
      facts.usDomiciled ?? null,
    ],
  );
  return row!.create_document_package;
}

describe('the answers are stored, and unanswered is a value', () => {
  it('records all three as null when nothing was answered', async () => {
    const packageId = await newPackage();
    const [row] = await db.query<{
      entity_type: string | null;
      has_existing_processor: boolean | null;
      us_domiciled: boolean | null;
      facts_set_at: string | null;
    }>(
      `select entity_type, has_existing_processor, us_domiciled, facts_set_at
         from public.packages where id = $1`,
      [packageId],
    );
    expect(row).toEqual({
      entity_type: null,
      has_existing_processor: null,
      us_domiciled: null,
      // No author against three nulls: nobody said they did not know, they simply did not say.
      facts_set_at: null,
    });
  });

  it('stamps an author as soon as one answer is given', async () => {
    const packageId = await newPackage({ entityType: 'llc' });
    const [row] = await db.query<{ entity_type: string; facts_set_by: string; facts_set_at: string }>(
      `select entity_type, facts_set_by, facts_set_at from public.packages where id = $1`,
      [packageId],
    );
    expect(row?.entity_type).toBe('llc');
    expect(row?.facts_set_by).toBe(analystId);
    expect(row?.facts_set_at).not.toBeNull();
  });

  it('refuses an entity type outside the six', async () => {
    const merchantId = await newMerchant();
    const error = await db.attempt(
      `select public.create_document_package($1, 'default', $2::jsonb, '[]'::jsonb, 's_corp', null, null)`,
      [merchantId, SLOTS],
    );
    // C-05's comparison vocabulary is a different set for a different purpose. Letting one leak
    // into the other would make a change to how documents are compared change which slots exist.
    expect(error).toMatch(/packages_entity_type_check/);
  });
});

describe('answering afterwards waives; it never deletes', () => {
  it('waives the conditional slots the answers rule out, and says how many', async () => {
    const packageId = await newPackage();
    const [row] = await db.query<{ set_package_facts: number }>(
      `select public.set_package_facts($1, 'sole_proprietor', null, true, $2::jsonb) as set_package_facts`,
      [packageId, JSON.stringify(['articles_of_incorporation', 'w8ben'])],
    );
    expect(row?.set_package_facts).toBe(2);

    const slots = await db.query<{ slot_key: string; state: string; reason: string | null; resolved_by: string | null }>(
      `select slot_key, state, reason, resolved_by from public.slots where package_id = $1 order by slot_key`,
      [packageId],
    );
    // Still three rows. D-097 has no deletion path, and the record that the requirement existed is
    // the fact the waived state exists to preserve.
    expect(slots).toHaveLength(3);
    expect(slots.filter((s) => s.state === 'waived')).toHaveLength(2);
    for (const slot of slots.filter((s) => s.state === 'waived')) {
      expect(slot.reason).toBe('not_applicable_to_entity_type');
      // The whole reason the column exists: a person's judgement and a structural consequence
      // produce identical rows otherwise.
      expect(slot.resolved_by).toBe('fact');
    }
    expect(slots.find((s) => s.slot_key === 'ein_letter')?.state).toBe('missing');
  });

  it('leaves a slot that already holds a document alone', async () => {
    const packageId = await newPackage();
    await db.query(
      `update public.slots set state = 'satisfied' where package_id = $1 and slot_key = 'w8ben'`,
      [packageId],
    );

    const [row] = await db.query<{ set_package_facts: number }>(
      `select public.set_package_facts($1, 'llc', null, true, $2::jsonb) as set_package_facts`,
      [packageId, JSON.stringify(['w8ben'])],
    );
    // Asked to waive one, waived none — and the count returned is what happened, not what was
    // requested. An answer saying a document cannot exist does not make an uploaded document go
    // away; it makes the two disagree, which is C-05's finding to report.
    expect(row?.set_package_facts).toBe(0);

    const [slot] = await db.query<{ state: string; reason: string | null }>(
      `select state, reason from public.slots where package_id = $1 and slot_key = 'w8ben'`,
      [packageId],
    );
    expect(slot?.state).toBe('satisfied');
    expect(slot?.reason).toBeNull();
  });

  it('will not waive a required slot even when asked to', async () => {
    const packageId = await newPackage();
    const [row] = await db.query<{ set_package_facts: number }>(
      `select public.set_package_facts($1, 'llc', null, true, $2::jsonb) as set_package_facts`,
      [packageId, JSON.stringify(['ein_letter'])],
    );
    // Only a conditional can be structurally impossible. A required slot removed by a fact would
    // be the default set quietly shrinking with nothing recording that it had.
    expect(row?.set_package_facts).toBe(0);
  });

  it('refuses once the package is no longer open', async () => {
    const packageId = await newPackage();
    await db.query(`update public.packages set lifecycle = 'submitted' where id = $1`, [packageId]);
    const error = await db.attempt(
      `select public.set_package_facts($1, 'llc', null, true, '[]'::jsonb)`,
      [packageId],
    );
    // The required set is what the report measured against. Changing it afterwards would make an
    // already-sent report describe a set that no longer exists.
    expect(error).toMatch(/its document set is settled/);
  });

  it('refuses somebody who is not an active analyst', async () => {
    const packageId = await newPackage();
    await db.actAs(null);
    const error = await db.attempt(
      `select public.set_package_facts($1, 'llc', null, true, '[]'::jsonb)`,
      [packageId],
    );
    expect(error).toMatch(/only an active analyst/);
    await db.actAs(analystId);
  });
});

describe('set_slot_state', () => {
  it('sets a reason and records who decided', async () => {
    const packageId = await newPackage();
    const [slot] = await db.query<{ id: string }>(
      `select id from public.slots where package_id = $1 and slot_key = 'ein_letter'`,
      [packageId],
    );
    const error = await db.attempt(
      `select public.set_slot_state($1, 'not_provided', 'lost_or_destroyed_cannot_reissue', 'operator')`,
      [slot!.id],
    );
    expect(error).toBeNull();

    const [after] = await db.query<{ state: string; reason: string; resolved_by: string }>(
      `select state, reason, resolved_by from public.slots where id = $1`,
      [slot!.id],
    );
    expect(after).toEqual({
      state: 'not_provided',
      reason: 'lost_or_destroyed_cannot_reissue',
      resolved_by: 'operator',
    });
  });

  it('clears the author when the reason goes, so the pair never comes apart', async () => {
    const packageId = await newPackage();
    const [slot] = await db.query<{ id: string }>(
      `select id from public.slots where package_id = $1 and slot_key = 'ein_letter'`,
      [packageId],
    );
    await db.query(`select public.set_slot_state($1, 'not_provided', 'merchant_declines', 'operator')`, [slot!.id]);
    // Back to outstanding. Without the function clearing `resolved_by` this raises on the 0034
    // constraint, which is the constraint doing its job and the function failing to.
    const error = await db.attempt(`select public.set_slot_state($1, 'missing', null, 'operator')`, [slot!.id]);
    expect(error).toBeNull();

    const [after] = await db.query<{ state: string; reason: string | null; resolved_by: string | null }>(
      `select state, reason, resolved_by from public.slots where id = $1`,
      [slot!.id],
    );
    expect(after).toEqual({ state: 'missing', reason: null, resolved_by: null });
  });

  it('refuses somebody who is not an active analyst', async () => {
    const packageId = await newPackage();
    const [slot] = await db.query<{ id: string }>(
      `select id from public.slots where package_id = $1 limit 1`,
      [packageId],
    );
    await db.actAs(null);
    const error = await db.attempt(`select public.set_slot_state($1, 'missing', null, 'operator')`, [slot!.id]);
    expect(error).toMatch(/only an active analyst/);
    await db.actAs(analystId);
  });
});

describe('the operator DBA', () => {
  it('is stored on the merchant', async () => {
    const merchantId = await newMerchant('The Corner Shop');
    const [row] = await db.query<{ dba: string | null }>(
      `select dba from public.merchants where id = $1`,
      [merchantId],
    );
    expect(row?.dba).toBe('The Corner Shop');
  });

  it('fills a blank on an existing merchant but never overwrites one', async () => {
    const domain = `dba-${Math.random().toString(36).slice(2)}.example`;
    const [first] = await db.query<{ id: string }>(
      `select public.ensure_merchant('Acme LLC', $1, null) as id`,
      [domain],
    );
    await db.query(`select public.ensure_merchant('Acme LLC', $1, 'Corner Shop')`, [domain]);
    const [filled] = await db.query<{ dba: string | null }>(`select dba from public.merchants where id = $1`, [
      first!.id,
    ]);
    expect(filled?.dba).toBe('Corner Shop');

    // A later form filled in from memory does not get to replace what somebody typed with the
    // merchant in front of them.
    await db.query(`select public.ensure_merchant('Acme LLC', $1, 'Something Else')`, [domain]);
    const [kept] = await db.query<{ dba: string | null }>(`select dba from public.merchants where id = $1`, [
      first!.id,
    ]);
    expect(kept?.dba).toBe('Corner Shop');
  });

  it('is not readable from anything on the report path', async () => {
    /*
      D-126 as amended by D-129, asserted structurally.

      Two names that look alike and mean different things: this one is how an operator finds a
      package, the report's is what the documents say and is derived once, in C-02. Wiring the first
      into the second would be D-125's failure — a display assembled from a second derivation — and
      it would be a one-line change nobody noticed.
    */
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'document_runs'`,
    );
    expect(columns.map((c) => c.column_name)).not.toContain('dba');
  });
});

describe("the worker's own slot write still satisfies the new constraint", () => {
  /*
    `ingestStore.setSlotState` updates `{ state, reason }` and never touches `resolved_by`, so 0034
    could have made ingest fail on any slot carrying a reason. It does not, and the reason is worth
    pinning rather than re-deriving: the worker passes back the reason it just read, so the pair on
    the row stays whatever it already was.

    `resolveSlotState` is what makes that safe. It returns `not_provided` and `waived` unchanged —
    reason and all — and every other branch is only reachable from a state whose reason was already
    null. The worker therefore never introduces, changes or clears a reason.

    This is a guard against somebody making it do so later. `service_role` bypasses RLS and does not
    bypass a CHECK, so the failure would be a broken ingest job in production rather than a test.
  */
  async function slotWithReason(): Promise<string> {
    const packageId = await newPackage();
    const [slot] = await db.query<{ id: string }>(
      `select id from public.slots where package_id = $1 and slot_key = 'ein_letter'`,
      [packageId],
    );
    await db.query(`select public.set_slot_state($1, 'not_provided', 'merchant_declines', 'operator')`, [slot!.id]);
    return slot!.id;
  }

  it('writing back the same reason is accepted', async () => {
    const slotId = await slotWithReason();
    // The exact shape of the worker's update: state and reason, resolved_by untouched.
    const error = await db.attempt(
      `update public.slots set state = 'not_provided', reason = 'merchant_declines', updated_at = now() where id = $1`,
      [slotId],
    );
    expect(error).toBeNull();
  });

  it('and clearing the reason without clearing the author is refused', async () => {
    const slotId = await slotWithReason();
    const error = await db.attempt(
      `update public.slots set state = 'satisfied', reason = null, updated_at = now() where id = $1`,
      [slotId],
    );
    // The narrow race: an operator clears the reason between the worker's read and its write. It
    // fails loudly and the ingest job reports it, which is the survivable direction.
    expect(error).toMatch(/resolved_by_present_exactly_when_a_reason_is/);
  });
});
