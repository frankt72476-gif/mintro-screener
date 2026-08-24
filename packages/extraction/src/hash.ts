import { createHash } from 'node:crypto';

/**
 * SHA-256 of the input, lowercase hex.
 *
 * Per D-091 this is document identity, not a checksum bolted on afterwards: it drives
 * deduplication, the supersedes chain, the `document_version` in every provenance record, and half
 * the cache key. One value doing four jobs, none of them extra work.
 */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
