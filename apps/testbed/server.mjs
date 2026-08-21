/**
 * A local test storefront.
 *
 * M4 must not create accounts on any real merchant site, so scripted login is developed and
 * proven here. This serves two storefronts that imitate the markers and login forms the real
 * platforms use:
 *
 *     /shopify/…   Shopify customer login at /account/login, gated /collections/all
 *     /woo/…       WooCommerce login at /my-account/, gated /shop/
 *
 * Both gate their catalogue behind a session, which is what GATE-002 and GATE-003 ask about. The
 * point is not fidelity to Shopify's markup — it is that the *shape* of the problem is real: a
 * login form, a session cookie, a catalogue that answers differently depending on it.
 *
 *     node apps/testbed/server.mjs [port]
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2] ?? 8787);

/** The only account that exists here. Fictional, local, and never a real merchant's. */
const ACCOUNT = { username: 'screening@mintro.test', password: 'testbed-only-not-a-real-secret' };

const sessions = new Set();

const page = (title, body, marker) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>${marker}</head>
<body><header><nav><a href="/">Home</a></nav></header>${body}
<footer><p><em><strong>For research and laboratory use only. Not for human or animal consumption.</strong></em></p></footer>
</body></html>`;

const SHOPIFY_MARKER = '<script src="https://cdn.shopify.com/s/files/1/theme.js"></script>';
const WOO_MARKER = '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">';

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  );
}

const signedIn = (req) => sessions.has(cookies(req).mintro_session);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

/* --------------------------------------------------------------------------------------- */

const shopify = {
  marker: SHOPIFY_MARKER,
  loginPath: '/account/login',
  logoutMarker: '<a href="/account/logout">Log out</a>',
  loginForm: `<form method="post" action="/account/login">
      <input id="CustomerEmail" name="customer[email]" type="email" required>
      <input id="CustomerPassword" name="customer[password]" type="password" required>
      <button type="submit">Sign in</button>
    </form>`,
  gated: '/collections/all',
  account: '/account',
};

const woo = {
  marker: WOO_MARKER,
  loginPath: '/woo/my-account/',
  logoutMarker: '<a href="/woo/my-account/customer-logout">Log out</a>',
  loginForm: `<form method="post" action="/woo/my-account/">
      <input id="username" name="username" type="text" required>
      <input id="password" name="password" type="password" required>
      <button type="submit" name="login" value="Log in">Log in</button>
    </form>`,
  gated: '/woo/shop/',
  account: '/woo/my-account/',
};

const PRODUCTS = [
  'bpc-157-5mg',
  'tb-500-10mg',
  'sermorelin-ipamorelin-blend',
  'hcg-5000-iu',
  'nmn-capsules',
];

const catalogue = (base) =>
  `<ul>${PRODUCTS.map((p) => `<li class="product"><a href="${base}/products/${p}">${p}</a></li>`).join('')}</ul>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  // Shopify is served at the root so GATE-002's own paths (/collections/all, /products, /shop)
  // reach it unchanged. WooCommerce lives under /woo.
  const shop = path.startsWith('/woo') ? woo : shopify;
  const base = path.startsWith('/woo') ? '/woo' : '';

  // ---- robots and sitemap, so Layer 0 has something to read ----------------------------
  if (path === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`User-agent: *\nCrawl-delay: 1\nSitemap: http://localhost:${PORT}/sitemap.xml\n`);
    return;
  }
  if (path === '/sitemap.xml') {
    const urls = [
      ...PRODUCTS.map((p) => `http://localhost:${PORT}/products/${p}`),
      `http://localhost:${PORT}/collections/all`,
      `http://localhost:${PORT}/pages/affiliate-program`,
    ];
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(`<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`);
    return;
  }

  // ---- login ---------------------------------------------------------------------------
  if (path === '/cart/add' && req.method === 'POST') {
    send(res, 302, '', { location: '/cart' });
    return;
  }

  if (path === shop.loginPath && req.method === 'POST') {
    const form = await body(req);
    const user = form.get('customer[email]') ?? form.get('username') ?? '';
    const pass = form.get('customer[password]') ?? form.get('password') ?? '';

    if (user === ACCOUNT.username && pass === ACCOUNT.password) {
      const id = randomUUID();
      sessions.add(id);
      send(res, 302, '', { location: shop.account, 'set-cookie': `mintro_session=${id}; Path=/; HttpOnly` });
      return;
    }
    // A failed login returns the form again with an error — the case that must not be mistaken
    // for success, and the reason login is verified by a signed-in marker rather than by status.
    send(res, 200, page('Sign in', `<p class="error">Incorrect email or password.</p>${shop.loginForm}`, shop.marker));
    return;
  }

  if (path === shop.loginPath || path === shop.account) {
    if (signedIn(req)) {
      send(res, 200, page('Account', `<h1>Account</h1>${shop.logoutMarker}<nav class="woocommerce-MyAccount-navigation"><a href="${shop.gated}">Orders</a></nav>`, shop.marker));
      return;
    }
    send(res, 200, page('Sign in', `<h1>Sign in</h1>${shop.loginForm}`, shop.marker));
    return;
  }

  // ---- the gated catalogue — what GATE-002 is about ------------------------------------
  if (path === shop.gated || path === `${shop.gated}/`) {
    if (!signedIn(req)) {
      // Anonymous visitors are redirected to the login form: the compliant behaviour.
      send(res, 302, '', { location: shop.loginPath });
      return;
    }
    send(res, 200, page('Catalogue', `<h1>All products</h1>${catalogue(base)}${shop.logoutMarker}`, shop.marker));
    return;
  }

  // ---- cart and checkout — what GATE-003 is about --------------------------------------
  //
  // The compliant behaviour: an anonymous visitor may fill a cart but is stopped at checkout and
  // sent to sign in. A signed-in visitor reaches the payment step. GATE-003 fails a merchant
  // whose anonymous session reaches payment.
  if (path === '/cart' || path === '/cart/add') {
    send(res, 200, page('Cart', `<h1>Cart</h1><ul><li>bpc-157-5mg</li></ul>
      <form method="get" action="/checkout"><button type="submit" name="checkout">Checkout</button></form>`, shop.marker));
    return;
  }

  if (path === '/checkout') {
    if (!signedIn(req)) {
      send(res, 302, '', { location: shop.loginPath });
      return;
    }
    send(res, 200, page('Checkout', `<h1>Checkout</h1>
      <form id="payment-form" method="post" action="/checkout/pay">
        <input name="card_number" autocomplete="cc-number" placeholder="Card number">
        <input name="card_cvc" autocomplete="cc-csc" placeholder="CVC">
        <button type="submit">Pay now</button>
      </form>`, shop.marker));
    return;
  }

  if (path.startsWith(`${base}/products/`)) {
    const name = path.split('/').pop() ?? '';
    send(res, 200, page(name, `<h1>${name}</h1><p>CAS 137525-51-0. Molecular weight 1419.5 g/mol. Store at -20C.</p>
      <a href="/coa/${name}.pdf">Certificate of Analysis</a>
      <form method="post" action="/cart/add"><button type="submit" name="add">Add to cart</button></form>`, shop.marker));
    return;
  }

  if (path === '/' || path === '/index.html') {
    send(res, 200, page('Testbed storefront', `<h1>Mintro testbed</h1>
      <p>A local storefront for developing authenticated crawling. Not a real merchant.</p>
      <ul><li><a href="/account/login">Shopify-style login</a></li>
      <li><a href="/woo/my-account/">WooCommerce-style login</a></li></ul>`, SHOPIFY_MARKER));
    return;
  }

  send(res, 404, page('Not found', '<h1>Not found</h1>', shop.marker));
});

server.listen(PORT, () => {
  console.log(`testbed storefront on http://localhost:${PORT}`);
  console.log(`  shopify login  http://localhost:${PORT}${shopify.loginPath}`);
  console.log(`  woo login      http://localhost:${PORT}${woo.loginPath}`);
  console.log(`  account        ${ACCOUNT.username} / ${ACCOUNT.password}`);
});
