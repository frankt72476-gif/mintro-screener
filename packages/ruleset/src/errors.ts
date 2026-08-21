/**
 * Failure reporting for rule set loading.
 *
 * Two properties matter here, both from the brief:
 *
 *   1. Nothing is ever skipped silently. A defect stops the load; it never drops a rule and
 *      carries on with the rest. A rule set that half-loaded would produce a report missing
 *      checks that nobody asked to omit.
 *   2. Every defect names the offending rule and what is wrong with it. The loader collects
 *      *all* defects across *all* rules and reports them together, so a rule set with six
 *      problems takes one pass to fix rather than six.
 */

import type { ZodIssue } from 'zod';

/** One thing wrong with the rule set. */
export interface RulesetDefect {
  /**
   * The rule this defect belongs to, when it can be determined. Absent for defects in the
   * rule set header, and for a rule whose own `id` is the malformed field — those are
   * located by `path` instead.
   */
  readonly ruleId?: string;
  /** Where in the document, as a JSON path: `rules[12].params.window_tokens`. */
  readonly path: string;
  /** What is wrong, in plain words. */
  readonly message: string;
}

/**
 * Thrown when a rule set cannot be loaded. Carries every defect found, not just the first.
 *
 * Nothing partial is returned alongside this. A caller that catches it has no rule set, which
 * is the intended outcome — running a screen against a rule set we could not fully validate
 * would put findings in a report on the strength of rules we never checked.
 */
export class RulesetValidationError extends Error {
  readonly defects: readonly RulesetDefect[];
  /** Where the rule set came from — a file path, or a description for in-memory input. */
  readonly source: string;

  constructor(source: string, defects: readonly RulesetDefect[]) {
    super(formatDefects(source, defects));
    this.name = 'RulesetValidationError';
    this.source = source;
    this.defects = defects;
  }

  /** Rule IDs with at least one defect, in document order, deduplicated. */
  get affectedRuleIds(): string[] {
    const seen = new Set<string>();
    for (const defect of this.defects) {
      if (defect.ruleId !== undefined) seen.add(defect.ruleId);
    }
    return [...seen];
  }
}

/** Renders a JSON path array as `rules[12].params.window_tokens`. */
export function formatPath(segments: readonly (string | number)[]): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out === '' ? '(root)' : out;
}

/**
 * Recovers the rule ID for a defect from the raw input.
 *
 * Deliberately reads the *unvalidated* document: when a rule fails validation we still want
 * to name it, and its `id` is usually intact even when another field is not. When the `id`
 * itself is missing or not a string there is nothing trustworthy to name it by, so the defect
 * is reported by path alone rather than by a guess.
 */
export function ruleIdAtPath(raw: unknown, segments: readonly (string | number)[]): string | undefined {
  if (segments[0] !== 'rules' || typeof segments[1] !== 'number') return undefined;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const rules = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return undefined;
  const rule: unknown = rules[segments[1]];
  if (typeof rule !== 'object' || rule === null) return undefined;
  const id: unknown = (rule as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Reads the value at a JSON path in the raw document, for reporting what was actually found. */
function valueAtPath(raw: unknown, segments: readonly (string | number)[]): unknown {
  let current: unknown = raw;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** Renders a found value compactly enough to sit at the end of an error line. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (value === undefined) return 'nothing';
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object';
  return String(value);
}

/**
 * Converts Zod issues into defects, attaching rule IDs where they can be recovered.
 *
 * Zod's `invalid_union_discriminator` message lists what was expected but not what was found,
 * which for an unknown check type is the one thing the reader needs. The received value is
 * read back out of the raw document and appended.
 */
export function defectsFromZodIssues(issues: readonly ZodIssue[], raw: unknown): RulesetDefect[] {
  return issues.map((issue) => {
    const ruleId = ruleIdAtPath(raw, issue.path);
    let message = issue.message;

    if (issue.code === 'invalid_union_discriminator') {
      message += `, found ${describeValue(valueAtPath(raw, issue.path))}`;
    }

    return {
      ...(ruleId === undefined ? {} : { ruleId }),
      path: formatPath(issue.path),
      message,
    };
  });
}

/**
 * Orders defects by position in the document, so the reported list reads in the same order as
 * the file being fixed. Header defects sort ahead of rule defects.
 */
export function inDocumentOrder(defects: readonly RulesetDefect[]): RulesetDefect[] {
  const indexOf = (defect: RulesetDefect): number => {
    const match = /\[(\d+)\]/.exec(defect.path);
    if (match === null) return -1;
    return defect.path.startsWith('rules') ? Number(match[1]) : -1;
  };
  return [...defects].sort((a, b) => indexOf(a) - indexOf(b));
}

/**
 * Builds the thrown message: one line per defect, each naming the rule where known.
 *
 * Defects are printed in document order rather than grouped by kind, so the output reads in
 * the same order as the file being fixed.
 */
function formatDefects(source: string, defects: readonly RulesetDefect[]): string {
  const count = defects.length;
  const heading =
    count === 1
      ? `Rule set at ${source} is invalid — 1 defect:`
      : `Rule set at ${source} is invalid — ${count} defects:`;

  const lines = defects.map((defect) => {
    const where = defect.ruleId === undefined ? defect.path : `${defect.ruleId} (${defect.path})`;
    return `  • ${where}: ${defect.message}`;
  });

  return [heading, ...lines].join('\n');
}
