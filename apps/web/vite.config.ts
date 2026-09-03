import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { netlifyReportProxy } from './netlifyReportProxy.js';
import { fileURLToPath } from 'node:url';

/**
 * Workspace packages resolve to source, matching the test setup. The rule set is imported as
 * JSON and validated at startup through `@mintro/ruleset` — there is no second parser
 * (hard constraint 1).
 */
const pkg = (name: string, entry = 'index'): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/${entry}.ts`, import.meta.url));

export default defineConfig({
  /*
    `netlifyReportProxy` emits `_redirects` and `_headers` into the build.

    The `/r/*` fronting for captured reports is generated from `REPORT_LINK_PATH` rather than
    written into `netlify.toml`, so the path has one owner. The SPA fallback is emitted with it,
    because Netlify evaluates `netlify.toml` redirects before `_redirects` and a catch-all there
    would swallow `/r/*`.
  */
  plugins: [react(), netlifyReportProxy()],
  resolve: {
    alias: {
      // Browser entry: same validator, without the filesystem loader (see packages/ruleset/src/browser.ts).
      '@mintro/ruleset': pkg('ruleset', 'browser'),
      // Browser entry: report types plus the directive-language audit, without the crawl
      // machinery, which imports Node built-ins (see packages/engine/src/browser.ts).
      '@mintro/engine': pkg('engine', 'browser'),
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
