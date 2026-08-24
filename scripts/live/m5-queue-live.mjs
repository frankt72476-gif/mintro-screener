/**
 * The send queue, live: an operator's request drained by the worker.
 *
 *     node --env-file=.env.test scripts/live/m5-queue-live.mjs
 *
 * Covers the path the modal actually uses — queue a request, let the job claim it, render, send,
 * record — and the refusal that matters: a run the package has moved past never reaches a PDF.
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { claimNextSend, runSend } from '../../apps/worker/dist/src/documentsSendJob.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { ensureAnalyst } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('M5 — the send queue, live');
const { url } = assertTestProject();
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const store = createDocumentRunStore(service);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n         ${detail}`);
};

const { data: run } = await service
  .from('document_runs').select('id, package_id').order('created_at', { ascending: false }).limit(1).single();
const analystId = await ensureAnalyst(service);

const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const deps = { client: service, browser, origin: server.origin, merchantName: 'Northwind Peptides LLC', dba: 'Northwind Labs', processor: 'Default' };

try {
  const before = (await store.sendsOf(run.package_id)).length;

  const { data: queued } = await service.from('document_send_requests')
    .insert({ package_id: run.package_id, run_id: run.id, to_email: 'underwriting@iqwallet.example', requested_by: analystId, status: 'queued' })
    .select('id, status').single();
  check('the operator queued a request', queued?.status === 'queued', `request ${queued.id.slice(0, 8)}…`);

  const claimed = await claimNextSend(service);
  check('the worker claimed it', claimed?.id === queued.id, `claimed ${claimed?.id?.slice(0, 8)}…`);

  // A second worker must not get the same row.
  const second = await claimNextSend(service);
  check('a second worker does not claim the same request', second === null || second.id !== claimed.id,
    second === null ? 'nothing left to claim' : `claimed a different one (${second.id.slice(0, 8)}…)`);

  await runSend(claimed, deps);
  const { data: done } = await service.from('document_send_requests').select('status, outcome, error, send_id').eq('id', queued.id).single();
  const after = await store.sendsOf(run.package_id);

  check('the request finished and points at its send',
    done.status === 'done' && done.outcome === 'accepted' && done.send_id !== null,
    `status=${done.status}, outcome=${done.outcome}, send ${String(done.send_id).slice(0, 8)}…`);
  check('exactly one send was recorded', after.length === before + 1, `${before} → ${after.length}`);

  // --- and the refusal -----------------------------------------------------------------------
  // Move the package: a slot changes state. The run no longer describes it.
  const { data: slot } = await service.from('slots').select('id, state').eq('package_id', run.package_id).eq('state', 'satisfied').limit(1).single();
  await service.from('slots').update({ state: 'missing' }).eq('id', slot.id);

  const { data: stale } = await service.from('document_send_requests')
    .insert({ package_id: run.package_id, run_id: run.id, to_email: 'underwriting@iqwallet.example', requested_by: analystId, status: 'queued' })
    .select('id').single();
  const staleClaim = await claimNextSend(service);
  const sendsBeforeStale = (await store.sendsOf(run.package_id)).length;
  await runSend(staleClaim, deps);

  const { data: refused } = await service.from('document_send_requests').select('status, error').eq('id', stale.id).single();
  const sendsAfterStale = (await store.sendsOf(run.package_id)).length;

  check('a stale run is refused, and the refusal names what moved',
    refused.status === 'failed' && /is stale/.test(refused.error ?? '') && /slot moved from satisfied to missing/.test(refused.error ?? ''),
    (refused.error ?? '').slice(0, 130));
  check('nothing was sent for the stale run', sendsAfterStale === sendsBeforeStale,
    `${sendsBeforeStale} → ${sendsAfterStale}; no PDF was rendered and no row written`);

  await service.from('slots').update({ state: slot.state }).eq('id', slot.id);
} finally {
  await browser.close().catch(() => undefined);
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`failed: ${failed.map((f) => f.name).join('; ')}`);
process.exit(failed.length === 0 ? 0 : 1);
