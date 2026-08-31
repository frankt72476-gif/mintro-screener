/**
 * A fragment is not a path (D-219).
 *
 * FULF-001 on CoMo Peptides listed seven requests attempted, the first of them
 * `https://www.comopeptides.com/aboutcomopeptides/#how-quickly → 200` — a URL nothing ever asked
 * for. A fragment never leaves the browser: what went out was the same request without it. Where a
 * homepage carries both spellings the page is rendered twice, and the record of what was tried
 * shows two attempts where one was made.
 */

import { describe, expect, it } from 'vitest';
import { withoutFragment } from '@mintro/engine';
import { selectLinkedCandidates } from '../src/signup.js';
import { certificateLinks } from '../src/coa.js';
import type { PageContext } from '@mintro/engine';

const ORIGIN = 'https://www.comopeptides.com';

const link = (href: string, text: string) => ({ href, text });

describe('withoutFragment', () => {
  it('removes the fragment and nothing else', () => {
    expect(withoutFragment(`${ORIGIN}/aboutcomopeptides/#how-quickly`)).toBe(
      `${ORIGIN}/aboutcomopeptides/`,
    );
  });

  it('keeps the query, which does reach the server', () => {
    expect(withoutFragment(`${ORIGIN}/p?id=2#top`)).toBe(`${ORIGIN}/p?id=2`);
  });

  it('leaves a URL without one alone', () => {
    expect(withoutFragment(`${ORIGIN}/shipping`)).toBe(`${ORIGIN}/shipping`);
  });

  it('returns an unparseable href as written rather than dropping it', () => {
    // It still has to be recorded as an attempt; silently losing it would hide a request.
    expect(withoutFragment('not a url#x')).toBe('not a url');
  });
});

describe('homepage candidates', () => {
  it('treats a fragment variant as the page it is on', () => {
    const { followed, matched } = selectLinkedCandidates(
      [
        link(`${ORIGIN}/aboutcomopeptides/`, 'About'),
        link(`${ORIGIN}/aboutcomopeptides/#how-quickly`, 'How quickly do you ship?'),
      ],
      ['shipping', 'delivery', 'ship'],
      ORIGIN,
    );

    expect(followed).toEqual([`${ORIGIN}/aboutcomopeptides/`]);
    expect(matched).toBe(1);
  });

  it('still matches on the fragment, which is often where the link names itself', () => {
    /*
      `#shipping` under the text "Delivery" is exactly the signal these hints look for. What is
      stripped is what gets requested, not what gets matched.
    */
    const { followed } = selectLinkedCandidates(
      [link(`${ORIGIN}/about/#shipping`, 'Delivery')],
      ['shipping'],
      ORIGIN,
    );

    expect(followed).toEqual([`${ORIGIN}/about/`]);
  });

  it('keeps two genuinely different paths apart', () => {
    const { followed } = selectLinkedCandidates(
      [link(`${ORIGIN}/shipping`, 'Shipping'), link(`${ORIGIN}/shipping-returns`, 'Returns')],
      ['shipping'],
      ORIGIN,
    );

    expect(followed).toHaveLength(2);
  });
});

describe('certificate links', () => {
  const page = (hrefs: readonly string[]): PageContext =>
    ({ links: hrefs.map((href) => link(href, 'Certificate of Analysis')) }) as unknown as PageContext;

  it('requests one certificate once, however many anchors point into it', () => {
    const links = certificateLinks(
      [page([`${ORIGIN}/coa/bpc-157.pdf#page=1`, `${ORIGIN}/coa/bpc-157.pdf#page=2`])],
      ['coa', 'certificate'],
    );

    expect(links).toEqual([`${ORIGIN}/coa/bpc-157.pdf`]);
  });

  it('keeps two certificates apart', () => {
    const links = certificateLinks(
      [page([`${ORIGIN}/coa/a.pdf`, `${ORIGIN}/coa/b.pdf`])],
      ['coa'],
    );

    expect(links).toHaveLength(2);
  });
});
