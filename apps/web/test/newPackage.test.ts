/**
 * The New Package modal.
 *
 * The defect these were written for: the modal referenced `.np-*` classes and `.modal-wide`, none
 * of which existed in any stylesheet. Every row rendered as unstyled inline spans and the name ran
 * straight into its metadata — `Pre App / Existing Apprequired×1` — which shipped to production
 * because **no test looked at what a row renders as, and none looked at whether a class had a
 * rule.** Both gaps are closed here.
 *
 * A static render cannot lay out a page, so "is it visually separated" is checked in two halves
 * that together mean it: the name and its metadata are separate elements, and the row that holds
 * them is a grid. Neither half alone is enough — separate elements still concatenate when they are
 * inline, which is exactly what happened.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { NewPackage } from '../src/components/NewPackage.js';
import type { PackageCreation } from '../src/lib/packageCreation.js';

const creation: PackageCreation = {
  merchants: async () => [],
  ensureMerchant: async () => 'merchant-1',
  create: async () => 'package-1',
  setFacts: async () => 0,
};

const html = (): string =>
  renderToStaticMarkup(
    createElement(NewPackage, { creation, onCreated: () => undefined, onCancel: () => undefined }),
  );

const CSS = readFileSync('apps/web/src/documentsReport.css', 'utf8');

/** Text as a browser concatenates it: tags removed, nothing inserted. */
const visibleText = (markup: string): string =>
  markup.replace(/<[^>]+>/g, '').replace(/&times;/g, '×').replace(/&#x27;/g, "'");

/** Every rule the markup asks for must exist, or it renders unstyled. */
function classesIn(markup: string): string[] {
  const found = new Set<string>();
  for (const m of markup.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1]!.split(/\s+/)) if (c.startsWith('np-') || c === 'modal-wide') found.add(c);
  }
  return [...found].sort();
}

describe('a document name never runs into its metadata', () => {
  /**
   * The exact strings from the production screenshot. If the row concatenates again, these appear
   * again — this asserts against the symptom as reported, not against a proxy for it.
   */
  it('does not render the reported concatenations', () => {
    const text = visibleText(html());
    for (const bad of [
      'Pre App / Existing Apprequired',
      'Voided Checkrequired',
      'W-9conditional',
      'DBA / fictitious name filingadded',
    ]) {
      expect(text, `rendered "${bad}"`).not.toContain(bad);
    }
  });

  /** The general form, so a slot added later is covered without anyone editing the list above. */
  it('no row puts an origin word immediately after a letter', () => {
    const text = visibleText(html());
    const runOns = ['required', 'conditional', 'added']
      .flatMap((origin) => [...text.matchAll(new RegExp(`[A-Za-z0-9)](${origin})\\b`, 'g'))].map((m) => m[0]));
    expect(runOns, `concatenated: ${runOns.join(', ')}`).toEqual([]);
  });

  it('puts the name and the metadata in separate elements', () => {
    const markup = html();
    const rows = [...markup.matchAll(/<label class="np-row">([\s\S]*?)<\/label>/g)];
    expect(rows.length).toBeGreaterThan(10);
    for (const [, body] of rows) {
      expect(body).toContain('class="np-name"');
      expect(body).toContain('class="np-meta"');
    }
  });

  /**
   * The half a static render cannot see. Separate elements still concatenate when they are inline;
   * the grid on `.np-row` is what actually separates them, so the rule has to exist.
   */
  it('lays the row out as a grid, so the separation is real and not assumed', () => {
    const rule = /\.np-row\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(rule, '.np-row has no rule at all').not.toBe('');
    expect(rule).toMatch(/display:\s*(grid|flex)/);
    expect(rule).toMatch(/gap:/);
  });
});

describe('every class the modal asks for has a rule', () => {
  /**
   * The root cause, generalised. The component named twelve classes and the stylesheets defined
   * none of them; nothing failed, it simply rendered as unstyled text.
   */
  it('defines each np- class and modal-wide', () => {
    const app = readFileSync('apps/web/src/styles.css', 'utf8');
    const stylesheets = `${CSS}\n${app}`;
    const missing = classesIn(html()).filter((c) => !stylesheets.includes(`.${c}`));
    expect(missing, `no rule for: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the modal fits the viewport', () => {
  it('scrolls its body instead of overflowing', () => {
    const wide = /\.modal\.modal-wide\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '';
    // The reported symptom was the top cropped: a veil centring an over-tall box clips both edges.
    expect(wide).toMatch(/max-height:/);
    expect(wide).toMatch(/flex-direction:\s*column/);
    expect(CSS).toMatch(/\.modal\.modal-wide \.modal-body\s*\{[^}]*overflow-y:\s*auto/);
  });
});

describe('the conditional explanation belongs to its row', () => {
  it('sits inside the list item it explains, after the row', () => {
    const markup = html();
    const items = [...markup.matchAll(/<li data-origin="conditional"[\s\S]*?<\/li>/g)];
    expect(items.length).toBeGreaterThan(0);
    for (const [item] of items) {
      expect(item).toContain('class="np-because"');
      expect(item.indexOf('np-because')).toBeGreaterThan(item.indexOf('np-row'));
    }
  });

  it('is indented under the name rather than floating at the margin', () => {
    const rule = /\.np-because\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(rule).not.toBe('');
    expect(rule).toMatch(/padding-left:/);
  });
});

describe('it reads as the same product as the report', () => {
  it('uses the report type pairing, not the app default', () => {
    expect(/\.new-package\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '').toMatch(/IBM Plex Sans/);
    expect(/\.np-origin\s*\{[^}]*\}/.exec(CSS)?.[0] ?? '').toMatch(/IBM Plex Mono/);
  });

  /** Dashed for conditional, as page-tier evidence is dashed in the report. One convention. */
  it('marks a conditional origin the way the report marks a weaker claim', () => {
    expect(CSS).toMatch(/\.np-origin\[data-origin="conditional"\]\s*\{[^}]*border-style:\s*dashed/);
  });
});

/*
  D-129 — the three answers accept "not known yet", and that is where the modal opens.

  These are about the *default* state, which is the whole ruling: a required dropdown with a
  plausible value does not obtain an answer, it manufactures one, and a wrong entity type silently
  removes a slot that should be present.
*/
describe('nothing is answered until somebody answers it', () => {
  it('opens with entity type not known and domicile not sure', () => {
    const markup = html();
    // The selected option is the one React marks; a default of LLC would mark that instead.
    const selects = [...markup.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/g)].map((m) => m[1]!);
    expect(selects.length, 'expected exactly the two questions D-129 leaves').toBe(2);
    for (const options of selects) {
      const selected = /<option[^>]*selected[^>]*>([^<]*)</.exec(options)?.[1] ?? '';
      expect(['Not known yet', 'Not sure']).toContain(selected);
    }
  });

  it('does not ask about an existing processor at all', () => {
    // Removed entirely, not hidden: no slot predicates on it, and a question that changes nothing
    // trains an operator to answer without reading.
    expect(visibleText(html())).not.toMatch(/existing processor/i);
  });

  /*
    In the *offered* list, not merely somewhere in the markup.

    The first version of this asserted the two names appeared in the rendered text, and it passed
    with the domicile answered — because a ruled-out slot is still *listed* under "Not applicable",
    by name. A test that a document is offered has to look at where documents are offered.
  */
  it('offers both tax forms while the domicile is unknown', () => {
    const offered = /<ul class="np-slots">([\s\S]*?)<\/ul>/.exec(html())?.[1] ?? '';
    expect(offered, 'no slot list rendered').not.toBe('');
    for (const form of ['W-9', 'W-8BEN']) {
      expect(visibleText(offered), `${form} is not offered`).toContain(form);
    }
  });

  it('rules nothing out, because nothing has been established', () => {
    // The "Not applicable to this business" block is the removal path. With no answers on record
    // there is nothing to remove, and a slot listed there is a slot the operator cannot supply.
    expect(html()).not.toContain('np-impossible');
  });

  it('marks an unresolved conditional as an open question rather than a settled reason', () => {
    const markup = html();
    expect(markup).toContain('data-unresolved="true"');
    expect(visibleText(markup)).toContain('is not recorded, so');
    // And the marking has to be visible, not merely present in the DOM.
    expect(CSS).toMatch(/\.np-origin\[data-unresolved="true"\]\s*\{[^}]*color:/);
  });
});

describe('the merchant is typed, not picked', () => {
  it('has no merchant dropdown', () => {
    const markup = html();
    expect(markup).not.toContain('— create a new merchant —');
    expect(markup).not.toContain('Existing merchant');
  });

  it('asks for legal name, DBA and domain', () => {
    const markup = html();
    for (const field of ['Legal name', 'DBA', 'Domain']) {
      expect(markup, `no ${field} field`).toContain(`aria-label="${field}"`);
    }
  });

  /*
    D-126 as amended. The operator's DBA is a label for finding a package; the report's DBA is what
    the documents say, derived once in C-02. This asserts the modal does not promise otherwise —
    copy that called it "trading name as it appears on the documents" would be a promise the field
    cannot keep.
  */
  it('does not present the DBA as something the report will print', () => {
    const text = visibleText(html());
    expect(text).toMatch(/what the report\s+prints is what the documents say/);
  });
});
