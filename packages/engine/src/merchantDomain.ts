/**
 * One storefront, one key.
 *
 * `www.merchant.com` and `merchant.com` are the same shop, and the credential path treated them as
 * two. The deposit side folded whatever an analyst typed into the credential modal — a field D-185
 * made editable, so it need not be the URL in the scan form. The lookup side folded
 * `new URL(request.url).hostname`. Both folded correctly and they were folding different strings.
 *
 * The failure is silent and points the wrong way. `vault.open` answering `null` is
 * indistinguishable from nothing having been deposited, and the run reports it in D-185's exact
 * words for that other case — *"no screening account is stored for this merchant"*. A credential
 * the merchant did supply is reported as one they never supplied, and the reader is sent to ask
 * them for it again.
 *
 * ## Written once, for the same reason `sealed.ts` is
 *
 * The browser folds a domain before it seals a deposit; the worker folds one before it opens the
 * vault. A format with two implementations agrees until it does not (D-038, D-034), and here what
 * would diverge is which merchant a screening account belongs to. So this is one function, in the
 * package both sides already import, exported from the browser entry as well as the Node one.
 *
 * ## Only the `www` label folds
 *
 * Merging two storefronts is a worse defect than the one this closes — it would offer one
 * merchant's screening account to another merchant's crawl. So `shop.merchant.com` keeps its
 * label, and `www.com` is left alone, because stripping it leaves `com`, which is not a storefront.
 *
 * ## What this is not
 *
 * **Not `merchants.domain`.** That column is the crawl's identity for a merchant, written as
 * `new URL(url).host` and folded by D-150 without stripping `www`. It keys `runs.merchant_id`, and
 * repointing runs at a different merchant is a write to a run (D-002). Nothing here touches it:
 * this is the vault key and the credential-state key, which are neither evidence nor runs.
 */

/**
 * The shape a merchant domain has to have.
 *
 * Character for character the constraint `credential_deposits.merchant_domain` has carried since
 * migration 0013, and `merchants.domain` since 0046. The one place the rule is written down is the
 * one place it holds — so it is written down here too, rather than approximated.
 */
const MERCHANT_DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * The canonical vault-facing form of a merchant domain, or null when it is not one.
 *
 * Accepts a bare host or a full URL, because the modal takes a pasted address and the crawl
 * supplies a hostname, and both must land on the same answer.
 *
 *     https://WWW.Merchant.com/shop/thing  →  merchant.com
 *     www.merchant.com                     →  merchant.com
 *     merchant.com                         →  merchant.com
 *     shop.merchant.com                    →  shop.merchant.com
 *     www.com                              →  www.com
 *     not a domain                         →  null
 */
export function canonicalMerchantDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '') return null;

  const candidate = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  let hostname: string;
  try {
    ({ hostname } = new URL(candidate));
  } catch {
    return null;
  }

  /*
    Stripped only when what remains is still a domain.

    `www.com` is a real name whose `www` is the whole of it, and folding it to `com` would key a
    storefront to a TLD. Testing the remainder rather than special-casing the string means the same
    reasoning covers whatever else has this shape.
  */
  const stripped = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  const folded = MERCHANT_DOMAIN.test(stripped) ? stripped : hostname;

  return MERCHANT_DOMAIN.test(folded) ? folded : null;
}
