/**
 * The worker's Supabase client, and the evidence store.
 *
 * This is the only place the **service key** is used. It never reaches the frontend: the browser
 * gets the project URL and the anon key, and nothing prefixed `VITE_` carries a secret (hard
 * constraint 6, docs/DEPLOY.md).
 *
 * The service key carries `BYPASSRLS`, which is why the append-only guarantees in the migrations
 * are triggers and primary keys rather than row-level policies. RLS would not stop this client;
 * a trigger does.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceArtifact } from '@mintro/engine';

export const EVIDENCE_BUCKET = 'evidence';

export interface WorkerSupabase {
  readonly client: SupabaseClient;
  readonly bucket: string;
}

/**
 * Builds the worker client from the environment.
 *
 * Throws rather than degrading. A worker that silently ran without persistence would produce
 * screening runs that exist only in its own logs — the opposite of the defensibility the
 * evidence store is for.
 */
export function createWorkerSupabase(env: NodeJS.ProcessEnv = process.env): WorkerSupabase {
  const url = env['SUPABASE_URL'];
  const key = env['SUPABASE_SERVICE_KEY'];

  if (url === undefined || url === '') {
    throw new Error('SUPABASE_URL is not set — the worker cannot persist runs without it');
  }
  if (key === undefined || key === '') {
    throw new Error('SUPABASE_SERVICE_KEY is not set — the worker cannot persist runs without it');
  }
  // A service key pasted into a VITE_ variable would be compiled into the browser bundle. Cheap
  // to check, and the failure it prevents is a published credential.
  if (env['VITE_SUPABASE_SERVICE_KEY'] !== undefined) {
    throw new Error(
      'VITE_SUPABASE_SERVICE_KEY is set. Anything prefixed VITE_ is compiled into the browser bundle and is public (constraint 6).',
    );
  }

  return {
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    bucket: env['SUPABASE_EVIDENCE_BUCKET'] ?? EVIDENCE_BUCKET,
  };
}

export interface StoredEvidence {
  readonly key: string;
  readonly bytes: number;
  /** True when this key already existed and the write was refused. */
  readonly alreadyExisted: boolean;
}

/**
 * Writes one artifact to the private bucket, append-only.
 *
 * `upsert: false` is the enforcement: a second scan writing the same key **fails** rather than
 * replacing the first scan's capture. D-002 is explicit that overwriting would destroy the record
 * of what the site looked like at the time, so a collision is reported to the caller as a fact,
 * not swallowed and not retried with a different key.
 *
 * Keys are run-scoped by construction, so a collision means a genuine bug — a re-used run id, or
 * the same run writing twice — and is worth surfacing rather than smoothing over.
 */
export async function putEvidence(
  supabase: WorkerSupabase,
  artifact: EvidenceArtifact,
): Promise<StoredEvidence> {
  const body = artifact.kind === 'screenshot' ? artifact.gzip : artifact.gzip;
  const path = storagePathFor(artifact);

  const { error } = await supabase.client.storage.from(supabase.bucket).upload(path, body, {
    contentType: contentTypeFor(artifact),
    upsert: false,
    cacheControl: 'private, max-age=31536000, immutable',
  });

  if (error !== null) {
    // Supabase reports a duplicate as a 409 / "already exists". That is the append-only rule
    // working, so it is returned rather than thrown.
    const message = error.message.toLowerCase();
    if (message.includes('already exists') || message.includes('duplicate')) {
      return { key: path, bytes: artifact.gzipByteLength, alreadyExisted: true };
    }
    throw new Error(`could not write evidence ${path}: ${error.message}`);
  }

  return { key: path, bytes: artifact.gzipByteLength, alreadyExisted: false };
}

/**
 * The storage path for an artifact.
 *
 * Text artifacts are stored gzipped and carry `.gz`; screenshots are PNG and already compressed.
 *
 * ## The path is derived from the key. It is not the key.
 *
 * An earlier version recorded this path *as* the `evidence` row's key, on the reasoning that the
 * two "can never disagree about where a capture lives". They then disagreed about something more
 * important: findings cite `artifact.key`, so every gzipped artifact's row was filed under a name
 * no finding referenced. The rows existed, the objects existed, and nothing could join them.
 *
 * `evidence.key` is the artifact key — what a finding cites, and what `0006` documents the column
 * to be. Where the bytes sit is a storage detail computed from it, here and nowhere else.
 */
export function storagePathFor(artifact: EvidenceArtifact): string {
  return storagePathForKey(artifact.key, artifact.kind);
}

/**
 * The same derivation, for a stored row rather than an artifact in hand.
 *
 * Anything holding an `evidence` row and wanting its bytes goes through this. Two call sites
 * spelling the rule out separately is how the divergence above happened.
 */
export function storagePathForKey(key: string, kind: string): string {
  return kind === 'screenshot' ? key : `${key}.gz`;
}

function contentTypeFor(artifact: EvidenceArtifact): string {
  switch (artifact.kind) {
    case 'screenshot':
      return 'image/png';
    case 'dom':
      return 'application/gzip';
    default:
      return 'application/gzip';
  }
}

/** Mints a short-expiry signed URL. Used by the worker when it renders the PDF. */
export async function signEvidenceUrl(
  supabase: WorkerSupabase,
  key: string,
  expiresInSeconds = 60,
): Promise<string | null> {
  const { data, error } = await supabase.client.storage
    .from(supabase.bucket)
    .createSignedUrl(key, expiresInSeconds);

  return error === null ? (data?.signedUrl ?? null) : null;
}
