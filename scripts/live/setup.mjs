/**
 * Shared live-run setup, so the next script does not rediscover any of it.
 *
 * Each of these was found the hard way during the first live run and is recorded here rather than
 * in a comment in one script.
 */

/**
 * The analyst an upload has to name.
 *
 * `analysts.id` is a foreign key to `auth.users`, so an analyst is an authenticated person and not
 * a row that can be conjured through PostgREST. `document_uploads.requested_by` points at one, so
 * nothing can be staged without one existing. The right shape — and invisible until a live run,
 * because PGlite has no `auth` schema to have a foreign key into.
 */
export async function ensureAnalyst(service, email = 'verify@gomintro.com') {
  const listed = await service.auth.admin.listUsers();
  const found = (listed.data?.users ?? []).find((u) => u.email === email);
  const user = found ?? (await service.auth.admin.createUser({ email, email_confirm: true })).data?.user;
  if (!user) throw new Error(`could not create or find the auth user ${email}`);

  const { data, error } = await service
    .from('analysts')
    .upsert({ id: user.id, email, active: true }, { onConflict: 'id' })
    .select('id')
    .single();
  if (error) throw new Error(`analyst upsert: ${error.message}`);
  return data.id;
}

/**
 * A `SlotDefinition` as a `slots` row.
 *
 * Three things the schema insists on that the definition does not hand you:
 *
 * - `coverage_grace_days` is set **exactly** for monthly slots. Since D-121 the definition agrees —
 *   `graceDays` is null unless `monthly` — so this passes it straight through, and the constraint
 *   now guards the invariant instead of catching a mismatch.
 * - `origin` is `required | conditional | added` (D-121, migration 0026). `include` tells you which:
 *   a predicate function means the template seeded it because of the facts.
 * - `state` for an unknown count must be `not_evaluable`, never `missing`
 *   (`not_evaluable_means_the_count_is_unknown` is an iff). That is D-107 enforced by the database:
 *   we do not know how many to expect, so we cannot say any are absent.
 */
export function slotRow(packageId, definition) {
  return {
    package_id: packageId,
    slot_key: definition.slotKey,
    required_count: definition.requiredCount,
    coverage_monthly: definition.monthly,
    coverage_grace_days: definition.graceDays,
    expiry_after_run: definition.expiryAfterRun,
    origin: typeof definition.include === 'function' ? 'conditional' : 'required',
    examined: definition.examined,
    state: definition.requiredCount === null ? 'not_evaluable' : 'missing',
  };
}
