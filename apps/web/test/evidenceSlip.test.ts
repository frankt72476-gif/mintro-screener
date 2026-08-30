/**
 * What the evidence slip prints, and what it must not print twice (D-215).
 *
 * Both surfaces render this component: the app shows it in the report, and the PDF is a
 * print-to-PDF of the same route. There is one slip, so there is one test.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceSlip, unlistedUrls } from '../src/components/EvidenceSlip.js';

const ACCESS = { description: 'test', urlFor: async () => null };

const NAME_002 = {
  ruleId: 'NAME-002',
  state: 'fail',
  title: 'No marketing terms in product names',
  clause: 'Names such as "Lean Stack" are not permitted.',
  severity: 'critical',
  tier: 'auto_fail',
  checkType: 'url_pattern',
  layer: 0,
  evidenceKind: 'document',
  note:
    "2 of 37 URLs in scope 'products' matched a prohibited pattern: " +
    'https://www.comopeptides.com/shop/bpc-157-tb500-blend/ (matched \'blend\'); ' +
    "https://www.comopeptides.com/shop/cjc-1295-no-dac-ipamorelin-blend/ (matched 'blend').",
  evidence: [
    {
      kind: 'document',
      sourceUrl: 'https://www.comopeptides.com/sitemap_index.xml',
      sourceSha256: 'a'.repeat(64),
      evidenceKey: 'run/layer0/aaa',
      capturedAt: '2026-08-30T22:21:56.180Z',
      matchedValue: 'blend',
      matchedUrls: [
        'https://www.comopeptides.com/shop/bpc-157-tb500-blend/',
        'https://www.comopeptides.com/shop/cjc-1295-no-dac-ipamorelin-blend/',
      ],
    },
  ],
};

const render = (finding: unknown): string =>
  renderToStaticMarkup(createElement(EvidenceSlip, { finding, access: ACCESS } as never));

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('the matched payload', () => {
  it('says which field it is', () => {
    // It rendered as a bare `blend` in a box, alongside four labelled rows.
    expect(text(render(NAME_002))).toContain('Matched: blend');
  });

  it('does not reprint URLs the observation has already named', () => {
    const body = text(render(NAME_002));
    const occurrences = body.split('/shop/bpc-157-tb500-blend/').length - 1;

    expect(occurrences).toBe(0);
  });

  it('prints URLs the observation did not name', () => {
    const finding = {
      ...NAME_002,
      note: "37 URLs in scope 'products' were examined; 2 matched.",
    };

    expect(text(render(finding))).toContain('/shop/bpc-157-tb500-blend/');
  });
});

describe('unlistedUrls', () => {
  const evidence = { matchedUrls: ['https://a.example/x', 'https://a.example/y'] };

  it('keeps only what the note omits', () => {
    expect(unlistedUrls(evidence as never, 'we saw https://a.example/x today')).toEqual([
      'https://a.example/y',
    ]);
  });

  it('is empty where the note named them all', () => {
    expect(unlistedUrls(evidence as never, 'https://a.example/x https://a.example/y')).toEqual([]);
  });

  it('is empty where there were none', () => {
    expect(unlistedUrls({} as never, 'anything')).toEqual([]);
  });
});

describe('a document that was not retained', () => {
  /*
    `probePaths` hashes what it reads and stores nothing, so GATE-002's slip printed a SHA-256 row
    and a capture pane reading "not retained" — a digest of a document no reader can open. The
    handler now emits `''` for both, and the slip already suppresses an empty digest, so the two
    halves agree.
  */
  const GATE_002 = {
    ...NAME_002,
    ruleId: 'GATE-002',
    note: '1 of 3 path(s) served content directly: https://shop.example/shop returned 200.',
    evidence: [
      {
        kind: 'document',
        sourceUrl: 'https://shop.example/shop',
        sourceSha256: '',
        evidenceKey: '',
        capturedAt: '2026-08-30T22:22:55.385Z',
        matchedValue: '200 https://shop.example/shop',
        matchedUrls: ['https://shop.example/shop'],
        attempts: [
          { url: 'https://shop.example/collections/all', status: 404 },
          { url: 'https://shop.example/shop', status: 200 },
        ],
      },
    ],
  };

  it('shows no digest beside it', () => {
    const body = text(render(GATE_002));

    expect(body).toContain('not retained');
    expect(body).not.toContain('SHA-256');
  });

  it('still shows the requests attempted', () => {
    expect(text(render(GATE_002))).toContain('https://shop.example/collections/all → 404');
  });
});
