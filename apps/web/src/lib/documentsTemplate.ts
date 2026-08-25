/**
 * The rule files, in the browser.
 *
 * `loadSlotTemplate()` reads from disk, which is right for the worker and impossible here. The
 * frontend imports the same two JSON files as modules and parses them through the same loader — so
 * the browser and the worker validate identical bytes with identical code, and a malformed rule
 * file fails the build rather than the screen.
 *
 * Bundling them is not a leak. They are the capability statement and the required set; §7 of the
 * report already publishes the first to an underwriter, and an operator composing a package needs
 * the second in front of them.
 */

import checks from '../../../../rules/documents.checks.json';
import templates from '../../../../rules/documents.templates.json';
import {
  parseDocumentsRules, loadSlotTemplate, type DocumentsRules, type SlotTemplate,
} from '@mintro/ruleset';

let cached: SlotTemplate | null = null;

/** Parsed once. The files cannot change under a running tab. */
export function browserSlotTemplate(): SlotTemplate {
  cached ??= loadSlotTemplate(parseDocumentsRules(checks, templates));
  return cached;
}

/**
 * The parsed rule files themselves.
 *
 * The rule set page renders the checks rather than restating them, so it needs the checks and not
 * only the slot template. Same parse, cached the same way — a second parse would be a second
 * opinion about what the file contains.
 */
let cachedRules: DocumentsRules | null = null;

export function browserDocumentsRules(): DocumentsRules {
  cachedRules ??= parseDocumentsRules(checks, templates);
  return cachedRules;
}
