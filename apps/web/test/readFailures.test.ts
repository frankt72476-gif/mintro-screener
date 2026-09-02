/**
 * A read that fails must never render as the absence of what it failed to read (D-213).
 *
 * Third instance of one class, and the reason it is stated as a rule here rather than fixed a third
 * time and forgotten:
 *
 *   - **D-036** — a failed commentary read must not render as a merchant's silence.
 *   - **D-200** — a failed eye-test read must not render as *not recorded yet*.
 *   - **this** — a failed run-list read must not render as *nothing screened yet*.
 *
 * The third one shipped. `merchant_comments ( count )` became ambiguous when migration 0051 gave
 * that table a second foreign key to `runs`, PostgREST answered PGRST201 on every call, and
 * `list()` returned `[]`. Every operator was shown an empty library and told nothing — the one
 * reading that means *your work is gone*.
 *
 * The fix is the return type, not the copy. A shape that cannot express the failure leaves every
 * caller free to invent one, and one of them will.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PastReports } from '../src/components/PastReports.js';
import type { RunList } from '../src/lib/runs.js';

const render = (listing: RunList): string =>
  renderToStaticMarkup(
    createElement(PastReports, { listing, source: 'Supabase', onOpen: () => {} } as never),
  );

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const RUN = {
  runId: 'r1',
  domain: 'shop.example',
  finishedAt: '2026-08-30T10:00:00.000Z',
  counts: { fail: 1, review: 2 },
  quarantine: null,
  responded: false,
  awaitingReview: false,
};

describe('a failed read', () => {
  const failed: RunList = {
    ok: false,
    error: "Could not embed because more than one relationship was found for 'runs' and 'merchant_comments'",
  };

  it('says it could not be read, and never that there is nothing', () => {
    const body = text(render(failed));

    expect(body).toContain('could not be read');
    expect(body).toContain('not an absence of runs');
    // The sentence that told an operator their work was gone.
    expect(body).not.toContain('Nothing screened yet');
  });

  it('carries the reason, because the reason had the fix in it', () => {
    /*
      PostgREST returned PGRST201 with the two candidate relationships in its own hint, and the old
      code threw it away. A reader who is shown the message can act on it; one who is shown an empty
      list cannot.
    */
    expect(text(render(failed))).toContain('more than one relationship was found');
  });

  it('offers no runs to open, rather than a partial list read as complete', () => {
    expect(render(failed)).not.toContain('dgroup-domain');
  });
});

describe('a genuinely empty library', () => {
  it('says nothing has been screened, which is a different sentence', () => {
    const body = text(render({ ok: true, runs: [], unreadable: 0 }));

    expect(body).toContain('Nothing screened yet');
    expect(body).not.toContain('could not be read');
  });
});

describe('rows that came back and could not be turned into a summary', () => {
  it('are counted and said, not dropped in silence', () => {
    /*
      `flatMap` dropped any run with a null report and said nothing. It fires on nothing today —
      every stored run has a report — but it is the same shape one row down from the bug above, and
      a list that is quietly short is a list nobody can check.
    */
    const body = text(render({ ok: true, runs: [RUN], unreadable: 2 }));

    expect(body).toContain('2 runs could not be read');
    expect(body).toContain('not listed above');
  });

  it('says nothing where nothing was dropped', () => {
    expect(text(render({ ok: true, runs: [RUN], unreadable: 0 }))).not.toContain('could not be read');
  });

  it('agrees in the singular', () => {
    expect(text(render({ ok: true, runs: [RUN], unreadable: 1 }))).toContain('1 run could not be read');
  });
});

describe('the pane the component renders into', () => {
  /*
    The other half of "Past reports renders empty" (D-213).

    bc34363 wrapped this component in `<div className="pane">`, inside the `<section className="pane
    on">` the app already renders. `.pane{display:none}` in `styles.css` applied to the inner one,
    which no `.on` ever reaches — so the list, the empty state and the failure sentence above were
    all invisible whatever the query returned. Nothing about the data would have shown it, which is
    why it survived a diagnosis that went straight to the query and was only caught by looking at
    the rendered page.
  */
  /**
   * The classes on the root element, by string comparison rather than a pattern.
   *
   * The first version of this asserted against a word-boundary regex and passed over the exact
   * markup it exists to reject: the boundaries reached the file as literal control characters, so
   * the pattern matched nothing and the assertion was decorative. A guard that cannot itself be
   * mistyped into silence is worth more than a tidy regex.
   */
  const rootClasses = (listing: RunList): readonly string[] => {
    const markup = render(listing);
    const open = '<div class="';
    if (!markup.startsWith(open)) return [];
    return markup
      .slice(open.length, markup.indexOf('"', open.length))
      .split(' ')
      .filter((name) => name.length > 0);
  };

  it('is not a second, permanently hidden pane', () => {
    for (const listing of [
      { ok: true, runs: [RUN], unreadable: 0 },
      { ok: true, runs: [], unreadable: 0 },
      { ok: false, error: 'boom' },
    ] as const satisfies readonly RunList[]) {
      const classes = rootClasses(listing);
      expect(classes, 'root classes: ' + (classes.join(' ') || '(none)')).not.toContain('pane');
    }
  });

  it('uses class names the stylesheet actually defines', () => {
    /*
      `.pane-head` went in with the wrapper and has no rule anywhere. An invented class is not a
      rendering bug on its own; it is how one hides.
    */
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const used = [...render({ ok: true, runs: [RUN], unreadable: 0 }).matchAll(/class="([^"]+)"/g)]
      .flatMap((m) => (m[1] as string).split(' '))
      .filter((name) => name.length > 0);

    for (const name of new Set(used)) {
      expect(css, `.${name} is used here and defined nowhere`).toContain(`.${name}`);
    }
  });
});
