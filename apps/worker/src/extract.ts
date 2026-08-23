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
  gate: RawGateContext;
  selectorMatches: Record<string, number>;
  productTitle: string;
}

/**
 * Evidence that an age gate exists as an *interstitial*, not merely that a string appears.
 *
 * D-016: a `pass` on GATE-001 must mean "an age gate exists", not "the characters 21+ occur
 * somewhere on the page". The distinction is structural — a gate blocks entry — so what is
 * captured here is the structure, and the signal words are matched within it.
 */
export interface RawGateContext {
  /** A modal, dialog, or full-viewport overlay was present. */
  found: boolean;
  /** How it was identified, for the report. */
  locatedBy: string;
  /** Text inside that container. */
  text: string;
  /** True when the container covers most of the viewport or blocks scrolling. */
  blocksEntry: boolean;
}

/**
 * Extracts everything the Layer 1 handlers need, in one pass.
 *
 * One `evaluate` rather than several: each round trip is a chance for the page to mutate under
 * us, and a footer read in a different state from the screenshot would put text in the report
 * that the capture does not show.
 */
/**
 * Arguments arrive as one object because Playwright serialises this function and passes exactly
 * one argument to it. A wrapper arrow function would close over `extractPage` from module scope,
 * which does not exist inside the page.
 */
export interface ExtractArgs {
  paymentTerms: string[];
  selectors: string[];
}

export function extractPage(args: ExtractArgs): RawExtraction {
  const { paymentTerms, selectors } = args;
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
  //
  // `text` is built from this same filtered walk rather than from `body.textContent`, and the
  // difference matters: `textContent` includes `<script>`, `<noscript>` and `<template>`
  // content. PROD-006 and PROD-007 are `expect: absent` and `auto_fail`, so a brand name sitting
  // in inline JSON or a noscript fallback would auto-fail a merchant on text no visitor ever
  // sees. Only rendered, visible text counts as observed.
  const styledText: RawStyledText[] = [];
  const footerStyled: RawStyledText[] = [];
  const visibleChunks: string[] = [];

  const NON_RENDERED = /^(script|style|noscript|template|title|meta|link)$/i;

  // Visibility is walked per element and memoised: a long page has many text nodes sharing a
  // parent, and re-walking ancestors for each was the slowest part of extraction.
  const visibilityCache = new Map<Element, { visible: boolean; reason?: string }>();
  const cachedVisibility = (element: Element): { visible: boolean; reason?: string } => {
    const hit = visibilityCache.get(element);
    if (hit !== undefined) return hit;
    const computed = visibility(element);
    visibilityCache.set(element, computed);
    return computed;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  let count = 0;

  while (node !== null && count < MAX_TEXT_NODES) {
    const raw = node.textContent ?? '';
    const text = raw.replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;

    if (text !== '' && parent !== null && !NON_RENDERED.test(parent.nodeName)) {
      const seen = cachedVisibility(parent);

      // Hidden text is excluded from `text` deliberately. DISC-002 exists because present-but-
      // invisible is not the same as displayed; the same reasoning applies to every text rule.
      if (seen.visible) visibleChunks.push(text);

      if (text.length >= 3) {
        const described = describe(parent, text);
        styledText.push(described);
        if (footerElement !== null && footerElement.contains(node)) footerStyled.push(described);
        count += 1;
      }
    }
    node = walker.nextNode();
  }

  const renderedText = visibleChunks.join(' ').replace(/\s+/g, ' ').trim();

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

  // ---- age-gate interstitial ----------------------------------------------------------
  //
  // Located structurally first (hard constraint 9): a dialog, a modal, or an overlay that
  // covers the viewport. The signal words are then matched *within* it. Finding the words
  // anywhere on the page is not evidence of a gate.
  const gateCandidates: { element: Element; how: string }[] = [];

  for (const el of Array.from(document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]'))) {
    gateCandidates.push({ element: el, how: 'dialog or role=dialog' });
  }
  for (const el of Array.from(
    document.querySelectorAll('[class*=age-gate], [class*=age_gate], [class*=agegate], [id*=age-gate], [id*=agegate], [class*=age-verif], [id*=age-verif]'),
  )) {
    gateCandidates.push({ element: el, how: 'age-gate class or id' });
  }
  for (const el of Array.from(document.querySelectorAll('[class*=modal], [class*=overlay], [class*=popup]'))) {
    gateCandidates.push({ element: el, how: 'modal or overlay container' });
  }

  const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
  let gate: RawGateContext = { found: false, locatedBy: '', text: '', blocksEntry: false };

  for (const { element, how } of gateCandidates) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const covers = (rect.width * rect.height) / viewportArea >= 0.25;
    const overlaid = style.position === 'fixed' || style.position === 'absolute';
    const bodyLocked = /hidden|clip/.test(getComputedStyle(document.body).overflow);

    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text === '') continue;

    const blocksEntry = (covers && overlaid) || bodyLocked;

    // Prefer a candidate that actually blocks entry over one that merely exists.
    if (!gate.found || (blocksEntry && !gate.blocksEntry)) {
      gate = { found: true, locatedBy: how, text: text.slice(0, 2000), blocksEntry };
    }
  }

  // ---- selectors the rule set asked about ----------------------------------------------
  //
  // Evaluated here because the handlers have no DOM. A selector that matches nothing is
  // recorded as 0 rather than omitted: "looked and found none" and "never looked" are
  // different claims and the report must be able to tell them apart.
  const selectorMatches: Record<string, number> = {};
  for (const selector of selectors) {
    try {
      selectorMatches[selector] = document.querySelectorAll(selector).length;
    } catch {
      // An invalid selector is a rule-set defect, not a page property. Leaving it out of the
      // map means the handler reports "not examined" rather than "none found".
    }
  }

  const productTitle = (
    document.querySelector('h1')?.textContent ??
    document.querySelector('[class*=product-title], [class*=product_title]')?.textContent ??
    document.title
  )
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: document.title,
    text: renderedText,
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
    gate,
    selectorMatches,
    productTitle,
  };
}

/**
 * A sign-up form read out of a rendered page (D-048).
 *
 * Mirrors `SignupForm` in `@mintro/engine`, minus anything that cannot cross the `evaluate`
 * boundary. Like `extractPage`, this is serialised into the browser and may close over nothing.
 */
export interface RawFormField {
  name: string;
  type: string;
  required: boolean;
  label: string;
  autocomplete: string;
  options: string[];
  selector: string;
}

export interface RawSignupForm {
  found: boolean;
  locatedBy: string;
  fields: RawFormField[];
  candidateForms: number;
}

/**
 * Finds the sign-up form and reads every field in it.
 *
 * **The form is located by its password field.** You cannot create an account without one, and
 * every other candidate locator — a heading, a URL, a class name, a submit button's text — is
 * prose the merchant chose. Hard constraint 9 applies to the form as much as to the fields
 * inside it: a form found by matching "Create account" would be missed on a site that says
 * "Join the lab", and that merchant's checkbox and research field would be reported as absent.
 *
 * Where more than one form on the page carries a password field, the one with the most fields is
 * taken — a registration form asks for more than a login form does — and `candidateForms` records
 * that there was a choice, so the inference is visible rather than silent.
 *
 * Every field is returned, including ones this code cannot classify. Deciding which fields matter
 * is the checks' job, and a filter here would hide the merchant's own wording from the report.
 */
export function extractSignupForm(): RawSignupForm {
  const cssPath = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node !== null && node !== document.body && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      const id = node.id === '' ? '' : `#${node.id}`;
      const cls = typeof node.className === 'string' && node.className.trim() !== ''
        ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      parts.unshift(`${tag}${id}${cls}`);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

  /**
   * The visible text that labels a control.
   *
   * Tried in the order a person reads: an explicit `<label for>`, a wrapping `<label>`, then the
   * accessible-name attributes, then — for a checkbox, whose text usually sits beside it rather
   * than in a label — the text of the nearest containing block. Whatever comes back is reported
   * verbatim; nothing here matches it against anything.
   */
  const labelFor = (element: Element): string => {
    const id = element.getAttribute('id');
    if (id !== null && id !== '') {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit !== null) return clean(explicit.textContent ?? '');
    }

    const wrapping = element.closest('label');
    if (wrapping !== null) return clean(wrapping.textContent ?? '');

    const aria = element.getAttribute('aria-label');
    if (aria !== null && aria.trim() !== '') return clean(aria);

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy !== null && labelledBy.trim() !== '') {
      const target = document.getElementById(labelledBy.trim().split(/\s+/)[0] ?? '');
      if (target !== null) return clean(target.textContent ?? '');
    }

    const placeholder = element.getAttribute('placeholder');
    if (placeholder !== null && placeholder.trim() !== '') return clean(placeholder);

    // A checkbox's wording is usually its sibling text, not a label element.
    const block = element.closest('div, p, li, fieldset');
    if (block !== null) {
      const text = clean(block.textContent ?? '');
      if (text !== '' && text.length < 400) return text;
    }

    return '';
  };

  const isRequired = (element: Element): boolean =>
    element.hasAttribute('required') || element.getAttribute('aria-required') === 'true';

  const forms = Array.from(document.querySelectorAll('form'));
  const withPassword = forms.filter((f) => f.querySelector('input[type=password]') !== null);

  if (withPassword.length === 0) {
    return {
      found: false,
      locatedBy: 'no form on the page carried a password field',
      fields: [],
      candidateForms: 0,
    };
  }

  /**
   * Is this form for *creating* an account, or for signing in to one?
   *
   * Both carry a password field, so "has a password field" does not distinguish them — and the
   * first draft of this code took the largest such form, which on a WooCommerce `/my-account/`
   * page is the sign-in form, because "Remember me" makes it three controls to the register
   * form's two. It then reported a sign-in form's fields as the sign-up form's, which is an
   * observation about a page nobody looked at.
   *
   * **Established by positive evidence** (D-026), never by the absence of a sign-in marker:
   *
   *   - `autocomplete="new-password"` is the standard token for a password being created. A
   *     sign-in field is `current-password`.
   *   - Two or more password fields is a password-and-confirm pair, which only account creation
   *     asks for.
   *
   * Neither is merchant prose. A form matching neither is *not* assumed to be a registration
   * form — the caller reports that it could not tell, which is the honest answer.
   */
  const createsAccount = (f: Element): boolean => {
    const passwords = Array.from(f.querySelectorAll('input[type=password]'));
    if (passwords.length > 1) return true;
    return passwords.some(
      (input) => (input.getAttribute('autocomplete') ?? '').toLowerCase() === 'new-password',
    );
  };

  const registration = withPassword.filter(createsAccount);

  if (registration.length === 0) {
    return {
      found: false,
      locatedBy:
        `${withPassword.length} form(s) on the page carried a password field, and none could be ` +
        `established as an account-creation form: no field declared autocomplete="new-password" ` +
        `and none carried a second password field to confirm one`,
      fields: [],
      candidateForms: withPassword.length,
    };
  }

  const controls = (f: Element): Element[] =>
    Array.from(f.querySelectorAll('input, select, textarea')).filter((element) => {
      const type = (element.getAttribute('type') ?? '').toLowerCase();
      return type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'image';
    });

  // Among forms that positively create an account, the largest is the registration form.
  // `candidateForms` records how many carried a password field at all, so a reader can see that
  // a choice was made and on what basis.
  const chosen = registration.reduce((best, candidate) =>
    controls(candidate).length > controls(best).length ? candidate : best,
  );

  const seenRadioGroups = new Set<string>();
  const fields: RawFormField[] = [];

  for (const element of controls(chosen)) {
    const tag = element.tagName.toLowerCase();
    const type = tag === 'input' ? (element.getAttribute('type') ?? 'text').toLowerCase() : tag;
    const name = element.getAttribute('name') ?? element.getAttribute('id') ?? '';

    // A radio group is one question, not one field per option. Collapsed so the report says
    // "one required choice with four options" rather than listing four fields.
    if (type === 'radio' && name !== '') {
      if (seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);

      const group = Array.from(chosen.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`));
      fields.push({
        name,
        type: 'radio',
        required: group.some(isRequired),
        label: labelFor(element),
        autocomplete: element.getAttribute('autocomplete') ?? '',
        options: group.map((option) => labelFor(option) || option.getAttribute('value') || ''),
        selector: cssPath(element),
      });
      continue;
    }

    const options =
      tag === 'select'
        ? Array.from(element.querySelectorAll('option'))
            .map((option) => clean(option.textContent ?? ''))
            .filter((text) => text !== '')
        : [];

    fields.push({
      name,
      type,
      required: isRequired(element),
      label: labelFor(element),
      autocomplete: element.getAttribute('autocomplete') ?? '',
      options,
      selector: cssPath(element),
    });
  }

  return {
    found: true,
    locatedBy:
      registration.length > 1
        ? `the largest of ${registration.length} forms that create an account, of ` +
          `${withPassword.length} carrying a password field`
        : `the one form on the page that creates an account, of ${withPassword.length} carrying a ` +
          `password field`,
    fields,
    candidateForms: withPassword.length,
  };
}
