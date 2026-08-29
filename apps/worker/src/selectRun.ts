/**
 * Choosing which stored run a CLI acts on.
 *
 * `report-pdf` keyed on merchant domain — it read `reports/<domain>.json` — and that held only
 * while one storefront meant one file. `fixtures/reports/` holds two runs of
 * sportstechnologylabs.com at different rule-set versions, so a domain key now has to pick one of
 * them, and picking is the failure: the operator asks for a report of a storefront, gets a document
 * about a run they did not name, and nothing on the page says which run it was.
 *
 * That is the D-167 footgun written down rather than fixed — the regeneration recipe had to warn
 * that rendering without first copying a fixture over a domain name "silently produces a PDF of the
 * wrong run". A warning in a decision record is not a guard (D-169).
 *
 * So the **run id is the key**. A domain is accepted as a convenience and must resolve to exactly
 * one run; where it does not, this refuses and names every candidate. Refusing costs the operator
 * eight retyped characters. Choosing costs a document about the wrong run, indistinguishable from
 * the right one unless somebody checks the id.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreeningReport } from '@mintro/engine';

export interface StoredRun {
  /** File name within the directory it was read from, so a caller can fetch it back by name. */
  readonly file: string;
  readonly report: ScreeningReport;
}

/** `c268f8d7 · 3.1.0 · sportstechnologylabs.com · 2026-08-28` — enough to tell two runs apart. */
export function describeRun(run: StoredRun): string {
  const { runId, rulesetVersion, merchantDomain, startedAt } = run.report;
  return `${runId.slice(0, 8)} · ${rulesetVersion} · ${merchantDomain} · ${startedAt.slice(0, 10)}`;
}

/** `www.` is noise for selection; a domain typed either way should find the run. */
const bareDomain = (domain: string): string => domain.toLowerCase().replace(/^www\./, '');

/**
 * The run a selector names, or an error explaining what to type instead.
 *
 * A run id — full or an unambiguous prefix of at least four characters — is matched first, so a
 * selector that looks like an id is never reinterpreted as a domain. Prefixes shorter than that are
 * not matched at all: a one-character "prefix" is not a choice, it is a lottery.
 */
export function selectRun(runs: readonly StoredRun[], selector: string): StoredRun {
  const wanted = selector.trim();

  const byId = runs.filter(
    (run) => run.report.runId === wanted || (wanted.length >= 4 && run.report.runId.startsWith(wanted)),
  );
  const matches =
    byId.length > 0
      ? byId
      : runs.filter((run) => bareDomain(run.report.merchantDomain) === bareDomain(wanted));

  if (matches.length === 1) return matches[0] as StoredRun;

  if (matches.length === 0) {
    throw new Error(
      `no stored run matches "${wanted}".\n\n${listing(runs)}\n` +
        `  Give a run id, or a domain that names exactly one of them.`,
    );
  }

  // The case this module exists for. Naming the candidates is the whole of the fix: the operator
  // knows which run they meant, and this does not.
  throw new Error(
    `"${wanted}" matches ${matches.length} stored runs, and choosing between them is not this\n` +
      `  script's decision to make. Name one by run id:\n\n${listing(matches)}`,
  );
}

/**
 * Every run, or the reason there are none.
 *
 * A caller offered no selector gets this rather than the first file in the directory — which is
 * what `print-check` did, and it meant the check silently described whichever run sorted first.
 */
export function requireSingleRun(runs: readonly StoredRun[]): StoredRun {
  if (runs.length === 1) return runs[0] as StoredRun;
  if (runs.length === 0) throw new Error('no stored runs to read.');
  throw new Error(
    `${runs.length} stored runs and no selector, so there is nothing to choose from but the file\n` +
      `  order. Name one by run id:\n\n${listing(runs)}`,
  );
}

const listing = (runs: readonly StoredRun[]): string =>
  runs.map((run) => `    ${describeRun(run)}`).join('\n');

/**
 * Every stored report in a directory.
 *
 * A `.json` that carries no `runId` is not a run and is skipped rather than parsed as one — the
 * directory the web app serves from also holds an `index.json` listing file names, and reading it
 * as a report would fail somewhere far from the cause.
 */
export function readStoredRuns(dir: string): StoredRun[] {
  const runs: StoredRun[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<ScreeningReport>;
    if (typeof parsed.runId !== 'string') continue;
    runs.push({ file, report: parsed as ScreeningReport });
  }
  return runs;
}
