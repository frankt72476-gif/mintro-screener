/**
 * Reading the access log (D-239).
 *
 * Owner-only by `admin_access_log_select` (0058). This module reads the rows and does not resolve
 * anything on them: `actor_id` and `subject_id` stay uuids, because joining either back to an
 * address would hand the owner the address a `bind_refused` row deliberately does not carry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AccessLogEntry {
  readonly id: number;
  readonly action: string;
  readonly createdAt: string;
  /** Exactly what the row holds. Never widened, never joined. */
  readonly valueAfter: Record<string, unknown> | null;
}

interface LogRow {
  readonly id: number;
  readonly action: string;
  readonly created_at: string;
  readonly value_after: Record<string, unknown> | null;
}

export async function readAccessLog(
  client: SupabaseClient,
  limit = 500,
): Promise<{ readonly ok: boolean; readonly entries: readonly AccessLogEntry[]; readonly error?: string }> {
  const { data, error } = await client
    .from('admin_access_log')
    // `actor_id` and `subject_id` are not selected. Nothing on this page renders them, and a column
    // that is not read cannot be rendered by accident later.
    .select('id, action, created_at, value_after')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error !== null) return { ok: false, entries: [], error: error.message };
  if (data === null) return { ok: false, entries: [], error: 'the log came back empty-handed' };

  return {
    ok: true,
    entries: (data as LogRow[]).map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.created_at,
      valueAfter: row.value_after,
    })),
  };
}
