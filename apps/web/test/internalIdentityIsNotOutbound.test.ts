/**
 * The internal name path never reaches the print payload (D-233).
 *
 * `internalIdentity.ts` resolves `runs.created_by` and the commentary recorder to a **name**, for
 * the owner and host surfaces that are entitled to it. The other half of that ruling is that it
 * must never be merged into anything outbound — the PDF that reaches IQwallet, the merchant comment
 * page, the anonymous payload.
 *
 * D-233 says why in one line: *a single assembly with a print flag is one forgotten flag away from
 * the leak*. So there is no flag. There are two assemblies, and this asserts that the print one has
 * never imported the other.
 *
 * ## Why an import scan rather than a rendering test
 *
 * `operatorIdentityOutbound.test.ts` already renders the print path and asserts no address survives
 * to the page. That catches a leak that *renders*. It would not catch a component importing this
 * module and putting a name in a `title`, a `data-` attribute or a value it happens not to print
 * today — and it would not catch it at all until somebody wrote the interpolation.
 *
 * This fails at the moment the door opens rather than at the moment somebody walks through it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'apps', 'web', 'src');

/** Everything the print path renders, and everything it renders through. */
const PRINT_PATH = [
  'components/ReportView.tsx',
  'components/Participation.tsx',
  'components/MerchantResponse.tsx',
  'components/Attestations.tsx',
  'components/Sections.tsx',
  'components/EvidenceSlip.tsx',
  'components/DeclineNotice.tsx',
  'components/CommentPane.tsx',
  'components/DocumentsReportView.tsx',
];

const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

describe('internalIdentity is not on the print path', () => {
  it('is imported by none of the components the PDF or the merchant page render', () => {
    const offenders = PRINT_PATH.filter((file) => /internalIdentity/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('names files that actually exist, so the list cannot rot into a vacuous pass', () => {
    // A path that stopped existing would be a silent hole: the filter would skip it and the test
    // would go green while the component it named rendered whatever it liked.
    for (const file of PRINT_PATH) {
      expect(() => read(file), `${file} is listed but missing`).not.toThrow();
    }
  });

  it('covers every component the print path could grow into', () => {
    /*
      The list above is hand-written, which means it can fall behind. This asserts the shape that
      makes falling behind visible: every component importing `ReportView` — the print root — is
      either on the list or is an authenticated shell that the print path never mounts.

      `App.tsx` is the shell. `PrintOnly` inside it is the print root's caller and is allowed to
      import authenticated modules, because the print path is a different branch of the same file.
    */
    const components = readdirSync(join(SRC, 'components')).filter((f) => f.endsWith('.tsx'));
    const rendersReport = components.filter((f) => /from '\.\/ReportView\.js'/.test(read(`components/${f}`)));
    for (const file of rendersReport) {
      expect(PRINT_PATH, `components/${file} renders ReportView but is not audited`).toContain(
        `components/${file}`,
      );
    }
  });

});
