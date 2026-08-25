/**
 * Planning and executing a purge (D-130, P4).
 *
 * The only code in this system that deletes anything. Everything about its shape follows from that.
 *
 * ## It takes an approval id and nothing else
 *
 * No list of keys, no package id, no options about what to include. A job that accepts a list can
 * be handed the wrong list, and the gate never sees it — the approval, the digest binding and the
 * verification all pass while the wrong bytes go. So the targets are **derived** from the approved
 * package, every time, and the caller cannot influence them.
 *
 * ## It reconciles against the bucket, not against the columns
 *
 * `document_versions.storage_key` says what the database believes is stored. It is not the same
 * question as what *is* stored, and the difference is the whole reason this reconciles: the browser
 * stages every upload at `{packageId}/staging/{uuid}` and **nothing has ever removed it**, so every
 * file exists twice and one copy appears in no column. A purge driven from the columns would delete
 * the copy it knew about, leave the staged one holding the same licence images, and report success.
 *
 * ## Anything it cannot account for is a refusal
 *
 * Not a warning, not a skip. An object under the package's prefix that no row explains means our
 * model of what is stored is wrong, and deleting under a wrong model is the failure every other
 * ruling here is arranged against. Reporting and continuing would delete correctly nine times and
 * catastrophically once.
 *
 * The same in the other direction: an expected object that is *absent* is unexplained unless a
 * prior purge of this package recorded deleting it. That exception is narrow on purpose — it exists
 * so a purge interrupted halfway can be finished, and it accepts only absences this system already
 * admitted to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PurgeObjectKind = 'document_body' | 'document_original' | 'upload_staging' | 'report_pdf';

export interface PurgeTarget {
  readonly kind: PurgeObjectKind;
  readonly storageKey: string;
  readonly documentVersionId: string | null;
  readonly uploadId: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
}

export interface PurgePlan {
  readonly packageId: string;
  readonly approvalId: string;
  /** Expected and present. What a purge would delete. */
  readonly targets: readonly PurgeTarget[];
  /** Present and explained by nothing. A refusal. */
  readonly unexpected: readonly string[];
  /** Expected, absent, and recorded as purged by an earlier attempt. Not a refusal. */
  readonly alreadyPurged: readonly string[];
  /** Expected, absent, and named by nothing. A refusal. */
  readonly unexplained: readonly string[];
  /** Empty exactly when the purge may proceed. */
  readonly refusals: readonly string[];
  readonly bytes: number;
}

/** The storage operations this needs, narrowed so the reconciliation can be tested without a bucket. */
export interface PurgeStorage {
  /** One level, as the Storage API gives it: entries with a null id are prefixes. */
  list(prefix: string): Promise<readonly { readonly name: string; readonly id: string | null; readonly size?: number }[]>;
  remove(keys: readonly string[]): Promise<void>;
}

export class PurgeRefused extends Error {
  readonly plan: PurgePlan;
  constructor(plan: PurgePlan) {
    super(
      `the purge is refused for package ${plan.packageId}: ${plan.refusals.join('; ')}. ` +
        'Nothing was deleted.',
    );
    this.name = 'PurgeRefused';
    this.plan = plan;
  }
}

/**
 * Every key under a prefix, walking into folders.
 *
 * The Storage API's `list` is **one level**. Listing `{packageId}` returns the content-addressed
 * bodies and a single folder entry called `staging` — and a reconciler that stopped there would
 * miss precisely the copies nobody knows about, which is the one class of object this ruling exists
 * to catch. Bounded depth because a package prefix is two levels deep by construction and an
 * unbounded walk over a bucket is a way to hang a worker on somebody else's data.
 */
export async function listPrefixRecursively(
  storage: PurgeStorage,
  prefix: string,
  depth = 4,
): Promise<{ readonly key: string; readonly bytes: number | null }[]> {
  if (depth <= 0) return [];
  const out: { key: string; bytes: number | null }[] = [];
  for (const entry of await storage.list(prefix)) {
    const key = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      out.push(...(await listPrefixRecursively(storage, key, depth - 1)));
    } else {
      out.push({ key, bytes: entry.size ?? null });
    }
  }
  return out;
}

interface Expected {
  readonly key: string;
  readonly kind: PurgeObjectKind;
  readonly documentVersionId: string | null;
  readonly uploadId: string | null;
  readonly sha256: string | null;
}

/**
 * What the database says should be under this package's prefix.
 *
 * Report PDFs are in scope by ruling and are **not in this list**, because the documents report is
 * rendered, attached to the mail and never stored — only its hash is kept. So there is nothing to
 * expect and nothing to delete. If one ever appears under a package prefix it lands in
 * `unexpected` and refuses, which is the right answer for an object that should not exist.
 */
async function expectedObjects(client: SupabaseClient, packageId: string): Promise<Expected[]> {
  const expected: Expected[] = [];

  const { data: versions, error: versionError } = await client
    .from('document_versions')
    .select('id, storage_key, sha256, original_storage_key, original_sha256')
    .eq('package_id', packageId);
  if (versionError !== null) throw new Error(`could not read the document versions: ${versionError.message}`);

  for (const row of versions ?? []) {
    const v = row as Record<string, unknown>;
    // Superseded versions included. D-097's chain stays complete for the life of the package, and a
    // purge that took the live bodies and left the rest would leave it half-resolving.
    expected.push({
      key: String(v['storage_key']), kind: 'document_body',
      documentVersionId: String(v['id']), uploadId: null, sha256: String(v['sha256']),
    });
    if (v['original_storage_key'] !== null && v['original_storage_key'] !== undefined) {
      expected.push({
        key: String(v['original_storage_key']), kind: 'document_original',
        documentVersionId: String(v['id']), uploadId: null,
        sha256: (v['original_sha256'] as string | null) ?? null,
      });
    }
  }

  const { data: uploads, error: uploadError } = await client
    .from('document_uploads')
    .select('id, staging_key')
    .eq('package_id', packageId);
  if (uploadError !== null) throw new Error(`could not read the uploads: ${uploadError.message}`);

  for (const row of uploads ?? []) {
    const u = row as Record<string, unknown>;
    expected.push({
      key: String(u['staging_key']), kind: 'upload_staging',
      documentVersionId: null, uploadId: String(u['id']), sha256: null,
    });
  }

  return expected;
}

export interface PurgeDeps {
  readonly client: SupabaseClient;
  readonly storage: PurgeStorage;
}

/**
 * The dry run.
 *
 * Reads, lists, compares, and touches nothing. Safe to run at any time and on any package, which is
 * why it is the thing an operator is given rather than a mode of the executor.
 */
export async function planPurge(deps: PurgeDeps, approvalId: string): Promise<PurgePlan> {
  const { data: approval, error } = await deps.client
    .from('package_purge_approvals')
    .select('id, package_id')
    .eq('id', approvalId)
    .maybeSingle();
  if (error !== null) throw new Error(`could not read the approval: ${error.message}`);
  if (approval === null) throw new Error(`no such approval: ${approvalId}`);

  // **The derivation.** The package comes from the approval and from nowhere else, so no caller can
  // point the executor at a package nobody authorised.
  return reconcile(deps, String((approval as Record<string, unknown>)['package_id']), approvalId);
}

/**
 * The reconciliation itself, against a package.
 *
 * Separate from `planPurge` so a dry run taken **before** any approval exists runs the same
 * comparison rather than a second one written to look like it. A dry run that reconciled
 * differently from the executor would be a dry run of something else.
 *
 * Exported for that one caller. It deletes nothing — `executePurge` reaches it only through
 * `planPurge`, which resolves the package from the approval.
 */
export async function reconcile(
  deps: PurgeDeps,
  packageId: string,
  approvalId: string,
): Promise<PurgePlan> {
  const expected = await expectedObjects(deps.client, packageId);
  const found = await listPrefixRecursively(deps.storage, packageId);
  const foundByKey = new Map(found.map((f) => [f.key, f.bytes]));

  /*
    What a previous attempt named for removal, on the record. The only absence this accepts.

    These rows are written *before* the deletion (0039), so an attempt interrupted at any point
    leaves them — the exception no longer depends on the interrupted attempt having succeeded at
    the step that failed.
  */
  const { data: priorRows } = await deps.client
    .from('purged_objects')
    .select('storage_key, package_purges!inner(package_id)')
    .eq('package_purges.package_id', packageId);
  const priorlyPurged = new Set(
    (priorRows ?? []).map((r) => String((r as Record<string, unknown>)['storage_key'])),
  );

  const targets: PurgeTarget[] = [];
  const alreadyPurged: string[] = [];
  const unexplained: string[] = [];

  for (const item of expected) {
    if (foundByKey.has(item.key)) {
      targets.push({
        kind: item.kind,
        storageKey: item.key,
        documentVersionId: item.documentVersionId,
        uploadId: item.uploadId,
        sha256: item.sha256,
        bytes: foundByKey.get(item.key) ?? null,
      });
    } else if (priorlyPurged.has(item.key)) {
      alreadyPurged.push(item.key);
    } else {
      unexplained.push(item.key);
    }
  }

  const expectedKeys = new Set(expected.map((e) => e.key));
  const unexpected = found.map((f) => f.key).filter((key) => !expectedKeys.has(key)).sort();

  const refusals: string[] = [];
  if (unexpected.length > 0) {
    refusals.push(
      `${unexpected.length} object(s) under this package's prefix are accounted for by no row: ` +
        `${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? ', …' : ''}`,
    );
  }
  if (unexplained.length > 0) {
    refusals.push(
      `${unexplained.length} object(s) the database expects are not in the bucket and no purge ` +
        `recorded removing them: ${unexplained.slice(0, 5).join(', ')}${unexplained.length > 5 ? ', …' : ''}`,
    );
  }
  if (targets.length === 0 && alreadyPurged.length === 0) {
    // Nothing to delete is not success. Either the package never had bodies or the reconciliation
    // is looking in the wrong place, and both deserve a person rather than a `done`.
    refusals.push('the reconciliation found nothing to delete, which is not the same as being finished');
  }

  return {
    packageId,
    approvalId,
    targets,
    unexpected,
    alreadyPurged,
    unexplained,
    refusals,
    bytes: targets.reduce((sum, t) => sum + (t.bytes ?? 0), 0),
  };
}

/**
 * Delete, then record.
 *
 * `confirm` is required and has no default. A caller that forgets it gets a dry run, which is the
 * safe direction for an argument somebody might not pass.
 *
 * Deletion happens before the record, and then the bucket is **re-listed** to check the objects are
 * actually gone. A storage remove that reports success and leaves the object is exactly the shape
 * this project keeps finding, and a purge row asserting bytes are gone while they sit in the bucket
 * would be the most misleading row in the database.
 */
export async function executePurge(
  deps: PurgeDeps,
  approvalId: string,
  options: { readonly confirm: boolean; readonly packageDigest: string },
): Promise<{ readonly plan: PurgePlan; readonly purgeId: string | null }> {
  const plan = await planPurge(deps, approvalId);
  if (plan.refusals.length > 0) throw new PurgeRefused(plan);
  if (!options.confirm) return { plan, purgeId: null };

  /*
    Intent first, then delete, then completion.

    A crash between the first two leaves a row naming exactly what was about to be removed, so a
    resumed purge reads the database rather than an error message somebody had to have been
    watching for. `alreadyPurged` reads those same rows, which is why it now works whether or not
    the interrupted attempt got any further.

    Reconstruction by hand is a backstop, not a design — the same discipline as export-before-purge,
    one level down.
  */
  const objects = plan.targets.map((t) => ({
    kind: t.kind,
    document_version_id: t.documentVersionId,
    upload_id: t.uploadId,
    storage_key: t.storageKey,
    sha256: t.sha256,
    bytes: t.bytes,
  }));

  const begun = await deps.client.rpc('begin_package_purge', {
    p_approval_id: approvalId,
    p_package_digest: options.packageDigest,
    p_objects: objects,
  });
  if (begun.error !== null) {
    // Nothing has been deleted. The gate refused before anything irreversible happened, which is
    // the whole reason the intent is written first.
    throw new Error(`the purge could not be begun, and nothing was deleted: ${begun.error.message}`);
  }
  const purgeId = String(begun.data);

  await deps.storage.remove(plan.targets.map((t) => t.storageKey));

  const still = new Set((await listPrefixRecursively(deps.storage, plan.packageId)).map((f) => f.key));
  const survivors = plan.targets.filter((t) => still.has(t.storageKey)).map((t) => t.storageKey);
  if (survivors.length > 0) {
    // A remove that reports success and leaves the object. The intent row stays and no completion
    // is written, which is exactly the resumable state.
    throw new Error(
      `storage accepted the removal and ${survivors.length} object(s) are still there: ` +
        `${survivors.slice(0, 5).join(', ')}. Purge ${purgeId} is begun and not complete; its ` +
        'objects are recorded and it can be resumed.',
    );
  }

  const done = await deps.client.rpc('complete_package_purge', {
    p_purge_id: purgeId,
    p_objects_removed: plan.targets.length,
  });
  if (done.error !== null) {
    // The bytes are gone and the completion failed — but the intent row named every one of them
    // before they went, so this is a row to finish rather than a list to reconstruct.
    throw new Error(
      `the objects were deleted and the purge could not be completed: ${done.error.message}. ` +
        `Purge ${purgeId} names all ${plan.targets.length} object(s) and can be completed.`,
    );
  }

  return { plan, purgeId };
}
