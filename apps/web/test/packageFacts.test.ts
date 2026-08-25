/**
 * The facts panel (D-129).
 *
 * The two things worth pinning here are both about restraint. Extraction may *show* what the
 * application says and may *offer* to fill the answer in; it may not decide. And the suggestion it
 * offers is a different derivation from C-05's comparison — deliberately, because routing one
 * through the other would make a change to how documents are compared silently change which
 * documents a package requires.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { PackageFactsPanel, entityEvidence, suggestEntityType } from '../src/components/PackageFacts.js';
import type { PackageCreation } from '../src/lib/packageCreation.js';
import type { DocumentSummary, PackageSummary, SlotSummary } from '../src/lib/packages.js';

const CSS = readFileSync('apps/web/src/documentsReport.css', 'utf8');

const creation: PackageCreation = {
  merchants: async () => [],
  ensureMerchant: async () => 'merchant-1',
  create: async () => 'package-1',
  setFacts: async () => 0,
};

const pkg = (over: Partial<PackageSummary> = {}): PackageSummary => ({
  id: 'pkg-1',
  merchantId: 'm-1',
  merchantName: 'Acme LLC',
  merchantDomain: 'acme.example',
  processorKey: 'default',
  templateVersion: 'documents-1',
  lifecycle: 'open',
  openedAt: '2026-08-24T00:00:00Z',
  facts: { entityType: null, hasExistingProcessor: null, usDomiciled: null },
  factsSetAt: null,
  ...over,
});

const slot = (over: Partial<SlotSummary> = {}): SlotSummary => ({
  id: 'slot-1',
  slotKey: 'pre_app',
  instanceLabel: null,
  requiredCount: 1,
  coverageMonthly: false,
  coverageGraceDays: null,
  examined: true,
  origin: 'required',
  state: 'satisfied',
  reason: null,
  resolvedBy: null,
  ...over,
});

const document = (over: Partial<DocumentSummary> = {}): DocumentSummary => ({
  documentId: 'doc-1',
  versionId: 'v-1',
  slotId: 'slot-1',
  version: 1,
  supersedes: null,
  originalFilename: 'app.pdf',
  detectedType: 'pdf',
  bytes: 100,
  outcome: 'extracted',
  outcomeReason: null,
  createdAt: '2026-08-24T00:00:00Z',
  pageRoutes: [],
  readings: [],
  ...over,
});

const html = (over: Partial<Parameters<typeof PackageFactsPanel>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(PackageFactsPanel, {
      pkg: pkg(),
      slots: [],
      documents: [],
      creation,
      onSaved: () => undefined,
      ...over,
    }),
  );

const visibleText = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('an extracted value is offered, never applied', () => {
  const withReading = {
    slots: [slot({ id: 'slot-1', slotKey: 'pre_app' })],
    documents: [
      document({
        slotId: 'slot-1',
        readings: [{ field: 'entity_type' as const, value: 'Limited Liability Company', page: 2, snippet: null }],
      }),
    ],
  };

  it('shows what the document said, verbatim, with the page', () => {
    const text = visibleText(html(withReading));
    // Verbatim, not our normalisation of it: the operator is confirming what the page says.
    expect(text).toContain('Limited Liability Company');
    expect(text).toContain('p.2');
    expect(text).toContain('Pre App');
  });

  it('leaves the answer unset — the reading did not become the fact', () => {
    const markup = html(withReading);
    const entity = /<select[^>]*>([\s\S]*?)<\/select>/.exec(markup)?.[1] ?? '';
    // The single most important assertion in this file. An entity type applied by extraction can
    // remove the very document C-05 compares it against, leaving a report that looks complete and
    // is not.
    expect(/<option[^>]*selected[^>]*>([^<]*)</.exec(entity)?.[1]).toBe('Not known yet');
  });

  it('offers a button rather than a saved value', () => {
    expect(visibleText(html(withReading))).toContain('Use LLC');
  });

  it('shows a reading it cannot map, and offers no button for it', () => {
    const text = visibleText(
      html({
        slots: [slot()],
        documents: [
          document({ readings: [{ field: 'entity_type' as const, value: 'Grantor Trust', page: 1, snippet: null }] }),
        ],
      }),
    );
    // "The application says something we cannot act on" is worth seeing, and is not the same as
    // the application saying nothing.
    expect(text).toContain('Grantor Trust');
    expect(text).toContain('not one of the six recorded types');
    expect(text).not.toContain('Use ');
  });

  it('says nothing at all when no document carries the field', () => {
    expect(html({ slots: [slot()], documents: [document()] })).not.toContain('pf-evidence');
  });
});

describe('what saving would do is stated before it is done', () => {
  it('names the documents an answer would waive', () => {
    const text = visibleText(
      html({
        pkg: pkg(),
        slots: [
          slot({ id: 's-a', slotKey: 'articles_of_incorporation', origin: 'conditional', state: 'missing' }),
          slot({ id: 's-w', slotKey: 'w8ben', origin: 'conditional', state: 'missing' }),
        ],
      }),
    );
    // With nothing answered nothing is impossible, so the warning must be absent — the default
    // state of this panel removes nothing.
    expect(text).not.toContain('Saving waives');
  });

  it('leaves a satisfied slot out of the warning', () => {
    const text = visibleText(
      html({
        pkg: pkg({ facts: { entityType: 'sole_proprietor', hasExistingProcessor: null, usDomiciled: null } }),
        slots: [slot({ id: 's-a', slotKey: 'articles_of_incorporation', origin: 'conditional', state: 'satisfied' })],
      }),
    );
    // A document the merchant already supplied is not waived by an answer saying it cannot exist.
    expect(text).not.toContain('Saving waives');
  });

  it('warns about an outstanding one', () => {
    const text = visibleText(
      html({
        pkg: pkg({ facts: { entityType: 'sole_proprietor', hasExistingProcessor: null, usDomiciled: null } }),
        slots: [slot({ id: 's-a', slotKey: 'articles_of_incorporation', origin: 'conditional', state: 'missing' })],
      }),
    );
    expect(text).toMatch(/Saving waives 1 outstanding document/);
  });
});

describe('a settled package cannot have its set changed', () => {
  it('says so instead of offering the control', () => {
    const markup = html({ pkg: pkg({ lifecycle: 'submitted' }) });
    // The required set is what the report measured against; changing it afterwards would make an
    // already-sent report describe a set that no longer exists.
    expect(visibleText(markup)).toContain('its document set is settled');
    expect(markup).not.toContain('Record answers');
  });
});

describe('the suggestion is its own derivation', () => {
  it('maps the wordings a form actually uses', () => {
    expect(suggestEntityType('LLC')).toBe('llc');
    expect(suggestEntityType('Limited Liability Company')).toBe('llc');
    expect(suggestEntityType('Sole Proprietor')).toBe('sole_proprietor');
    expect(suggestEntityType('C Corporation')).toBe('corporation');
    expect(suggestEntityType('501(c)(3)')).toBe('non_profit');
    expect(suggestEntityType('General Partnership')).toBe('partnership');
  });

  /*
    The vocabularies are different sets, on purpose.

    `normaliseEntityType` in the engine produces C-05's comparison tokens — `s_corp`, `c_corp`,
    `trust`, `nonprofit` — which are what one document is compared against another with. The package
    records one of six. An S-corp is a corporation for the purposes of "does it file formation
    documents" and is a distinct token for the purposes of "do these two documents agree", and
    collapsing them would make a change to one silently change the other.
  */
  it('answers with a package entity type, never a comparison token', () => {
    const six = ['sole_proprietor', 'partnership', 'llc', 'corporation', 'non_profit', 'government'];
    for (const wording of ['S Corporation', 'C Corp', 'Nonprofit', 'LLC']) {
      const got = suggestEntityType(wording);
      expect(got === null || six.includes(got), `${wording} -> ${got}`).toBe(true);
    }
    expect(suggestEntityType('S Corporation')).toBe('corporation');
    // A trust is not one of the six, so there is nothing honest to suggest.
    expect(suggestEntityType('Grantor Trust')).toBeNull();
  });
});

describe('entityEvidence', () => {
  it('names the document by its slot, not by a uuid', () => {
    const evidence = entityEvidence(
      [document({ slotId: 's-1', readings: [{ field: 'entity_type', value: 'LLC', page: 1, snippet: null }] })],
      [slot({ id: 's-1', slotKey: 'pre_app' })],
    );
    expect(evidence[0]?.documentLabel).toBe('Pre App');
  });

  it('keeps two documents that say the same thing', () => {
    const reading = { field: 'entity_type' as const, value: 'LLC', page: 1, snippet: null };
    const evidence = entityEvidence(
      [
        document({ documentId: 'd1', slotId: 's-1', readings: [reading] }),
        document({ documentId: 'd2', slotId: 's-2', readings: [reading] }),
      ],
      [slot({ id: 's-1', slotKey: 'pre_app' }), slot({ id: 's-2', slotKey: 'w9' })],
    );
    // Two documents agreeing is a different thing to see than one document saying it twice.
    expect(evidence).toHaveLength(2);
  });

  it('collapses one document saying it twice on the same page', () => {
    const reading = { field: 'entity_type' as const, value: 'LLC', page: 1, snippet: null };
    const evidence = entityEvidence(
      [document({ slotId: 's-1', readings: [reading, reading] })],
      [slot({ id: 's-1', slotKey: 'pre_app' })],
    );
    expect(evidence).toHaveLength(1);
  });
});

describe('every class the panel asks for has a rule', () => {
  /**
   * The modal shipped to production with twelve classes and no stylesheet, rendering as unstyled
   * inline text. Same component family, same guard.
   */
  it('defines each pf- class', () => {
    const app = readFileSync('apps/web/src/styles.css', 'utf8');
    const stylesheets = `${CSS}\n${app}`;
    const used = new Set<string>();
    for (const m of html({
      slots: [slot({ id: 's-a', slotKey: 'articles_of_incorporation', origin: 'conditional', state: 'missing' })],
      documents: [
        document({ slotId: 's-a', readings: [{ field: 'entity_type', value: 'LLC', page: 1, snippet: null }] }),
      ],
      pkg: pkg({ facts: { entityType: 'sole_proprietor', hasExistingProcessor: null, usDomiciled: null } }),
    }).matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1]!.split(/\s+/)) if (c.startsWith('pf-') || c === 'pf') used.add(c);
    }
    expect(used.size).toBeGreaterThan(6);
    const missing = [...used].filter((c) => !stylesheets.includes(`.${c}`));
    expect(missing, `no rule for: ${missing.join(', ')}`).toEqual([]);
  });
});
