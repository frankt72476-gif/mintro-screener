/**
 * A Playwright error reaches progress as one line; the worker log keeps all of it (D-278).
 *
 * Two writers put sign-in text on the queue row: the worker's step loop and the escalate line
 * `screenStorefront` enters. Both are held here, against the shape `scriptedLogin` records when
 * Playwright throws.
 */

import { describe, expect, it } from 'vitest';
import { firstLine, recordSignInSteps } from '../src/auth/login.js';
import { escalationLine } from '../src/screen.js';

const HEADLINE =
  'scripted woocommerce login failed: login attempt failed: locator.fill: Timeout 30000ms exceeded.';

const ERROR =
  `${HEADLINE}\n` +
  'Call log:\n' +
  "  - waiting for locator('#username, input[name=\"username\"]').first()\n" +
  '    - locator resolved to <input id="username" name="username" type="text"/>';

describe('sign-in progress', () => {
  it('writes the first line of each step to progress and the whole step to the log', () => {
    const logged: string[] = [];
    const written: string[] = [];

    recordSignInSteps(['platform detected: woocommerce', ERROR], (line) => logged.push(line), (line) => written.push(line));

    expect(logged).toEqual(['platform detected: woocommerce', ERROR]);
    expect(written).toEqual(['platform detected: woocommerce', HEADLINE]);
    for (const line of written) expect(line).not.toMatch(/[\r\n]/);
  });

  it('enters the escalate line as one line', () => {
    const line = escalationLine({ kind: 'sign_in_failed', reason: ERROR });

    expect(line).toBe(`a login wall was met and the stored screening account did not sign in: ${HEADLINE}`);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toContain('Call log');
  });

  it('leaves a one-line reason as it is', () => {
    const reason = "scripted woocommerce login failed: login page blocked (HTTP 403, 'Attention Required! | Cloudflare')";

    expect(firstLine(reason)).toBe(reason);
    expect(firstLine('headline\r\ncall log')).toBe('headline');
  });
});
