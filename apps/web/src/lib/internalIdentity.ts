/**
 * Who did the work, for the people entitled to know (D-233).
 *
 * The outbound-surfaces pass removed operator identity from everything that leaves the building:
 * the merchant comment page, the PDF that reaches IQwallet, the anonymous payload. It replaced the
 * recorder's address with a boolean and a timestamp, and `runs.created_by` renders as a uuid on
 * every internal surface because nothing resolves it.
 *
 * D-233 named the other half and deferred it to this stage: **a separate, authenticated assembly**
 * that does carry the name, gated by RLS. This is that assembly.
 *
 * ## Two rules, and they are the whole of this file's reason to exist separately
 *
 * **It is never merged into the print or outbound payload.** Not as a field on the report, not
 * behind a `print` flag on a shared function. A single assembly with a flag is one forgotten flag
 * away from the leak that was just closed, and the flag would be set by whichever caller happened
 * to be last. `apps/web/test/internalIdentityIsNotOutbound.test.ts` asserts that nothing on the
 * print path imports this module — the guarantee is structural rather than remembered.
 *
 * **The scoping is RLS's, not this file's.** Every read here goes through `analysts_select`
 * (0060): your own row, your own organisation's members, everything if you are the owner or a
 * host-org member. A partner reading a report their organisation produced resolves a colleague's
 * name and nobody else's, and this module contains no predicate of its own that could disagree
 * with that one. A name that does not resolve comes back absent, which is what an unresolvable
 * name is.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** What an internal surface shows in place of a uuid. */
export interface Person {
  readonly id: string;
  /** The display name, or the address where no name was recorded. Never empty. */
  readonly name: string;
}

interface AnalystRow {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string;
}

/**
 * A name is what somebody is called; an address is what is left when nobody wrote one down.
 *
 * `full_name` is nullable on `analysts` (0001) and the invite form makes it required, but rows
 * created before this stage may carry none. Falling back to the address keeps the column readable
 * rather than rendering a blank where a person should be — the defect the operator-recorded
 * attribution had before 0061.
 */
const nameOf = (row: AnalystRow): string =>
  row.full_name !== null && row.full_name.trim() !== '' ? row.full_name : row.email;

/**
 * Resolves analyst ids to people, for a set of ids.
 *
 * Returns only what RLS allowed. A caller asking about somebody in another organisation gets no
 * entry for them, and must render that as unattributed rather than as an error: it is not a
 * failure, it is the boundary working.
 */
export async function peopleByIds(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, Person>> {
  const wanted = [...new Set(ids.filter((id) => id !== ''))];
  if (wanted.length === 0) return new Map();

  const { data, error } = await client
    .from('analysts')
    .select('id, full_name, email')
    .in('id', wanted);

  // An error is not an empty roster. The caller renders unattributed either way, but conflating
  // them here would hide a broken query behind a boundary that looks like it is doing its job.
  if (error !== null || data === null) return new Map();

  return new Map(
    (data as AnalystRow[]).map((row) => [row.id, { id: row.id, name: nameOf(row) }]),
  );
}

/**
 * Who started each of these runs, for the owner/host "Run by" column.
 *
 * Takes the runs rather than the ids so the caller cannot accidentally hand this a list gathered
 * from somewhere it should not have looked: the ids come off rows the caller already read, and
 * those reads were already scoped by `runs_select`.
 */
export async function runCreators(
  client: SupabaseClient,
  runs: readonly { readonly id: string; readonly created_by?: string | null }[],
): Promise<Map<string, Person>> {
  const byRun = new Map<string, Person>();
  const ids = runs.map((run) => run.created_by ?? '').filter((id) => id !== '');
  const people = await peopleByIds(client, ids);

  for (const run of runs) {
    const person = run.created_by === null || run.created_by === undefined
      ? undefined
      : people.get(run.created_by);
    if (person !== undefined) byRun.set(run.id, person);
  }
  return byRun;
}

/**
 * Who recorded the operator-written commentary on a run, by name.
 *
 * The outbound payload carries `recordedByOperator` and `recordedAt` and no address (D-233). This
 * reads the address column directly and resolves it to a person — for an authenticated surface
 * only, and never for anything that renders into the report.
 *
 * Keyed by the address rather than by `recorded_by`, because the row stores both and the address is
 * the one that is stable against a later re-org: 0053 keeps it precisely so a row still says what it
 * said when it was written.
 */
export async function commentRecorders(
  client: SupabaseClient,
  runId: string,
): Promise<Map<string, Person>> {
  const { data, error } = await client
    .from('merchant_comments')
    .select('recorded_by, recorded_by_email')
    .eq('run_id', runId)
    .not('recorded_by', 'is', null);

  if (error !== null || data === null) return new Map();

  const rows = data as { recorded_by: string | null; recorded_by_email: string | null }[];
  const people = await peopleByIds(
    client,
    rows.map((row) => row.recorded_by ?? '').filter((id) => id !== ''),
  );

  const byAddress = new Map<string, Person>();
  for (const row of rows) {
    if (row.recorded_by_email === null) continue;
    const person = row.recorded_by === null ? undefined : people.get(row.recorded_by);
    byAddress.set(
      row.recorded_by_email.toLowerCase(),
      person ?? { id: row.recorded_by ?? '', name: row.recorded_by_email },
    );
  }
  return byAddress;
}
