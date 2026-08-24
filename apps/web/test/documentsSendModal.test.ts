/**
 * The send modal.
 *
 * Two properties here are about what is **absent**, and absence is the harder thing to test: there
 * is no note field (D-124), and nothing gates the send on what the report says (D-001). Both are
 * asserted against the rendered markup, because "we did not add a box" is only true until somebody
 * adds one.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentsSendModal } from '../src/components/DocumentsSendModal.js';
import type { DocumentsSendQueue, PastSend } from '../src/lib/documentsSendQueue.js';

const queue: DocumentsSendQueue = {
  request: async () => ({ id: 'req-1', status: 'queued', toEmail: 'x@y.com', outcome: null, error: null }),
  poll: async () => null,
  history: async () => [],
  sendability: async () => ({ runId: 'run-1', sendable: true, reason: null }),
};

const send = (over: Partial<PastSend> = {}): PastSend => ({
  id: 's-1', runId: 'run-abcdef12', recipient: 'underwriting@iqwallet.com',
  sentAt: '2026-08-19T14:02:11.000Z', mailer: 'resend', outcome: 'accepted', error: null, ...over,
});

function render(history: readonly PastSend[] = []): string {
  return renderToStaticMarkup(
    createElement(DocumentsSendModal, {
      packageId: 'pkg-1',
      runId: 'run-abcdef12',
      merchantName: 'Northwind Peptides LLC',
      queue,
      history,
      onCancel: () => undefined,
      onSent: () => undefined,
    }),
  );
}

describe('the operator types an address and nothing else (D-124)', () => {
  it('offers exactly one input', () => {
    const html = render();
    expect(html.split('<input').length - 1).toBe(1);
    expect(html).toContain('id="doc-to"');
  });

  /**
   * The control is the absence of the box. A field labelled anything at all will eventually hold a
   * compliance conclusion, in Mintro's message, under Mintro's name.
   */
  it('has no note field, and no textarea anywhere', () => {
    const html = render();
    expect(html).not.toContain('<textarea');
    expect(html.toLowerCase()).not.toContain('>note<');
    expect(html.toLowerCase()).not.toContain('covering');
  });
});

describe('nothing gates the send on what the report says (D-001)', () => {
  it('renders a send button with no reference to counts or findings', () => {
    const html = render();
    expect(html).toContain('>Send<');
    expect(html.toLowerCase()).not.toMatch(/\d+ (failed|review|issues)/);
    expect(html.toLowerCase()).not.toMatch(/cannot send|blocked|resolve .* before/);
  });

  it('says the report is fixed to its run', () => {
    expect(render()).toMatch(/fixed to run run-abcd/);
  });
});

describe('the send history says when, to whom and which run', () => {
  it('renders one row per send with all three', () => {
    const html = render([send(), send({ id: 's-2', recipient: 'second@iqwallet.com', runId: 'run-99887766' })]);
    expect(html.split('<li').length - 1).toBe(2);
    expect(html).toContain('2026-08-19 14:02');
    expect(html).toContain('underwriting@iqwallet.com');
    expect(html).toContain('run run-abcd');
    expect(html).toContain('run run-9988');
  });

  it('says so when there is no history', () => {
    expect(render()).toContain('has not been sent before');
  });

  /** A dry run composed a message and transmitted nothing. It must never read as delivered. */
  it('flags a dry run', () => {
    expect(render([send({ mailer: 'dry_run' })])).toContain('dry run');
    expect(render([send({ mailer: 'resend' })])).not.toContain('>dry run<');
  });

  it('flags a refused send rather than hiding it', () => {
    const html = render([send({ outcome: 'rejected', error: '422 domain not verified' })]);
    expect(html).toContain('refused');
    expect(html).toContain('data-outcome="rejected"');
  });
});
