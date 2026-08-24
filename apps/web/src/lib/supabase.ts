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

let anonClient: SupabaseClient | null = null;

/**
 * A client for a caller with no account (D-063).
 *
 * The merchant comment route. Same anon key as everywhere else — RLS and the two `security
 * definer` functions decide what it reaches, and neither accepts a run id, so holding this client
 * without a token reaches nothing. Session persistence is off: a merchant is not signing in, and a
 * stored session on a shared machine would outlive their visit.
 *
 * ## One instance, and it is not a micro-optimisation (D-070)
 *
 * This built a **new client on every call**, and it is called from a render body. A React effect
 * keyed on the client therefore refired on every render — three times during mount — firing three
 * concurrent copies of a 107 KB RPC. Whichever resolved last set the page state, so when one
 * duplicate lost its HTTP/2 stream the merchant saw *"The report could not be loaded just now"*
 * even though the report had loaded fine on another of the three.
 *
 * Intermittent, and worse as the payload grew with each comment.
 *
 * A value handed to a hook dependency array **is** part of the interface. `createClient` also
 * registers listeners and warns about multiple `GoTrueClient` instances in one context, which was
 * the console saying this out loud while nothing was reading it.
 */
export function anonymousClient(): SupabaseClient | null {
  const config = readConfig();
  if ('missing' in config) return null;

  anonClient ??= createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anonClient;
}
