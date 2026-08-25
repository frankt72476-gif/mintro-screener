/**
 * What each screening checks — the rule set page.
 *
 * Written for an agent or a processor reading it cold, and **rendered from the rule files rather
 * than written out**. A page that describes 38 checks and drifts from the 38 checks is worse than
 * no page: it is a capability statement that has quietly stopped being true, in front of the person
 * deciding an application.
 *
 * ## Every line says what was compared, never what was established about the world
 *
 * D-076: *not "EIN verified" — "EIN consistent across application, EIN letter and W-9."* Verified is
 * a claim about reality; consistent is a claim about three pieces of paper. If all three say the
 * same wrong number a consistency check passes and nothing about the world has been established.
 *
 * A name is the part that gets skimmed, so the method has to be in the name. The check titles in
 * `documents.checks.json` are already written that way; what this page adds is one sentence per
 * **comparison kind**, defined once in `METHOD` below, so the explanation cannot drift from the
 * check either.
 *
 * ## And it publishes the boundary
 *
 * §7's `not_checked` renders verbatim. Silence is not a boundary — an absent claim reads the same
 * whether the IRS was consulted and matched or never consulted at all (D-018, D-076).
 */

import { useMemo } from 'react';
import type { DocumentsRules, Ruleset } from '@mintro/ruleset';
import { browserDocumentsRules } from '../lib/documentsTemplate';

export interface RuleSetPaneProps {
  readonly ruleset: Ruleset;
  /**
   * The documents rules, defaulting to the ones the browser parsed.
   *
   * A parameter so the unexplained-kind fallback is reachable: with only the real file, that branch
   * cannot be rendered, and an unreachable guard is one nobody can prove works.
   */
  readonly documentsRules?: DocumentsRules;
}

/**
 * One sentence per comparison kind, in D-076's voice.
 *
 * Keyed off `compares.kind` in the rule file rather than written per check, so a check added to the
 * file is explained without anybody editing this page. A kind with no entry here renders as
 * unexplained and fails a test — better than a blank line that reads as "nothing to say".
 */
const METHOD: Readonly<Record<string, string>> = {
  field_across_documents:
    'Compares the same field across the documents that carry it. Establishes that those documents agree with each other — not that the value is correct.',
  field_against_either:
    'Compares a field against either of the two documents that may carry it, whichever the package holds. Establishes agreement between the documents present.',
  derived_vs_stated:
    'Recomputes a figure from the document that shows the underlying detail and compares it with the figure stated elsewhere. Establishes whether the two accounts agree.',
  arithmetic:
    'Checks that figures printed on one document add up. Establishes internal consistency of that document, and nothing about the amounts being real.',
  structure:
    'Reads the document as a file rather than as content. Establishes whether it can be read and how completely, not what it says.',
  presence:
    'Checks whether something the package requires is present. Establishes what was supplied, not whether it is genuine.',
  count:
    'Counts what the package holds against the number the required set asks for. Establishes how many, not which.',
  window:
    'Compares the periods a document covers against the coverage window the requirement names. Establishes whether the months asked for are the months supplied.',
  date_against_run:
    'Compares a date printed on the document against the moment the run executed. Establishes the document’s age at that instant and at no other.',
  sequence:
    'Checks that a series runs in order and without gaps. Establishes continuity of what was supplied.',
  external_lookup:
    'Looks a value up in a published directory. Establishes what that directory says about it, which is a narrower fact than the value being correct.',
  consistency_with_slot_reason:
    'Compares what the package says about a missing document against what the other documents show. Establishes whether the stated reason and the evidence agree.',
};

/** Each family, in one line an underwriter can read without the inventory open. */
const FAMILY: readonly { readonly key: string; readonly name: string; readonly what: string }[] = [
  { key: 'A', name: 'The documents as files', what: 'Whether each file can be read at all, how much of it, and by which route.' },
  { key: 'B', name: 'The package as a set', what: 'Whether the set is complete and current against the required list, and whether the answers behind it are on record.' },
  { key: 'C', name: 'Fields across documents', what: 'Whether the documents agree with one another about names, numbers, addresses and dates.' },
  { key: 'D', name: 'Figures against figures', what: 'Whether amounts recomputed from a statement agree with the amounts stated elsewhere.' },
];

const humanise = (key: string): string => key.replace(/_/g, ' ');

export function RuleSetPane({ ruleset, documentsRules }: RuleSetPaneProps): JSX.Element {
  const rules = useMemo(() => documentsRules ?? browserDocumentsRules(), [documentsRules]);
  const checks = rules.checks.checks;
  const notChecked = rules.checks.not_checked;
  const catalog = useMemo(
    () => new Map(rules.checks.catalog.map((c) => [c.key, c.title])),
    [rules],
  );

  const byCategory = useMemo(() => {
    const out = new Map<string, typeof ruleset.rules>();
    for (const rule of ruleset.rules) {
      const key = rule.id.split('-')[0]!;
      out.set(key, [...(out.get(key) ?? []), rule]);
    }
    return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [ruleset]);

  const live = checks.filter((c) => c.release === 'v1');
  const deferred = checks.filter((c) => c.release !== 'v1');

  return (
    <div className="ruleset-page">
      <div className="eyebrow">Reference</div>
      <h1>What each screening checks</h1>
      <p className="sub">
        Every line below says what was <strong>compared</strong>. None of them says a fact about the
        world was established: comparing documents a merchant supplied shows whether those documents
        agree, and three documents can agree and all be wrong. What is not checked is listed at the
        end, in full.
      </p>

      {/* ── Site Check ─────────────────────────────────────────────────────────────────────── */}
      <section className="rs-block">
        <h2>Site Check — the public storefront</h2>
        <p className="rs-why">
          A crawl of what the merchant’s website shows the public, compared against a named rule set.
          One rule set exists today. Others are separate labelled sets rather than additions to this
          one, because a rule written for one programme is not a rule for another.
        </p>

        <div className="rs-set">
          <div className="rs-set-head">
            <h3>RUO peptide programme</h3>
            <span className="rs-tag">
              v{ruleset.version} · effective {ruleset.effective} · {ruleset.rules.length} rules
            </span>
          </div>
          <p className="rs-why">
            Research-use-only peptides. Drawn from the programme document named in the rule file
            (<code>{ruleset.source_document}</code>), and applied only to merchants screened under
            that programme.
          </p>

          <ul className="rs-cats">
            {byCategory.map(([key, group]) => (
              <li key={key}>
                <span className="rs-cat">{key}</span>
                <span className="rs-count">{group.length}</span>
                <span className="rs-catwhat">{group[0]?.cat ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>

        {/*
          Not a placeholder and not a promise. It names the shape so a reader can see that a second
          programme is a second labelled set, and can see that there is not one today.
        */}
        <p className="rs-none">
          No other programme rule set exists. Gaming, adult and any other vertical would be added
          here as its own labelled set, with its own version and effective date, screened against
          only where that programme applies.
        </p>
      </section>

      {/* ── Documents Check ────────────────────────────────────────────────────────────────── */}
      <section className="rs-block">
        <h2>Documents Check — the paperwork</h2>
        <p className="rs-why">
          Comparisons between documents the merchant supplied. {live.length} checks run in this
          release{deferred.length === 0 ? '' : `, and ${deferred.length} more are declared and do not`}
          . Rendered from the rule file itself, so this page cannot describe checks the system does
          not run.
        </p>

        <ul className="rs-families">
          {FAMILY.map((family) => (
            <li key={family.key}>
              <span className="rs-cat">{family.key}</span>
              <div>
                <strong>{family.name}</strong>
                <p>{family.what}</p>
              </div>
            </li>
          ))}
        </ul>

        <table className="rs-checks">
          <thead>
            <tr>
              <th>Check</th>
              <th>What it compares</th>
              <th>Reads</th>
              <th>Outcomes</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              const method = METHOD[check.compares.kind];
              const reads = (check.reads.documents ?? []).map((key) =>
                key === '*' ? 'every document' : (catalog.get(key) ?? key),
              );
              return (
                <tr key={check.id} data-release={check.release} data-check={check.id}>
                  <td>
                    <code>{check.id}</code>
                    <div className="rs-title">{check.title}</div>
                    {check.release !== 'v1' && (
                      <span className="rs-deferred">not in this release</span>
                    )}
                  </td>
                  <td>
                    <span className="rs-kind">{humanise(check.compares.kind)}</span>
                    {/*
                      A kind with no sentence says so rather than rendering blank. A blank cell reads
                      as "nothing to explain", which is the opposite of what an unrecognised
                      comparison means.
                    */}
                    <p>{method ?? 'This comparison has no description on this page yet.'}</p>
                  </td>
                  <td>
                    {reads.length === 0 ? <span className="rs-quiet">the package</span> : reads.join(', ')}
                    {(check.reads.external ?? []).length > 0 && (
                      <div className="rs-external">
                        plus {(check.reads.external ?? []).map((k) => {
                          const source = rules.checks.external_sources.find((s) => s.key === k);
                          return source?.label ?? k;
                        }).join(', ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="rs-states">{check.states.join(' · ')}</span>
                    {check.not_evaluable_when.length > 0 && (
                      <div className="rs-quiet">
                        not evaluable when: {check.not_evaluable_when.map(humanise).join('; ')}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── the boundary, verbatim ─────────────────────────────────────────────────────────── */}
      <section className="rs-block rs-boundary">
        <h2>What is not checked</h2>
        {/*
          Verbatim from the rule file. Not paraphrased, because this is the section a reader relies
          on to know what nobody did — and a paraphrase is where a boundary softens (D-018, D-076).
        */}
        <p className="rs-verbatim">{notChecked.external_verification}</p>
        <ul className="rs-notchecked">
          {notChecked.items.map((item) => (
            <li key={item.subject}>
              <strong>{item.subject}</strong>
              <span>{item.why}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
