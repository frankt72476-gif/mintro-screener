# The official Playwright image ships Chromium and its system libraries already installed.
# Building browser dependencies onto a bare Node image is a long detour — see docs/DEPLOY.md.
# Keep this tag in step with the `playwright` version in package.json; a mismatch between the
# bundled browser and the client is a class of failure that only shows up at runtime.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV NODE_ENV=production
WORKDIR /app

# Dependency manifests first, so a source change does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY packages/ruleset/package.json  packages/ruleset/
COPY packages/engine/package.json   packages/engine/
COPY apps/worker/package.json       apps/worker/

RUN npm ci --omit=dev --ignore-scripts

# The rule set is data the worker reads at startup, not something compiled in. It is copied
# rather than bundled so `runs.ruleset_version` reflects a file that can be diffed.
COPY rules/           rules/
COPY tsconfig.base.json tsconfig.json ./
COPY packages/        packages/
COPY apps/worker/     apps/worker/

RUN npm install --no-save typescript@^5.6.3 && npx tsc --build && npm prune --omit=dev

# Chromium in a container needs a writable home for its profile and crash dumps.
ENV HOME=/tmp

# Evidence goes straight to Supabase storage, never to the container filesystem: Fly machines
# are ephemeral and anything written locally disappears on redeploy (docs/DEPLOY.md).
CMD ["node", "apps/worker/dist/bin/render-check.js"]
