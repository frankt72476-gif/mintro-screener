/**
 * The Mintro Referral Policy, Adult AI, and the version runs stamp (D-287).
 *
 * A run stamps `referral_policy_version` from `VERTICAL_FILES`. The document states its own version
 * in its header. If the two drift, runs name a version nobody can read — so they are held equal here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERTICAL_FILES, referralPolicyVersion } from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const policy = VERTICAL_FILES.adult_ai.referralPolicy!;
const text = readFileSync(resolve(REPO_ROOT, policy.document), 'utf8').replace(/\r\n/g, '\n');

describe('docs/referral-policy-adult-ai.md', () => {
  it('states the version adult_ai runs stamp', () => {
    expect(policy.version).toBe('1.0');
    expect(text).toMatch(/^Version: 1\.0$/m);
    expect(referralPolicyVersion('adult_ai')).toBe('1.0');
  });

  it('says in its header what it is and what it is not', () => {
    expect(text.replace(/\s+/g, ' ')).toContain(
      'This is a Mintro marketing document applied at intake under Sponsor Agreement 1.1. It is not a ' +
        'standard, not a compliance criterion, and is never quoted to a merchant as one.',
    );
  });

  it('carries P-1 and P-2 as ratified, and categories 6, 8, 10, 11 as proposed only', () => {
    expect(text).toMatch(/^P-1\. /m);
    expect(text).toMatch(/^P-2\. /m);
    for (const n of ['6', '8', '10', '11']) {
      expect(text).toMatch(new RegExp(`^\\| ${n} \\|.*\\| proposed, not ratified \\|$`, 'm'));
    }
  });
});

describe('peptides', () => {
  it('has no referral policy, so its runs stamp none', () => {
    expect(VERTICAL_FILES.peptides.referralPolicy).toBeNull();
    expect(referralPolicyVersion('peptides')).toBeNull();
  });
});
