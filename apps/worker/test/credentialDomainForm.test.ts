/**
 * A deposit and a scan of the same storefront key to the same vault entry.
 *
 * `www.merchant.com` and `merchant.com` are one storefront. They were two vault keys.
 *
 * The deposit side folds whatever the analyst typed in the modal — a field D-185 made editable, so
 * it does not have to be the URL in the scan form. The lookup side folds `new URL(request.url)
 * .hostname`. Both fold correctly; they were folding **different strings**, and neither could tell.
 *
 * ## Why it fails in the direction that matters
 *
 * `vault.open` answering `null` is indistinguishable from nothing having been deposited, and the
 * run says so in D-185's exact words for the other case: *"no screening account is stored for this
 * merchant."* So a credential a merchant did supply is reported as one they never supplied, and
 * whoever holds the relationship is sent to ask them again for something they already gave us.
 *
 * That is the shape D-036 and D-026 are both about: a control that cannot tell *"there is nothing
 * here"* from *"I looked in the wrong place"*, and answers with the first.
 *
 * ## What is asserted
 *
 * Agreement, in both directions, through a real vault round trip rather than on the key strings
 * alone — the round trip is what a wrong key actually breaks. And the fold is bounded: two
 * genuinely different storefronts must still key apart, or the fix would merge merchants, which is
 * a worse defect than the one it closes.
 */

import { describe, expect, it } from 'vitest';
import {
  createMemoryBackend,
  createVault,
  encrypt,
  keyFromToken,
  type MerchantCredentials,
} from '../src/auth/vault.js';
import { vaultRefFor } from '../src/auth/supabaseVault.js';

const TOKEN = 'a-token-long-enough-to-derive-a-key-from';

const LOGIN: MerchantCredentials = {
  username: 'screening@merchant.test',
  password: 'testbed-only-not-a-real-secret',
};

/**
 * Deposits under one host form and reads under the other.
 *
 * `deposited` is what an analyst typed into the credential modal; `scanned` is the hostname the
 * crawl derives from the queued URL. Both go through `vaultRefFor`, which is the single choke
 * point every vault path passes — the deposit drain and the scan lookup both build their key with
 * it. The read is a real decryption, so what is asserted is that the credential comes back, not
 * that two strings match.
 */
async function depositThenLookUp(
  deposited: string,
  scanned: string,
): Promise<MerchantCredentials | null> {
  const backend = createMemoryBackend({
    [`${vaultRefFor(deposited)}/credentials`]: encrypt(JSON.stringify(LOGIN), keyFromToken(TOKEN)),
  });

  return createVault(backend, TOKEN).open(vaultRefFor(scanned), `screening scan of ${scanned}`);
}

describe('a deposit and a scan of one storefront reach one vault entry', () => {
  it('keys www and the bare domain identically', () => {
    expect(vaultRefFor('www.merchant.com')).toBe(vaultRefFor('merchant.com'));
  });

  it('finds a credential deposited bare when the scan carries www', async () => {
    expect(await depositThenLookUp('merchant.com', 'www.merchant.com')).toEqual(LOGIN);
  });

  it('finds a credential deposited under www when the scan carries the bare domain', async () => {
    expect(await depositThenLookUp('www.merchant.com', 'merchant.com')).toEqual(LOGIN);
  });

  it('folds a URL the same way it folds a bare host', () => {
    // The modal accepts a pasted URL; the crawl supplies a hostname. One storefront either way.
    expect(vaultRefFor('https://www.merchant.com/shop/thing')).toBe(vaultRefFor('merchant.com'));
  });

  /**
   * The bound on the fold.
   *
   * Merging two storefronts would be a worse defect than the one this closes: it would offer one
   * merchant's screening account to another merchant's crawl. Only the `www` label folds.
   */
  it('keeps genuinely different storefronts apart', () => {
    expect(vaultRefFor('merchant.com')).not.toBe(vaultRefFor('other-merchant.com'));
    expect(vaultRefFor('shop.merchant.com')).not.toBe(vaultRefFor('merchant.com'));
    expect(vaultRefFor('merchant.com')).not.toBe(vaultRefFor('merchant.co'));
  });

  it('does not strip a label that is the whole name', () => {
    // `www.com` is a domain in its own right. Stripping to `com` would not be a storefront.
    expect(vaultRefFor('www.com')).toBe(vaultRefFor('www.com'));
    expect(vaultRefFor('www.com')).not.toBe(vaultRefFor('com'));
  });
});
