/**
 * Session resolution and the guarantees a session descriptor has to hold.
 *
 * The descriptor travels into findings, reports, PDFs and emails. What it can carry is therefore
 * a security property, not a convenience.
 */

import { describe, expect, it } from 'vitest';
import {
  canCompareAuthenticated,
  describeSession,
  NO_SESSION,
  resolveProbeSession,
  type SessionDescriptor,
} from '../src/index.js';

const SCREENING: SessionDescriptor = {
  mode: 'screening_account',
  origin: 'scripted_login',
  vaultRef: 'merchants/example',
  establishedAt: '2026-08-21T00:00:00.000Z',
  platform: 'shopify',
};

describe('resolveProbeSession', () => {
  it('forces an unauthenticated probe when the rule pins one', () => {
    // GATE-002 asks what an anonymous visitor can reach. Running it with a session would answer
    // a different question and report the answer under the same rule id.
    expect(resolveProbeSession(SCREENING, true)).toEqual(NO_SESSION);
  });

  it('inherits the run session when the rule says nothing', () => {
    // D-017: absence of `unauthenticated` means inherit, never assume unauthenticated.
    expect(resolveProbeSession(SCREENING, undefined)).toEqual(SCREENING);
  });

  it('inherits the run session when the rule explicitly says false', () => {
    expect(resolveProbeSession(SCREENING, false)).toEqual(SCREENING);
  });

  it('stays unauthenticated when the run never established a session', () => {
    expect(resolveProbeSession(NO_SESSION, undefined)).toEqual(NO_SESSION);
  });
});

describe('describeSession', () => {
  it.each([
    [NO_SESSION, 'anonymous visitor'],
    [SCREENING, 'signed in this run'],
    [{ ...SCREENING, origin: 'reused' as const }, 'reused from an earlier run'],
    [{ mode: 'assisted' as const, origin: 'assisted_handoff' as const }, 'handed over by a human'],
  ])('describes the session in words a report can print', (session, expected) => {
    expect(describeSession(session)).toContain(expected);
  });

  it('never produces an empty description', () => {
    // A finding whose session clause was blank would read as though the question had not arisen.
    for (const mode of ['unauthenticated', 'screening_account', 'assisted'] as const) {
      expect(describeSession({ mode, origin: 'none' }).length).toBeGreaterThan(10);
    }
  });
});

describe('the descriptor cannot carry a credential', () => {
  it('has no field a password could be put in', () => {
    // Enforced by the type, checked here so a future field addition has to confront it.
    const keys = Object.keys(SCREENING);
    expect(keys).toEqual(['mode', 'origin', 'vaultRef', 'establishedAt', 'platform']);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain('password');
      expect(key.toLowerCase()).not.toContain('secret');
      expect(key.toLowerCase()).not.toContain('token');
    }
  });

  it('carries a vault reference, which is not a secret', () => {
    expect(SCREENING.vaultRef).toBe('merchants/example');
  });
});

describe('canCompareAuthenticated', () => {
  it('is false for an unauthenticated run', () => {
    // GATE-002 and GATE-003 are a pair of observations. A run with only the anonymous half must
    // not present it as the whole answer.
    expect(canCompareAuthenticated(NO_SESSION)).toBe(false);
  });

  it('is true once any session was established', () => {
    expect(canCompareAuthenticated(SCREENING)).toBe(true);
    expect(canCompareAuthenticated({ mode: 'assisted', origin: 'assisted_handoff' })).toBe(true);
  });
});
