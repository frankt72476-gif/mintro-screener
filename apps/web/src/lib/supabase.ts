/**
 * The browser's Supabase client.
 *
 * **Anon key only.** Anything prefixed `VITE_` is compiled into the bundle and is public — the
 * service key must never appear here (hard constraint 6, docs/DEPLOY.md). The anon key is not a
 * secret; it is an identifier that RLS then constrains. Everything the browser can read, it can
 * read because a policy in `supabase/migrations/` says an active analyst may.
 *
 * If you find yourself wanting the service key in this file, the logic belongs in the worker.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

/** Reads the frontend configuration, or explains what is missing. */
export function readConfig(): SupabaseConfig | { readonly missing: string[] } {
  const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
  const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

  const missing: string[] = [];
  if (url === undefined || url === '') missing.push('VITE_SUPABASE_URL');
  if (anonKey === undefined || anonKey === '') missing.push('VITE_SUPABASE_ANON_KEY');

  return missing.length > 0 ? { missing } : { url: url!, anonKey: anonKey! };
}

let client: SupabaseClient | null = null;

/** The shared client. One instance, so the auth session is not split across copies. */
export function supabase(config: SupabaseConfig): SupabaseClient {
  client ??= createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
