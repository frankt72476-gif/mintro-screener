/**
 * The page-extraction script, run inside the browser.
 *
 * This function is serialised and evaluated in the page, so it may not close over anything from
 * the worker — everything it needs arrives as an argument, and everything it returns must be
 * structured-cloneable. Keep it self-contained.
 *
 * It reads the *rendered* layout rather than the source: a declared `font-size` in a stylesheet
 * is not what a visitor sees, and DISC-002 exists to catch a disclaimer that is present in the
 * markup but not legible on the screen.
 */

/** Mirrors `StyledText` in `@mintro/engine`, minus types that cannot cross the boundary. */
export interface RawStyledText {
  text: string;
  selector: string;
  fontSizePx: number;
  color: string;
  backgroundColor: string;
  visible: boolean;
  collapsedAncestor: boolean;
  hiddenReason?: string;
}

export interface RawLink {
  href: string;
  text: string;
  rel: string;
  inFooter: boolean;
  inNav: boolean;
}

export interface RawExtraction {
  title: string;
  text: string;
  links: RawLink[];
  styledText: RawStyledText[];
  footer: { found: boolean; text: string; locatedBy: string; styledText: RawStyledText[] };
  shop: {
    productUrls: string[];
    collectionUrls: string[];
    catalogueEntryUrls: string[];
    platform?: string;
    signals: string[];
  };
  footerPaymentTerms: string[];
}

/**
 * Extracts everything the Layer 1 handlers need, in one pass.
 *
 * One `evaluate` rather than several: each round trip is a chance for the page to mutate under
 * us, and a footer read in a different state from the screenshot would put text in the report
 * that the capture does not show.
 */
export function extractPage(paymentTerms: string[]): RawExtraction {
  const MAX_TEXT_NODES = 4000;

  // ---- helpers ------------------------------------------------------------------------
  const cssPath = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;

    while (current !== null && parts.length < 6 && current.nodeName !== 'HTML') {
      let part = current.nodeName.toLowerCase();
      if (current.id !== '') {
        parts.unshift(`${part}#${current.id}`);
        break;
      }
      const className =
        typeof current.className === 'string' ? current.className.trim().split(/\s+/)[0] : '';
      if (className !== undefined && className !== '') part += `.${className}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };

  const parseRgb = (value: string): { r: number; g: number; b: number; a: number } | null => {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(
      value.trim(),
    );
    if (m === null) return null;
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  };

  /**
   * Walks ancestors to find what actually sits behind an element.
   *
   * A disclaimer with a transparent background over a dark section is dark-on-dark; comparing
   * its text colour against an assumed white page would report a contrast ratio that does not
   * exist on the screen. Falls back to white only when the walk reaches the document root
   * without finding an opaque layer, which is what a browser paints.
   */
  const effectiveBackground = (element: Element): string => {
    let current: Element | null = element;
    let composite: { r: number; g: number; b: number } | null = null;

    while (current !== null) {
      const bg = parseRgb(getComputedStyle(current).backgroundColor);
      if (bg !== null && bg.a > 0) {
        if (composite === null) {
          composite = { r: bg.r, g: bg.g, b: bg.b };
        }
        if (bg.a >= 1) return `rgb(${composite.r}, ${composite.g}, ${composite.b})`;
      }
      current = current.parentElement;
    }

    return composite === null
      ? 'rgb(255, 255, 255)'
      : `rgb(${composite.r}, ${composite.g}, ${composite.b})`;
  };

  const visibility = (element: Element): { visible: boolean; reason?: string } => {
    let current: Element | null = element;
    while (current !== null) {
      const style = getComputedStyle(current);
      if (style.display === 'none') return { visible: false, reason: 'display:none' };
      if (style.visibility === 'hidden') return { visible: false, reason: 'visibility:hidden' };
      if (Number(style.opacity) === 0) return { visible: false, reason: 'opacity:0' };
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { visible: false, reason: 'element has zero rendered size' };
    }
    return { visible: true };
  };

  /** An ancestor collapsing the element to nothing while hiding the overflow. */
  const hasCollapsedAncestor = (element: Element): boolean => {
    let current: Element | null = element.parentElement;
    while (current !== null) {
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      const clipped = style.overflow === 'hidden' || style.overflowY === 'hidden';
      if (clipped && rect.height < 1) return true;
      if (style.maxHeight === '0px' && clipped) return true;
      current = current.parentElement;
    }
    return false;
  };

  const describe = (element: Element, text: string): RawStyledText => {
    const style = getComputedStyle(element);
    const seen = visibility(element);
    return {
      text,
      selector: cssPath(element),
      fontSizePx: parseFloat(style.fontSize) || 0,
      color: style.color,
      backgroundColor: effectiveBackground(element),
      visible: seen.visible,
      collapsedAncestor: hasCollapsedAncestor(element),
      ...(seen.reason === undefined ? {} : { hiddenReason: seen.reason }),
    };
  };

  // ---- regions ------------------------------------------------------------------------
  const footerElement =
    document.querySelector('footer') ??
    document.querySelector('[role=contentinfo]') ??
    document.querySelector('#footer, .footer, [class*=site-footer], [class*=Footer]');

  const footerLocatedBy =
    document.querySelector('footer') !== null
      ? '<footer> element'
      : document.querySelector('[role=contentinfo]') !== null
        ? 'role=contentinfo'
        : footerElement !== null
          ? 'footer class or id'
          : '';

  const navElements = Array.from(document.querySelectorAll('nav, [role=navigation], header'));

  // ---- text runs ----------------------------------------------------------------------
  const styledText: RawStyledText[] = [];
  const footerStyled: RawStyledText[] = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  let count = 0;

  while (node !== null && count < MAX_TEXT_NODES) {
    const raw = node.textContent ?? '';
    const text = raw.replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;

    if (text.length >= 3 && parent !== null && !/^(script|style|noscript)$/i.test(parent.nodeName)) {
      const described = describe(parent, text);
      styledText.push(described);
      if (footerElement !== null && footerElement.contains(node)) footerStyled.push(described);
      count += 1;
    }
    node = walker.nextNode();
  }

  // ---- links --------------------------------------------------------------------------
  const links: RawLink[] = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href]')).slice(0, 3000)) {
    const href = anchor.getAttribute('href') ?? '';
    if (href === '' || href.startsWith('#') || href.startsWith('javascript:')) continue;
    let absolute: string;
    try {
      absolute = new URL(href, document.baseURI).toString();
    } catch {
      continue;
    }
    links.push({
      href: absolute,
      text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      rel: anchor.getAttribute('rel') ?? '',
      inFooter: footerElement !== null && footerElement.contains(anchor),
      inNav: navElements.some((nav) => nav.contains(anchor)),
    });
  }

  // ---- shop structure -----------------------------------------------------------------
  const signals: string[] = [];
  const productUrls = new Set<string>();
  const collectionUrls = new Set<string>();
  const catalogueEntryUrls = new Set<string>();

  const absolutise = (href: string | null): string | null => {
    if (href === null || href === '') return null;
    try {
      return new URL(href, document.baseURI).toString();
    } catch {
      return null;
    }
  };

  // Platform detection, from markup the platform itself emits.
  let platform: string | undefined;
  const html = document.documentElement.outerHTML;
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) platform = 'shopify';
  else if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html)) platform = 'woocommerce';
  else if (/Magento|mage\/|static\/version/i.test(html)) platform = 'magento';
  else if (/bigcommerce/i.test(html)) platform = 'bigcommerce';
  if (platform !== undefined) signals.push(`platform markup indicates ${platform}`);

  // schema.org Product markup is the strongest signal available: the page is telling us.
  for (const el of Array.from(document.querySelectorAll('[itemtype*="schema.org/Product"]'))) {
    const link = el.querySelector('a[href]');
    const url = absolutise(link?.getAttribute('href') ?? null);
    if (url !== null) productUrls.add(url);
  }
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const nodes = Array.isArray(data) ? data : [data];
      for (const entry of nodes) {
        if (entry !== null && typeof entry === 'object' && entry['@type'] === 'Product') {
          const url = absolutise(typeof entry.url === 'string' ? entry.url : null);
          if (url !== null) productUrls.add(url);
        }
      }
    } catch {
      // Malformed JSON-LD is common and not our problem.
    }
  }
  if (productUrls.size > 0) signals.push(`${productUrls.size} product(s) declared in page markup`);

  // WooCommerce and Shopify product cards.
  const cardsBefore = productUrls.size;
  for (const card of Array.from(
    document.querySelectorAll('li.product, .product-card, [class*=product-item], [class*=ProductCard]'),
  )) {
    const url = absolutise(card.querySelector('a[href]')?.getAttribute('href') ?? null);
    if (url !== null) productUrls.add(url);
  }
  // A form posting to add-to-cart identifies the product it belongs to.
  for (const form of Array.from(document.querySelectorAll('form[action*="add-to-cart"], form[action*="/cart/add"]'))) {
    const url = absolutise(form.getAttribute('action'));
    if (url !== null) catalogueEntryUrls.add(url);
  }
  if (productUrls.size > cardsBefore) {
    signals.push(`${productUrls.size - cardsBefore} product card link(s) on the rendered page`);
  }

  // Catalogue entry points, from navigation text.
  const shopWords = ['shop', 'store', 'products', 'catalog', 'catalogue', 'all products'];
  for (const link of links) {
    if (!link.inNav) continue;
    const label = link.text.toLowerCase();
    if (shopWords.some((word) => label === word || label.startsWith(`${word} `))) {
      catalogueEntryUrls.add(link.href);
    }
  }
  if (catalogueEntryUrls.size > 0) {
    signals.push(`${catalogueEntryUrls.size} catalogue entry point(s) in navigation`);
  }

  // Category listings linked from the page.
  for (const el of Array.from(document.querySelectorAll('[class*=category] a[href], [class*=collection] a[href]'))) {
    const url = absolutise(el.getAttribute('href'));
    if (url !== null) collectionUrls.add(url);
  }

  // ---- payment terms in the footer (collected for Layer 3, not evaluated here) ---------
  const footerText = (footerElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const footerLower = footerText.toLowerCase();
  const footerPaymentTerms = paymentTerms.filter((term) => footerLower.includes(term.toLowerCase()));

  return {
    title: document.title,
    text: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim(),
    links,
    styledText,
    footer: {
      found: footerElement !== null,
      text: footerText,
      locatedBy: footerLocatedBy,
      styledText: footerStyled,
    },
    shop: {
      productUrls: Array.from(productUrls),
      collectionUrls: Array.from(collectionUrls),
      catalogueEntryUrls: Array.from(catalogueEntryUrls),
      ...(platform === undefined ? {} : { platform }),
      signals,
    },
    footerPaymentTerms,
  };
}
