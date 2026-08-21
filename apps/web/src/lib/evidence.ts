/**
 * Getting at stored evidence.
 *
 * The `evidence` bucket is private (docs/DEPLOY.md). Screenshots and DOM snapshots are never
 * public objects, so nothing in the report links to a storage path directly — every reference
 * goes through a **short-expiry signed URL** minted on demand.
 *
 * Why on demand rather than baked into the report: a signed URL in a persisted report document
 * would either expire and leave a broken report, or be given a long life to avoid that — and a
 * long-lived URL to a merchant's evidence is a public URL with extra steps. Minting per view
 * keeps the expiry short and keeps the link out of anything that gets stored or forwarded.
 */

/** How long a minted URL stays valid. Long enough to load an image, short enough not to travel. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface EvidenceAccess {
  /** Mints a URL for a stored artifact, or null when it cannot be reached. */
  urlFor(key: string): Promise<string | null>;
  /** How this access is obtained, shown in the report so the reader knows what they are seeing. */
  readonly description: string;
}

interface SupabaseLike {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

/**
 * Signed URLs from the private Supabase bucket. The production path.
 */
export function createSupabaseEvidenceAccess(
  client: SupabaseLike,
  bucket = 'evidence',
): EvidenceAccess {
  return {
    description: `signed URLs from the private ${bucket} bucket, ${SIGNED_URL_TTL_SECONDS}s expiry`,
    async urlFor(key) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
      // A failure here must not fall back to an unsigned path. The caller renders "capture not
      // reachable", which is honest; a broken image that looks like a missing capture is not.
      if (error !== null && error !== undefined) return null;
      return data?.signedUrl ?? null;
    },
  };
}

/**
 * Local development access.
 *
 * Reads from a directory the worker wrote with `--evidence-dir`, served by Vite. Not signed and
 * not private, which is why it says so: the report shows how the capture was obtained, so a
 * screenshot loaded from a dev directory can never be mistaken for one retrieved from the
 * private bucket.
 */
export function createLocalEvidenceAccess(root = '/evidence'): EvidenceAccess {
  return {
    description: 'local evidence directory (development only — not signed, not private)',
    async urlFor(key) {
      // Screenshots are stored as-is; text artifacts are gzipped and cannot be shown inline.
      return key.endsWith('.png') ? `${root}/${key}` : null;
    },
  };
}

/**
 * Access that reaches nothing, and says so.
 *
 * Used when Supabase is not configured. It is deliberately not a fallback to unsigned local
 * paths: a deployment that silently served merchant evidence without authentication would be the
 * exact failure the private bucket exists to prevent, and it would look like it was working.
 */
export function createUnavailableEvidenceAccess(reason: string): EvidenceAccess {
  return {
    description: `evidence unavailable — ${reason}`,
    urlFor: async () => null,
  };
}

/**
 * Picks the access path.
 *
 * Supabase when a client is available, the local directory only in development, and neither
 * silently. The report shows which one produced a capture, so a screenshot loaded from a dev
 * directory can never be mistaken for one retrieved from the private bucket.
 */
export function createEvidenceAccess(client?: SupabaseLike): EvidenceAccess {
  if (client !== undefined) return createSupabaseEvidenceAccess(client);
  if (import.meta.env.DEV) return createLocalEvidenceAccess();
  return createUnavailableEvidenceAccess('no Supabase session');
}
