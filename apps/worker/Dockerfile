# The official Playwright image ships Chromium and its system libraries already installed.
# Building browser dependencies onto a bare Node image is a long detour — see docs/DEPLOY.md.
#
# Keep this tag in step with the `playwright` version in package-lock.json. A mismatch between the
# bundled browser and the client is a class of failure that only shows up at runtime, and the
# lockfile is what `npm ci` actually installs:
#
#     node -e "console.log(require('./package-lock.json').packages['node_modules/playwright'].version)"
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV NODE_ENV=production
WORKDIR /app

# Dependency manifests first, so a source change does not invalidate the install layer.
#
# Every workspace manifest, including apps/web, because the root package.json declares
# `workspaces: ["packages/*", "apps/*"]` and `npm ci` refuses to run against a lockfile whose
# workspaces it cannot find. The frontend is not built here; only its manifest is needed.
COPY package.json package-lock.json ./
COPY packages/ruleset/package.json  packages/ruleset/
COPY packages/engine/package.json   packages/engine/
COPY apps/worker/package.json       apps/worker/
COPY apps/web/package.json          apps/web/

# Dev dependencies are installed and then pruned, rather than skipped. The build needs TypeScript
# (a root devDependency) and the worker's own tsconfig covers its tests, which import PGlite. The
# alternative — a second tsconfig that excludes tests — is a second build definition that can
# drift from the one `npm run check` uses, and this project has paid for that mistake already.
#
# `--ignore-scripts` skips Playwright's browser download. The image already has them, at
# PLAYWRIGHT_BROWSERS_PATH; downloading a second copy would add ~400MB for nothing.
RUN npm ci --ignore-scripts

# The rule set is data the worker reads at startup, not something compiled in. It is copied
# rather than bundled so `runs.ruleset_version` reflects a file that can be diffed.
COPY rules/           rules/
COPY tsconfig.base.json tsconfig.json ./
COPY packages/        packages/
COPY apps/worker/     apps/worker/

# The worker project only. Building from the root tsconfig would pull in apps/web, whose React
# toolchain has no business in a crawl container.
RUN npx tsc --build apps/worker/tsconfig.json && npm prune --omit=dev

# Chromium in a container needs a writable home for its profile and crash dumps.
ENV HOME=/tmp

# Evidence goes straight to Supabase storage, never to the container filesystem: Fly machines are
# ephemeral and anything written locally disappears on redeploy (docs/DEPLOY.md, hard constraint
# 5). The worker is given no evidence directory and no report directory, so there is nothing to
# get this wrong with.
#
# The queue worker: polls scan_requests, screens, writes to Supabase. Same crawl path and same
# write path as `npm run scan-full` — there is exactly one of each (D-035).
CMD ["node", "apps/worker/dist/bin/worker.js"]
