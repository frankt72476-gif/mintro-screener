# The official Playwright image ships Chromium and its system libraries already installed.
# Building browser dependencies onto a bare Node image is a long detour — see docs/DEPLOY.md.
#
# Keep this tag in step with the `playwright` version in package-lock.json. A mismatch between the
# bundled browser and the client is a class of failure that only shows up at runtime, and the
# lockfile is what `npm ci` actually installs:
#
#     node -e "console.log(require('./package-lock.json').packages['node_modules/playwright'].version)"
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Dependency manifests first, so a source change does not invalidate the install layer.
#
# Every workspace manifest, including apps/web, because the root package.json declares
# `workspaces: ["packages/*", "apps/*"]` and `npm ci` refuses to run against a lockfile whose
# workspaces it cannot find.
COPY package.json package-lock.json ./
COPY packages/ruleset/package.json  packages/ruleset/
COPY packages/engine/package.json   packages/engine/
COPY apps/worker/package.json       apps/worker/
COPY apps/web/package.json          apps/web/

# `--include=dev` is explicit and load-bearing.
#
# TypeScript and Vite are devDependencies and the build needs both. An earlier version of this file
# set `ENV NODE_ENV=production` above this line and relied on `npm prune --omit=dev` at the end to
# drop them again — but **npm reads NODE_ENV**, and with it set to `production` npm defaults `omit`
# to `dev`:
#
#     $ NODE_ENV=production npm config get omit
#     dev
#
# So the install quietly skipped them, `npx tsc` found no local compiler, and npx fetched an
# unrelated package called `tsc` from the registry — which prints "This is not the tsc command you
# are looking for" and exits 1. The comment that used to sit here asserted dev dependencies were
# installed and pruned. Nothing checked. The build failed several layers later with a riddle.
#
# NODE_ENV is now set *after* the build, and the install states what it wants rather than
# inheriting it from a variable set for an unrelated reason.
#
# `--ignore-scripts` skips Playwright's browser download. The image already has them, at
# PLAYWRIGHT_BROWSERS_PATH; downloading a second copy would add ~400MB for nothing.
RUN npm ci --ignore-scripts --include=dev

# The rule set is data the worker reads at startup, not something compiled in. It is copied
# rather than bundled so `runs.ruleset_version` reflects a file that can be diffed.
COPY rules/           rules/
COPY tsconfig.base.json tsconfig.json ./
COPY packages/        packages/
COPY apps/worker/     apps/worker/
COPY scripts/         scripts/

# The frontend's source, because the worker prints it. Its brand assets live in
# `apps/web/public/` and Vite copies them into `dist`, so the print header's lockup comes along
# without a second copy of the repository's `brand/` directory.
#
# The PDF is `page.pdf()` against the report route — the same React component an analyst sees.
# ARCHITECTURE.md rules out a second rendering stack precisely so the export and the on-screen
# report cannot say different things, and the price of that is a React build inside the crawl
# container. It is a price, and it is the right one: the alternative is a second template that
# drifts, and the thing that would drift is a compliance document.
COPY apps/web/        apps/web/

# Assert the toolchain, then build through `npm run` — never `npx`.
#
# `npm run` puts `node_modules/.bin` on PATH and fails if the binary is not there. `npx` instead
# "helpfully" installs something from the registry with a matching name, which is how a build step
# ends up holding a stranger and not knowing.
#
# The assertion is what makes the install layer verifiable. Without it this build fails at the
# compile step with an unrelated package's error message, rather than at the install step with the
# actual problem.
RUN npm run assert-toolchain && npm run build:worker && npm run --workspace @mintro/web build

# Dev dependencies go now, after everything that needed them.
RUN npm prune --omit=dev

# Chromium in a container needs a writable home for its profile and crash dumps.
ENV HOME=/tmp

# Set here rather than at the top: above the install it silently strips the dev dependencies the
# build requires. At runtime it is what we want.
ENV NODE_ENV=production

# Evidence goes straight to Supabase storage, never to the container filesystem: Fly machines are
# ephemeral and anything written locally disappears on redeploy (docs/DEPLOY.md, hard constraint
# 5). The worker is given no evidence directory and no report directory, so there is nothing to
# get this wrong with.
#
# The queue worker: polls scan_requests and pdf_requests, screens, renders, writes to Supabase.
# Same crawl path and same write path as `npm run scan-full` — there is exactly one of each
# (D-035) — and the same report component the analyst sees.
CMD ["node", "apps/worker/dist/bin/worker.js"]
