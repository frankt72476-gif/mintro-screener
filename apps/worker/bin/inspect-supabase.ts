/**
 * Read-only inspection of what is actually in the project.
 *
 *     node --env-file=.env apps/worker/dist/bin/inspect-supabase.js
 *
 * Writes nothing. Exists so a diagnosis is made from the tables rather than from what the
 * migration script believed it did — the two disagreed, and only one of them can be right.
 */

import { createWorkerSupabase } from '../src/store/supabase.js';

interface RunRow {
  id: string;
  status: string;
  finished_at: string | null;
  started_at: string;
  report: unknown | null;
  ruleset_version: string;
  merchant_id: string;
}

async function main(): Promise<number> {
  const supabase = createWorkerSupabase();
  console.log(`project   ${process.env['SUPABASE_URL']}`);
  console.log(`bucket    ${supabase.bucket}\n`);

  // ---- buckets --------------------------------------------------------------------------
  const { data: buckets, error: bucketError } = await supabase.client.storage.listBuckets();
  if (bucketError !== null) {
    console.log(`buckets   could not list: ${bucketError.message}`);
  } else {
    const names = (buckets ?? []).map((b) => `${b.name}${b.public ? ' (PUBLIC)' : ' (private)'}`);
    console.log(`buckets   ${names.join(', ') || 'none'}`);
    const target = (buckets ?? []).find((b) => b.name === supabase.bucket);
    console.log(`          '${supabase.bucket}' ${target === undefined ? 'DOES NOT EXIST' : 'exists'}`);
  }

  // ---- merchants ------------------------------------------------------------------------
  const { data: merchants } = await supabase.client.from('merchants').select('id, domain');
  const byId = new Map((merchants ?? []).map((m) => [(m as { id: string }).id, (m as { domain: string }).domain]));
  console.log(`\nmerchants ${byId.size}`);

  // ---- runs -----------------------------------------------------------------------------
  const { data: runs, error: runsError } = await supabase.client
    .from('runs')
    .select('id, status, finished_at, started_at, report, ruleset_version, merchant_id')
    .order('started_at', { ascending: true });

  if (runsError !== null) {
    console.error(`runs      could not read: ${runsError.message}`);
    return 1;
  }

  const rows = (runs ?? []) as RunRow[];
  console.log(`runs      ${rows.length}\n`);

  console.log('  domain                       status     finished  report  findings  evidence  objects');
  console.log('  ' + '─'.repeat(88));

  for (const run of rows) {
    const { count: findingCount } = await supabase.client
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run.id);

    const { count: evidenceCount } = await supabase.client
      .from('evidence')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run.id);

    // Objects actually in the bucket under this run's prefix.
    let objects = 0;
    for (const layer of ['layer0', 'layer1', 'layer2']) {
      const { data } = await supabase.client.storage
        .from(supabase.bucket)
        .list(`${run.id}/${layer}`, { limit: 1000 });
      objects += (data ?? []).length;
    }

    console.log(
      '  ' +
        (byId.get(run.merchant_id) ?? '—').padEnd(28) +
        ' ' +
        run.status.padEnd(10) +
        ' ' +
        (run.finished_at === null ? 'no ' : 'yes').padEnd(9) +
        ' ' +
        (run.report === null ? 'null  ' : 'set   ') +
        ' ' +
        String(findingCount ?? 0).padStart(8) +
        '  ' +
        String(evidenceCount ?? 0).padStart(8) +
        '  ' +
        String(objects).padStart(7),
    );
  }

  // ---- totals ---------------------------------------------------------------------------
  const { count: allFindings } = await supabase.client
    .from('findings')
    .select('*', { count: 'exact', head: true });
  const { count: allEvidence } = await supabase.client
    .from('evidence')
    .select('*', { count: 'exact', head: true });
  const { count: allSends } = await supabase.client
    .from('sends')
    .select('*', { count: 'exact', head: true });
  const { count: allAnalysts } = await supabase.client
    .from('analysts')
    .select('*', { count: 'exact', head: true });

  console.log(`\ntotals    findings ${allFindings ?? 0} · evidence ${allEvidence ?? 0} · sends ${allSends ?? 0} · analysts ${allAnalysts ?? 0}`);

  const complete = rows.filter((run) => run.status === 'complete').length;
  console.log(`          runs complete ${complete}/${rows.length}`);

  return 0;
}

main().then((code) => process.exit(code));
