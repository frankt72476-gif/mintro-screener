/**
 * Proves the authenticated-crawl path end to end against the local testbed.
 *
 *     node apps/testbed/server.mjs 8787
 *     npm run auth-check
 *
 * Runs the whole sequence and reports each step: platform detection, scripted login, session
 * storage, reuse on a second run, revalidation after the session is invalidated, and the
 * GATE-002 comparison that all of it exists to make possible.
 *
 * Points at localhost only. M4 creates no accounts on any real merchant site.
 */

import { chromium } from 'playwright';
import { createVault, createMemoryBackend, encrypt, keyFromToken } from '../src/auth/vault.js';
import { establishSession } from '../src/auth/login.js';
import { probePaths } from '../src/probe.js';
import { runCheckoutFlow } from '../src/flow.js';
import { checkFlowProbe, checkHttpProbe, loadRulesetFromDisk } from '../src/rules.js';

const ORIGIN = process.argv[2] ?? 'http://localhost:8787';
const VAULT_REF = 'merchants/testbed';
const TOKEN = 'testbed-vault-token-not-a-real-secret';

async function main(): Promise<number> {
  const ruleset = loadRulesetFromDisk();
  const gate002 = ruleset.rules.find((rule) => rule.id === 'GATE-002');
  if (gate002 === undefined || gate002.type !== 'http_probe') {
    console.error('GATE-002 is not an http_probe rule');
    return 1;
  }

  // The vault is seeded with the testbed's fictional account, encrypted exactly as a real one
  // would be — there is no unencrypted path through this module even in a dev harness.
  const key = keyFromToken(TOKEN);
  const backend = createMemoryBackend({
    [`${VAULT_REF}/credentials`]: encrypt(
      JSON.stringify({
        username: 'screening@mintro.test',
        password: 'testbed-only-not-a-real-secret',
        loginUrl: `${ORIGIN}/account/login`,
      }),
      key,
    ),
  });
  const vault = createVault(backend, TOKEN);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    const homepageHtml = await fetch(ORIGIN).then((r) => r.text());

    // ---- 1. first run: no stored session, so a scripted login must happen ---------------
    console.log('\n── run 1 ──────────────────────────────────────────────');
    const first = await establishSession({ browser, origin: ORIGIN, vault, vaultRef: VAULT_REF, homepageHtml });
    for (const step of first.steps) console.log(`  · ${step}`);
    if (first.context === null) {
      console.error(`  FAILED: ${first.needsHuman}`);
      return 1;
    }
    console.log(`  session: ${first.session.mode} (${first.session.origin})`);

    // ---- 2. the comparison GATE-002 exists to make --------------------------------------
    const anonymous = await probePaths(browser, ORIGIN, gate002.params.paths, { authenticated: null });
    const authenticated = await probePaths(browser, ORIGIN, gate002.params.paths, {
      authenticated: first.context,
    });

    const anonFinding = checkHttpProbe(gate002, { results: anonymous, session: { mode: 'unauthenticated', origin: 'none' } });
    const authFinding = checkHttpProbe(gate002, { results: authenticated, session: first.session });

    // GATE-002 pins `unauthenticated: true`, so the unauthenticated probe IS the finding. The
    // authenticated probe is the contrast that gives it meaning: it establishes the catalogue
    // exists and is reachable with an account, which separates "gated" from "broken or empty".
    console.log('\n  GATE-002 finding (the rule pins an unauthenticated probe):');
    console.log(`    ${anonFinding.state.toUpperCase()} — ${anonFinding.note}`);
    console.log('  contrast, same paths with the screening account — context, not a finding:');
    console.log(
      `    catalogue reachable when signed in: ${authenticated.some((r) => r.status === 200) ? 'yes' : 'no'}`,
    );
    void authFinding;

    // ---- GATE-003: the same comparison, driven through checkout -------------------------
    const gate003 = ruleset.rules.find((rule) => rule.id === 'GATE-003');
    if (gate003 !== undefined && gate003.type === 'flow_probe') {
      const productUrl = `${ORIGIN}/products/bpc-157-5mg`;

      const anonContext = await browser.newContext();
      const anonFlow = await runCheckoutFlow(anonContext, { productUrl, origin: ORIGIN });
      await anonContext.close();

      const authFlow = await runCheckoutFlow(first.context, { productUrl, origin: ORIGIN });

      const anonFlowFinding = checkFlowProbe(gate003, {
        observation: anonFlow,
        session: { mode: 'unauthenticated', origin: 'none' },
      });

      console.log('\n  GATE-003 finding (the rule pins an unauthenticated flow):');
      console.log(`    ${anonFlowFinding.state.toUpperCase()} — ${anonFlowFinding.note}`);
      console.log('  contrast, same flow with the screening account — context, not a finding:');
      console.log(`    reached '${authFlow.reached}' via ${authFlow.steps.join(' → ')}`);

      if (anonFlowFinding.state !== 'pass') {
        console.error('  UNEXPECTED: the testbed gates checkout and should not fail GATE-003');
        return 1;
      }
      if (authFlow.reached !== 'payment_step_reached') {
        console.error('  UNEXPECTED: a signed-in flow should reach the payment step');
        return 1;
      }
    }

    await first.context.close();

    // ---- 3. second run: the stored session should be reused, not re-created --------------
    console.log('\n── run 2 (session reuse) ──────────────────────────────');
    const second = await establishSession({ browser, origin: ORIGIN, vault, vaultRef: VAULT_REF, homepageHtml });
    for (const step of second.steps) console.log(`  · ${step}`);
    console.log(`  session: ${second.session.mode} (${second.session.origin})`);
    await second.context?.close();

    if (second.session.origin !== 'reused') {
      console.error('  FAILED: a stored session was not reused');
      return 1;
    }

    // ---- 4. a stale session must be detected and replaced, not trusted -------------------
    console.log('\n── run 3 (stored session no longer valid) ─────────────');
    await vault.writeSession(
      VAULT_REF,
      { state: { cookies: [], origins: [] }, establishedAt: new Date().toISOString(), platform: 'shopify' },
      'testbed: invalidate the stored session',
    );
    const third = await establishSession({ browser, origin: ORIGIN, vault, vaultRef: VAULT_REF, homepageHtml });
    for (const step of third.steps) console.log(`  · ${step}`);
    console.log(`  session: ${third.session.mode} (${third.session.origin})`);
    await third.context?.close();

    if (third.session.origin !== 'scripted_login') {
      console.error('  FAILED: a stale session was reused instead of being replaced');
      return 1;
    }

    // ---- 5. the audit trail ---------------------------------------------------------------
    console.log('\n── vault access log ───────────────────────────────────');
    for (const entry of vault.accessLog()) {
      console.log(`  ${entry.action.padEnd(18)} ${entry.outcome.padEnd(10)} ${entry.purpose}`);
    }

    const leaked = JSON.stringify(vault.accessLog()).includes('testbed-only-not-a-real-secret');
    console.log(`\n  credential in the access log: ${leaked ? 'YES — DEFECT' : 'no'}`);
    if (leaked) return 1;

    console.log('\nOK — reuse, revalidation, re-login and the authenticated comparison all work.');
    return 0;
  } finally {
    await browser.close();
  }
}

main().then((code) => process.exit(code));
