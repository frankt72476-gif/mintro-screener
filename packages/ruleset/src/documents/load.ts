/**
 * Loading and validating the two Documents Check rule files.
 *
 * **Every defect below refuses the load. None of them warns.** A rule set that half-loaded would
 * run checks nobody asked to omit, and — the case this is really built for — a template naming a
 * slot the catalog does not define is *a requirement that silently does not exist*. It renders as
 * a package with one fewer thing to chase, which is indistinguishable from a package that did not
 * need it. A warning at startup is a line nobody reads in a log nobody opens.
 *
 * **Every defect names the id and the file it came from.** These are two files that reference each
 * other, and a cross-file error that does not say which file is half an error message: "unknown
 * slot `bank_statment`" sends you to whichever file you happened to be editing.
 */

import {
  checksFileSchema,
  templatesFileSchema,
  type CatalogEntry,
  type ChecksFile,
  type DocumentCheck,
  type Processor,
  type TemplatesFile,
} from './schema.js';

/** Which file a defect came from. Never omitted — see the module comment. */
export type DocumentsFile = 'documents.checks.json' | 'documents.templates.json';

export interface DocumentsDefect {
  readonly file: DocumentsFile;
  /** The offending id — a check id, a slot key, a processor key — when there is one. */
  readonly id?: string;
  readonly path: string;
  readonly message: string;
}

export class DocumentsValidationError extends Error {
  readonly defects: readonly DocumentsDefect[];

  constructor(defects: readonly DocumentsDefect[]) {
    const lines = defects.map((d) => `  ${d.file}${d.id === undefined ? '' : ` [${d.id}]`} ${d.path}: ${d.message}`);
    super(`the Documents Check rule files are invalid:\n${lines.join('\n')}`);
    this.name = 'DocumentsValidationError';
    this.defects = defects;
  }
}

export interface DocumentsRules {
  readonly checks: ChecksFile;
  readonly templates: TemplatesFile;
}

const FAMILY_OF: Record<string, string> = { A: 'integrity', B: 'completeness', C: 'consistency', D: 'derived' };

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * Validate both files together.
 *
 * Schema first, then cross-file invariants — and the invariants only run when both documents are
 * structurally sound. Running them over a half-parsed catalog would report "unknown slot" against
 * every template row, burying the one defect that actually needs fixing under twenty that do not.
 */
export function parseDocumentsRules(checksValue: unknown, templatesValue: unknown): DocumentsRules {
  const defects: DocumentsDefect[] = [];

  const checksParsed = checksFileSchema.safeParse(checksValue);
  if (!checksParsed.success) {
    for (const issue of checksParsed.error.issues) {
      const path = issue.path.join('.');
      const idx = issue.path[0] === 'checks' ? Number(issue.path[1]) : -1;
      const raw = (checksValue as { checks?: { id?: unknown }[] } | null)?.checks?.[idx]?.id;
      defects.push({
        file: 'documents.checks.json',
        ...(typeof raw === 'string' ? { id: raw } : {}),
        path: path === '' ? '(root)' : path,
        message: issue.message,
      });
    }
  }

  const templatesParsed = templatesFileSchema.safeParse(templatesValue);
  if (!templatesParsed.success) {
    for (const issue of templatesParsed.error.issues) {
      const path = issue.path.join('.');
      const pIdx = issue.path[0] === 'processors' ? Number(issue.path[1]) : -1;
      const proc = (templatesValue as { processors?: { key?: unknown }[] } | null)?.processors?.[pIdx]?.key;
      defects.push({
        file: 'documents.templates.json',
        ...(typeof proc === 'string' ? { id: proc } : {}),
        path: path === '' ? '(root)' : path,
        message: issue.message,
      });
    }
  }

  if (defects.length > 0) throw new DocumentsValidationError(defects);

  const checks = checksParsed.data as ChecksFile;
  const templates = templatesParsed.data as TemplatesFile;

  defects.push(...crossFileDefects(checks, templates));
  if (defects.length > 0) throw new DocumentsValidationError(defects);

  return { checks, templates };
}

function crossFileDefects(checks: ChecksFile, templates: TemplatesFile): DocumentsDefect[] {
  const defects: DocumentsDefect[] = [];
  const catalog = new Map<string, CatalogEntry>(checks.catalog.map((c) => [c.key, c]));
  const conditions = new Set(checks.not_evaluable_conditions);
  const externals = new Set(checks.external_sources.map((e) => e.key));
  const reasonKeys = new Set([
    ...checks.reasons.not_provided.map((r) => r.key),
    ...checks.reasons.waived.map((r) => r.key),
  ]);

  // --- duplicates, anywhere ---------------------------------------------------------------
  for (const [what, values] of [
    ['catalog key', checks.catalog.map((c) => c.key)],
    ['check id', checks.checks.map((c) => c.id)],
    ['external source', checks.external_sources.map((e) => e.key)],
    ['reason', [...checks.reasons.not_provided, ...checks.reasons.waived].map((r) => r.key)],
  ] as const) {
    for (const dupe of duplicates(values)) {
      defects.push({ file: 'documents.checks.json', id: dupe, path: what, message: `duplicate ${what}` });
    }
  }
  for (const dupe of duplicates(templates.processors.map((p) => p.key))) {
    defects.push({ file: 'documents.templates.json', id: dupe, path: 'processors', message: 'duplicate processor key' });
  }

  // --- checks -----------------------------------------------------------------------------
  checks.checks.forEach((check, i) => {
    const at = (suffix: string): string => `checks[${i}].${suffix}`;
    const bad = (path: string, message: string): void => {
      defects.push({ file: 'documents.checks.json', id: check.id, path, message });
    };

    // Family prefix. The id is the only place a check declares which family it belongs to, so a
    // mistyped prefix silently moves it into another family's rules.
    const family = check.id[0] ?? '';
    if (FAMILY_OF[family] === undefined) {
      bad(at('id'), `unknown family prefix '${family}'`);
    }

    for (const key of check.reads.documents ?? []) {
      if (key === '*') continue;
      const entry = catalog.get(key);
      if (entry === undefined) {
        bad(at('reads.documents'), `names '${key}', which documents.checks.json's catalog does not define`);
        continue;
      }
      // D-082: a collected-only document is present-not-examined. A check consuming one is a
      // contradiction between two halves of the same file, and the contradiction would surface as
      // a finding about a document nobody read.
      if (!entry.examined) {
        bad(
          at('reads.documents'),
          `reads '${key}', which the catalog marks collected_only — a collected-only document is present-not-examined (D-082) and no check may consume it`,
        );
      }
    }

    for (const key of check.reads.slots ?? []) {
      if (key !== '*' && !catalog.has(key)) {
        bad(at('reads.slots'), `names slot '${key}', which documents.checks.json's catalog does not define`);
      }
    }

    for (const key of check.reads.external ?? []) {
      if (!externals.has(key)) {
        bad(at('reads.external'), `names external source '${key}', which this file does not declare`);
      }
    }

    for (const condition of check.not_evaluable_when) {
      if (!conditions.has(condition)) {
        bad(
          at('not_evaluable_when'),
          `uses condition '${condition}', which is not in not_evaluable_conditions — §1 requires these be enumerated`,
        );
      }
    }
  });

  // --- reason enumerations (D-079) ---------------------------------------------------------
  // A reason used anywhere outside its enumeration. `compares` is open by design, so a slot reason
  // referenced there is the one place a stray value could reach the engine.
  checks.checks.forEach((check, i) => {
    const compares = check.compares as Record<string, unknown>;
    for (const [key, value] of Object.entries(compares)) {
      if (!key.toLowerCase().includes('reason') || typeof value !== 'string') continue;
      if (!reasonKeys.has(value)) {
        defects.push({
          file: 'documents.checks.json',
          id: check.id,
          path: `checks[${i}].compares.${key}`,
          message: `'${value}' is not in the not_provided or waived enumerations (D-079)`,
        });
      }
    }
  });

  // --- templates ---------------------------------------------------------------------------
  for (const processor of templates.processors) {
    const seen = new Set<string>();
    processor.slots.forEach((slot, i) => {
      const path = `processors[${processor.key}].slots[${i}]`;
      // The first real bug this file will have. A slot_key with a typo is a requirement that
      // silently does not exist: the package renders with one fewer thing to chase, which looks
      // exactly like a package that did not need it.
      if (!catalog.has(slot.slot_key)) {
        defects.push({
          file: 'documents.templates.json',
          id: slot.slot_key,
          path,
          message: `names a slot documents.checks.json's catalog does not define — a requirement that would silently not exist`,
        });
      }
      if (seen.has(slot.slot_key)) {
        defects.push({
          file: 'documents.templates.json',
          id: slot.slot_key,
          path,
          message: `appears twice in processor '${processor.key}'`,
        });
      }
      seen.add(slot.slot_key);

      const predicate = slot.predicate as { field?: string } | undefined;
      if (predicate?.field !== undefined && !(predicate.field in templates.predicate_inputs)) {
        defects.push({
          file: 'documents.templates.json',
          id: slot.slot_key,
          path: `${path}.predicate.field`,
          message: `predicates on '${predicate.field}', which is not one of the three questions asked at package creation (D-081)`,
        });
      }
    });
  }

  return defects;
}

/** The processor's set, conditionals unresolved. `undefined` when the processor is not defined. */
export function processorTemplate(rules: DocumentsRules, key: string): Processor | undefined {
  return rules.templates.processors.find((p) => p.key === key);
}

/** Checks in a release. `v1` excludes the three the inventory marks deferred. */
export function checksInRelease(rules: DocumentsRules, release: 'v1' | 'deferred'): DocumentCheck[] {
  return rules.checks.checks.filter((c) => c.release === release);
}
