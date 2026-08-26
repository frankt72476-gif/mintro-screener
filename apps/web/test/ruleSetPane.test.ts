/**
 * The rule set page.
 *
 * The requirement that shapes every test here: **a page describing 38 checks that drifts from the
 * 38 checks is worse than no page.** So the assertions are not "it mentions C-05" — they are
 * "everything in the file is on the page, and nothing on the page is written out by hand."
 *
 * The other half is D-076. Every line has to say what was *compared*; none may say a fact about the
 * world was established. The page states that at the top and the per-kind sentences carry it, and
 * both are pinned below.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { RuleSetPane } from '../src/components/RuleSetPane.js';
import { parseRuleset } from '@mintro/ruleset';
import { browserDocumentsRules } from '../src/lib/documentsTemplate.js';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));
const CHECKS = JSON.parse(readFileSync('rules/documents.checks.json', 'utf8')) as {
  checks: { id: string; title: string; release: string; compares: { kind: string } }[];
  not_checked: { external_verification: string; items: { subject: string; why: string }[] };
};

const html = (): string => renderToStaticMarkup(createElement(RuleSetPane, { ruleset: RULESET }));
const text = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'")
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('the Documents checks come from the file, not from prose', () => {
  it('renders every check in the file and no others', () => {
    const markup = html();
    const rendered = [...markup.matchAll(/data-check="([^"]+)"/g)].map((m) => m[1]!);
    // Exactly the file's ids, in the file's order. A check added to the rule set appears here
    // without anybody editing this page, and one removed disappears.
    expect(rendered).toEqual(CHECKS.checks.map((c) => c.id));
  });

  it('renders all 38, and says how many actually run', () => {
    const markup = html();
    expect(CHECKS.checks).toHaveLength(38);
    const live = CHECKS.checks.filter((c) => c.release === 'v1').length;
    expect(live).toBe(35);
    // Both numbers on the page: the ones that run, and the ones declared and not running.
    expect(text(markup)).toContain(`${live} checks run in this release`);
    expect(text(markup)).toContain(`${38 - live} more are declared and do not`);
  });

  it('carries every check’s own title verbatim', () => {
    const body = text(html());
    for (const check of CHECKS.checks) {
      // The titles are already written in D-076's voice — the method is in the name, because a
      // name is the part that gets skimmed. Restating them here would be where that slipped.
      expect(body, `missing the title for ${check.id}`).toContain(check.title);
    }
  });

  it('marks the deferred ones rather than quietly listing them as capability', () => {
    const markup = html();
    for (const check of CHECKS.checks.filter((c) => c.release !== 'v1')) {
      const row = new RegExp(`data-check="${check.id}"[\\s\\S]*?</tr>`).exec(markup)?.[0] ?? '';
      expect(row, `${check.id} is not marked`).toContain('not in this release');
    }
    for (const check of CHECKS.checks.filter((c) => c.release === 'v1').slice(0, 5)) {
      const row = new RegExp(`data-check="${check.id}"[\\s\\S]*?</tr>`).exec(markup)?.[0] ?? '';
      expect(row, `${check.id} is wrongly marked`).not.toContain('not in this release');
    }
  });

  /*
    The guard on the explanation itself.

    Each check is explained by a sentence keyed off `compares.kind`, so a *new kind* would render
    with no description. That must fail here rather than ship as a blank cell, which reads as
    "nothing to say" about a comparison nobody has described.
  */
  it('has a method sentence for every comparison kind the file uses', () => {
    const body = text(html());
    const kinds = [...new Set(CHECKS.checks.map((c) => c.compares.kind))];
    expect(kinds.length).toBeGreaterThan(8);
    expect(body).not.toContain('has no description on this page yet');
    for (const kind of kinds) {
      expect(body, `${kind} is not shown`).toContain(kind.replace(/_/g, ' '));
    }
  });
});

describe('an unexplained comparison kind is visible, not blank', () => {
  it('says so when a kind has no sentence', () => {
    /*
      The fallback cannot be reached with the real file, because every kind in it is described. It
      is still the branch that runs the day somebody adds a comparison and forgets this page — and a
      blank cell would read as "nothing to explain" about a check nobody has described.
    */
    const rules = browserDocumentsRules();
    const invented = {
      ...rules,
      checks: {
        ...rules.checks,
        checks: [{ ...rules.checks.checks[0]!, id: 'Z-01', compares: { kind: 'telepathy' } }] as never,
      },
    };
    const markup = renderToStaticMarkup(
      createElement(RuleSetPane, { ruleset: RULESET, documentsRules: invented as never }),
    );
    expect(text(markup)).toContain('This comparison has no description on this page yet');
  });
});

describe('it says what was compared, never what was established (D-076)', () => {
  it('states the distinction at the top, in the reader’s terms', () => {
    const body = text(html());
    expect(body).toContain('three documents can agree and all be wrong');
    expect(body).toContain('None of them says a fact about the world was established');
  });

  it('never claims a subject was verified', () => {
    const body = text(html());
    /*
      "EIN verified" is the sentence D-076 exists to prevent.

      A **denied** claim is the opposite of the defect and has to pass: "establishes what was
      supplied, not whether it is genuine" is exactly the copy this page should carry. So the
      exemption is a negator in the words immediately before the phrase, not anywhere in a window —
      a loose window would let a real claim through on the strength of an unrelated "not" nearby.
    */
    const NEGATED = /(not|never|nothing|no)\s+(whether\s+)?(it\s+|they\s+|external\s+)?[a-z]*\s*$/i;
    for (const claim of ['verified', 'confirmed that', 'proves that', 'is genuine', 'is valid']) {
      const offending: string[] = [];
      for (const match of body.matchAll(new RegExp(claim, 'gi'))) {
        const before = body.slice(Math.max(0, match.index - 30), match.index);
        if (!NEGATED.test(before)) offending.push(`…${before}[${match[0]}]…`);
      }
      expect(offending, `page claims: ${offending.join(' | ')}`).toEqual([]);
    }
  });

  it('says an external lookup establishes what the directory says, not that the value is right', () => {
    expect(text(html())).toContain('which is a narrower fact than the value being correct');
  });
});

describe('the boundary renders verbatim', () => {
  it('carries §7’s external-verification sentence exactly', () => {
    // Not paraphrased. This is the section a reader relies on to know what nobody did, and a
    // paraphrase is where a boundary softens (D-018, D-076).
    expect(text(html())).toContain(text(CHECKS.not_checked.external_verification));
  });

  it('lists every not-checked item with its reason', () => {
    const body = text(html());
    for (const item of CHECKS.not_checked.items) {
      expect(body, `missing: ${item.subject}`).toContain(item.subject);
      expect(body, `missing the reason for: ${item.subject}`).toContain(item.why);
    }
    expect(CHECKS.not_checked.items.length).toBeGreaterThan(5);
  });
});

describe('Site Check is one labelled programme set, not the only conceivable one', () => {
  it('names the peptide programme rather than calling it "the rule set"', () => {
    const body = text(html());
    expect(body).toContain('RUO peptide programme');
    expect(body).toContain('Research-use-only peptides');
  });

  it('reads its version, date and count from the loaded file', () => {
    const body = text(html());
    expect(body).toContain(`v${RULESET.version}`);
    expect(body).toContain(RULESET.effective);
    expect(body).toContain(`${RULESET.rules.length} rules`);
    expect(RULESET.rules).toHaveLength(54);
  });

  it('shows every rule category and its count', () => {
    const body = text(html());
    const counts = new Map<string, number>();
    for (const rule of RULESET.rules) {
      const key = rule.id.split('-')[0]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, n] of counts) {
      expect(body, `missing category ${key}`).toMatch(new RegExp(`${key}\\s+${n}`));
    }
  });

  it('says plainly that no other programme set exists', () => {
    // Naming the shape without promising a date. A page listing "gaming — coming soon" would be a
    // capability statement for something nobody has written.
    const body = text(html());
    expect(body).toContain('No other programme rule set exists');
    expect(body).toContain('its own labelled set');
    expect(body).not.toMatch(/coming soon|planned for|will support/i);
  });
});

describe('it is reference and not a control surface', () => {
  it('renders no buttons, inputs or forms', () => {
    const markup = html();
    for (const control of ['<button', '<input', '<form', '<select']) {
      expect(markup, `renders ${control}`).not.toContain(control);
    }
  });
});
