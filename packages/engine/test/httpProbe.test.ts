/**
 * GATE-002 and the `http_probe` handler.
 *
 * This is the rule authenticated crawling exists to make answerable, and it is `critical` /
 * `auto_fail`. Two things decide whether it is right, and both were wrong in the first draft:
 * whether a redirect away from a path counts as the path being served, and whether the finding
 * records the session that produced it.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import { checkHttpProbe, NO_SESSION, type ProbeResult, type SessionDescriptor } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

const gate002 = (() => {
  const rule = ruleset.rules.find((candidate) => candidate.id === 'GATE-002');
  if (rule === undefined || rule.type !== 'http_probe') throw new Error('GATE-002 is not an http_probe');
  return rule as RuleOfType<'http_probe'>;
})();

const AUTHENTICATED: SessionDescriptor = {
  mode: 'screening_account',
  origin: 'scripted_login',
  vaultRef: 'merchants/example',
  platform: 'shopify',
};

const probe = (path: string, status: number, finalPath = path): ProbeResult => ({
  url: `https://shop.example${path}`,
  status,
  finalUrl: `https://shop.example${finalPath}`,
  fetchedAt: '2026-08-21T00:00:00.000Z',
});

describe('GATE-002 shape', () => {
  it('is a critical auto_fail rule that pins itself to an unauthenticated probe', () => {
    expect(gate002.sev).toBe('critical');
    expect(gate002.tier).toBe('auto_fail');
    expect(gate002.params.unauthenticated).toBe(true);
  });
});

describe('checkHttpProbe', () => {
  it('fails when a probed path serves the catalogue directly', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200)],
      session: NO_SESSION,
    });

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('/collections/all');
  });

  /**
   * The defect this test exists for.
   *
   * A merchant who gates their catalogue answers an anonymous request with a redirect to the
   * login form. The browser follows it and the login page returns 200 — so before redirects were
   * accounted for, the compliant behaviour and its absence were indistinguishable, and the
   * testbed (which gates correctly) was auto-failed for doing the right thing.
   */
  it('does not fail a path that redirected away rather than serving content', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200, '/account/login')],
      session: NO_SESSION,
    });

    expect(finding.state).toBe('pass');
    expect(finding.state).not.toBe('fail');
  });

  it('states the redirect, because it is the observation that the gate works', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200, '/account/login')],
      session: NO_SESSION,
    });

    expect(finding.note).toContain('redirected away');
    expect(finding.note).toContain('/account/login');
  });

  it('treats a trailing slash as the same path, not a redirect', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200, '/collections/all/')],
      session: NO_SESSION,
    });
    expect(finding.state).toBe('fail');
  });

  it('still fails when one path is gated and another is not', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200, '/account/login'), probe('/shop', 200)],
      session: NO_SESSION,
    });

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('/shop');
    expect(finding.note).toContain('redirected away');
  });
});

describe('session is recorded on every finding', () => {
  it.each([
    ['unauthenticated', NO_SESSION, 'no session'],
    ['screening account', AUTHENTICATED, 'stored screening account'],
  ])('names the %s session in the note', (_label, session, expected) => {
    // ARCHITECTURE.md § Handler requirements: the same status means opposite things depending
    // on the session, so a finding that does not say which is not evidence of anything.
    const finding = checkHttpProbe(gate002, { results: [probe('/collections/all', 200)], session });
    expect(finding.note).toContain(expected);
  });

  it('carries the session descriptor in the evidence', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200)],
      session: AUTHENTICATED,
    });

    expect(finding.evidence[0]?.session?.mode).toBe('screening_account');
    expect(finding.evidence[0]?.session?.origin).toBe('scripted_login');
  });

  it('carries a vault reference and never a credential', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 200)],
      session: AUTHENTICATED,
    });

    const serialised = JSON.stringify(finding);
    expect(serialised).toContain('merchants/example');
    expect(serialised.toLowerCase()).not.toContain('password');
  });
});

describe('a probe that observed nothing', () => {
  it('is not_evaluable when every path was unreachable', () => {
    const finding = checkHttpProbe(gate002, {
      results: [{ ...probe('/collections/all', 0), error: 'timed out' }],
      session: NO_SESSION,
    });

    expect(finding.state).toBe('not_evaluable');
    expect(finding.state).not.toBe('pass');
  });

  it('is not_evaluable when no path was probed at all', () => {
    expect(checkHttpProbe(gate002, { results: [], session: NO_SESSION }).state).toBe('not_evaluable');
  });

  it('reports what it could reach when only some paths failed', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 404), { ...probe('/shop', 0), error: 'timed out' }],
      session: NO_SESSION,
    });

    // D-018: a clean result names what it could not reach rather than implying full coverage.
    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('could not be reached');
  });

  it('records every attempt, including the failures', () => {
    const finding = checkHttpProbe(gate002, {
      results: [probe('/collections/all', 404), { ...probe('/shop', 0), error: 'timed out' }],
      session: NO_SESSION,
    });

    expect(finding.evidence[0]?.attempts).toHaveLength(2);
    expect(finding.evidence[0]?.attempts?.some((a) => a.error === 'timed out')).toBe(true);
  });
});
