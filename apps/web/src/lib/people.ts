/**
 * The roster, and the three things the owner does to it (D-228 … D-232).
 *
 * Reads go through RLS: `analysts_select` (0060) gives the owner every row, and would give a
 * partner only their own organisation's — which is why the route guard, not this module, is what
 * keeps People owner-only. A partner reaching here would see a short, correct, useless list.
 *
 * Writes go through the `security definer` functions in 0067 rather than through table grants.
 * `authenticated` holds no UPDATE on `analysts` and no INSERT on `admin_access_log`, deliberately:
 * a grant would let the flag flip and its log line be two statements, and anything between them
 * leaves a capability granted with nothing recording who granted it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly role: 'owner' | 'admin';
  readonly status: 'invited' | 'active' | 'suspended';
  readonly canRunDocumentsCheck: boolean;
  readonly canSubmitToIqwallet: boolean;
  /** Runs this person started. Kept through suspension (D-232). */
  readonly runCount: number;
}

interface RosterRow {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string;
  readonly org_id: string;
  readonly role: string;
  readonly status: string;
  readonly can_run_documents_check: boolean;
  readonly can_submit_to_iqwallet: boolean;
  readonly organizations: { readonly name: string } | { readonly name: string }[] | null;
}

const orgNameOf = (embed: RosterRow['organizations']): string => {
  if (embed === null) return '—';
  const one = Array.isArray(embed) ? embed[0] : embed;
  return one?.name ?? '—';
};

export interface RosterResult {
  readonly ok: boolean;
  readonly roster: readonly RosterEntry[];
  readonly error?: string;
}

/**
 * The roster with each person's run count.
 *
 * The count is a second query rather than an embedded aggregate. `runs` is scoped by `runs_select`,
 * so an embed would return counts filtered by the reader's own visibility and silently report a
 * different number than the one the column claims to show — for the owner they agree, and the day
 * a host member opens this screen they would not.
 */
export async function readRoster(client: SupabaseClient): Promise<RosterResult> {
  const { data, error } = await client
    .from('analysts')
    .select(
      'id, full_name, email, org_id, role, status, can_run_documents_check, can_submit_to_iqwallet, organizations ( name )',
    )
    .order('role', { ascending: true })
    .order('email', { ascending: true });

  if (error !== null) return { ok: false, roster: [], error: error.message };
  if (data === null) return { ok: false, roster: [], error: 'the roster came back empty-handed' };

  const rows = data as unknown as RosterRow[];
  const counts = await runCounts(client, rows.map((row) => row.id));

  return {
    ok: true,
    roster: rows.map((row) => ({
      id: row.id,
      name: row.full_name !== null && row.full_name.trim() !== '' ? row.full_name : row.email,
      email: row.email,
      orgId: row.org_id,
      orgName: orgNameOf(row.organizations),
      role: row.role === 'owner' ? 'owner' : 'admin',
      status: row.status === 'suspended' ? 'suspended' : row.status === 'invited' ? 'invited' : 'active',
      canRunDocumentsCheck: row.can_run_documents_check,
      canSubmitToIqwallet: row.can_submit_to_iqwallet,
      runCount: counts.get(row.id) ?? 0,
    })),
  };
}

async function runCounts(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;

  const { data, error } = await client.from('runs').select('created_by').in('created_by', [...ids]);
  if (error !== null || data === null) return counts;

  for (const row of data as { created_by: string | null }[]) {
    if (row.created_by === null) continue;
    counts.set(row.created_by, (counts.get(row.created_by) ?? 0) + 1);
  }
  return counts;
}

/** What an owner action answered. Errors are data — the functions never raise (0067). */
export interface ActResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly changed?: boolean;
}

const call = async (
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<ActResult> => {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error !== null) return { ok: false, reason: error.message };
    const outcome = data as ActResult | null;
    return outcome ?? { ok: false, reason: 'no answer' };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
};

/** Flips a capability and records it, in one transaction. Sets no gate — that is Stage 5. */
export const setCapability = (
  client: SupabaseClient,
  analystId: string,
  capability: 'can_run_documents_check' | 'can_submit_to_iqwallet',
  value: boolean,
): Promise<ActResult> =>
  call(client, 'set_analyst_capability', {
    p_analyst: analystId,
    p_capability: capability,
    p_value: value,
  });

/** Suspension is the only exit (D-097). Reinstatement returns to active. */
export const setSuspended = (
  client: SupabaseClient,
  analystId: string,
  suspended: boolean,
): Promise<ActResult> =>
  call(client, 'set_analyst_suspended', { p_analyst: analystId, p_suspended: suspended });

/** Creates a partner organisation, or returns the one already carrying that name. Never a host. */
export const createPartnerOrg = (
  client: SupabaseClient,
  name: string,
): Promise<ActResult & { readonly id?: string }> =>
  call(client, 'create_partner_org', { p_name: name }) as Promise<ActResult & { id?: string }>;

/**
 * Asks for another link for somebody already on the roster.
 *
 * A request, like a first invitation: the browser holds no service key and cannot mint a link. The
 * drain picks it up, mints a `recovery` link — `invite` is refused for an address that already
 * exists — and writes `invite_resent`.
 */
export async function requestResend(
  client: SupabaseClient,
  person: RosterEntry,
  requestedBy: string,
): Promise<ActResult> {
  const { error } = await client.from('analyst_invites').insert({
    email: person.email,
    full_name: person.name,
    org_id: person.orgId,
    can_run_documents_check: person.canRunDocumentsCheck,
    can_submit_to_iqwallet: person.canSubmitToIqwallet,
    requested_by: requestedBy,
    kind: 'resend',
    status: 'queued',
  });
  if (error !== null) {
    // The partial unique index refuses a second live request for one address, which is the answer
    // rather than an error: one is already on its way.
    return { ok: false, reason: /analyst_invites_one_pending/.test(error.message)
      ? 'An invitation for this person is already queued.'
      : error.message };
  }
  return { ok: true, changed: true };
}

export interface OrgOption {
  readonly id: string;
  readonly name: string;
  readonly type: 'host' | 'partner';
}

/** The organisations the invite form offers. Scoped by `organizations_select` (0060). */
export async function readOrgs(client: SupabaseClient): Promise<readonly OrgOption[]> {
  const { data, error } = await client.from('organizations').select('id, name, type').order('name');
  if (error !== null || data === null) return [];
  return (data as { id: string; name: string; type: string }[]).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === 'host' ? 'host' : 'partner',
  }));
}
