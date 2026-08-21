import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Workspace packages resolve to their TypeScript source here, not to `dist`.
 *
 * At runtime Node needs compiled JavaScript, so each package's `main` points at `dist`. Tests
 * should exercise the source directly — otherwise a test run silently reports on the last
 * build rather than on the working tree.
 */
const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mintro/ruleset': src('ruleset'),
      '@mintro/engine': src('engine'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
