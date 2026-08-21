import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Workspace packages resolve to source, matching the test setup. The rule set is imported as
 * JSON and validated at startup through `@mintro/ruleset` — there is no second parser
 * (hard constraint 1).
 */
const pkg = (name: string, entry = 'index'): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/${entry}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Browser entry: same validator, without the filesystem loader (see packages/ruleset/src/browser.ts).
      '@mintro/ruleset': pkg('ruleset', 'browser'),
      '@mintro/engine': pkg('engine'),
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
