/**
 * Validate the two Documents Check rule files (D-101).
 *
 *     npm run validate:documents
 *
 * Exits 1 on any defect, printing every one with the file it came from. There is no warning tier:
 * the defects this catches — chiefly a template naming a slot the catalog does not define — produce
 * requirements that silently do not exist, and a warning is a line nobody reads in a log nobody
 * opens.
 */

import { resolve } from 'node:path';
import { DocumentsValidationError } from '../src/documents/load.js';
import { CHECKS_PATH, TEMPLATES_PATH, loadDocumentsRules } from '../src/documents/loadFile.js';

function main(argv: readonly string[]): number {
  const checksPath = resolve(process.cwd(), argv[0] ?? CHECKS_PATH);
  const templatesPath = resolve(process.cwd(), argv[1] ?? TEMPLATES_PATH);

  try {
    const rules = loadDocumentsRules(checksPath, templatesPath);
    const v1 = rules.checks.checks.filter((c) => c.release === 'v1').length;
    const examined = rules.checks.catalog.filter((c) => c.examined).length;

    console.log(checksPath);
    console.log(`  checks     ${rules.checks.checks.length} (${v1} in v1)`);
    console.log(`  catalog    ${rules.checks.catalog.length} types, ${examined} examined`);
    console.log(
      `  reasons    ${rules.checks.reasons.not_provided.length} not_provided, ${rules.checks.reasons.waived.length} waived`,
    );
    console.log(templatesPath);
    {
      const slots = rules.templates.template.slots;
      const of = (origin: string): number => slots.filter((s) => s.origin === origin).length;
      console.log(
        `  ${slots.length} slots — ${of('required')} required, ${of('conditional')} conditional, ${of('added')} offered`,
      );
    }
    console.log('\nValid.');
    return 0;
  } catch (error) {
    if (error instanceof DocumentsValidationError) {
      console.error(error.message);
      console.error(`\n${error.defects.length} defect(s). Nothing was loaded.`);
      return 1;
    }
    throw error;
  }
}

process.exit(main(process.argv.slice(2)));
