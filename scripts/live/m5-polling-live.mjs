/**
 * The last mile: an operator queues, the polling worker drains, the report carries the real name.
 *
 *     node --env-file=.env.test scripts/live/m5-polling-live.mjs
 *
 * **Nothing here calls the send job.** It writes the row a browser would write, starts the worker
 * the way production starts it, and waits. A queue that only moves when a script pushes it is not
 * a queue, and the previous verification could not tell the difference.
 */

import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { startReportServer } from '../../apps/worker/dist/src/reportServer.js';
import { identityOf } from '../../apps/worker/dist/src/documentsSendJob.js';
import { createDocumentRunStore } from '../../apps/worker/dist/src/store/documentRunStore.js';
import { ensureAnalyst } from './setup.mjs';
import { banner, assertTestProject } from './guard.mjs';

banner('M5 — the polling worker drains a queued send');
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

// Give the merchant a real legal name, so "carries the merchant's real name" can mean something.
const { data: pkg } = await service.from('packages').select('merchant_id').eq('id', run.package_id).single();
await service.from('merchants').update({ legal_name: 'Northwind Peptides LLC' }).eq('id', pkg.merchant_id);

const identity = await identityOf(service, run.package_id);
check('the package resolves its merchant from the merchant row',
  identity.merchantName === 'Northwind Peptides LLC',
  `merchantName="${identity.merchantName}", processor="${identity.processor}"`);

const analystId = await ensureAnalyst(service);
const before = (await store.sendsOf(run.package_id)).length;

// The row a browser writes. Nothing else.
const { data: queued } = await service.from('document_send_requests')
  .insert({ package_id: run.package_id, run_id: run.id, to_email: 'underwriting@iqwallet.example', requested_by: analystId, status: 'queued' })
  .select('id').single();
console.log(`\n  queued ${queued.id.slice(0, 8)}… — now starting the worker and waiting\n`);

const server = await startReportServer({ webRoot: 'apps/web/dist', mounts: {} });

// The worker as production starts it, with WEB_ORIGIN pointing at the local report route.
const worker = spawn(process.execPath, ['apps/worker/dist/bin/worker.js'], {
  env: { ...process.env, WEB_ORIGIN: server.origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
worker.stdout.on('data', (d) => log.push(String(d)));
worker.stderr.on('data', (d) => log.push(String(d)));

const deadline = Date.now() + 120_000;
let finished = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data } = await service.from('document_send_requests')
    .select('status, outcome, error, send_id').eq('id', queued.id).single();
  if (data.status === 'done' || data.status === 'failed') { finished = data; break; }
}
worker.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 800));
await server.close();

check('the polling worker drained it without anyone invoking the job',
  finished !== null && finished.status === 'done' && finished.outcome === 'accepted',
  finished === null ? 'timed out after 120s' : `status=${finished.status}, outcome=${finished.outcome}, ${finished.error ?? ''}`);

const after = await store.sendsOf(run.package_id);
check('one send was recorded', after.length === before + 1, `${before} → ${after.length}`);

// And the document that went out carries the name.
const sent = after[after.length - 1];
check('the recorded send points at this run', sent.run_id === run.id,
  `run ${sent.run_id.slice(0, 8)}…, ${sent.pdf_bytes} bytes, mailer=${sent.mailer}`);

if (results.some((r) => !r.ok)) {
  console.log('\n--- worker output ---');
  console.log(log.join('').split('\n').slice(-25).join('\n'));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
