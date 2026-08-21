# Deploying

Three services. None is deployable until M3 — this document exists so the shape is settled
before anyone writes deployment code.

    Netlify     apps/web       React frontend, static build
    Fly.io      apps/worker    Playwright crawler, long-running container
    Supabase    —              Postgres, auth, evidence storage

There is no demo deployment. See D-004.

---

## Repository

One private repo. Private is not optional — it holds the rule set, the check logic, and
eventually references to merchant credentials.

    cd mintro-screener
    git init
    git add .
    git commit -m "Project brief, rule set, design spec"
    git remote add origin https://github.com/YOUR-ORG/mintro-screener.git
    git branch -M main
    git push -u origin main

---

## Supabase

Set this up first — both other services depend on it.

1. New project. Pick the region closest to Fly's chosen region.
2. Run the migrations from `apps/worker/migrations/` once they exist. Tables are listed in
   `docs/ARCHITECTURE.md`.
3. Create a **private** storage bucket named `evidence`. Screenshots and DOM snapshots are
   not public objects — serve them through signed URLs with short expiry.
4. Enable row-level security on every table before inserting a single row. Turning it on
   later, after data exists, is where people get caught.
5. Copy the project URL, the anon key, and the service key. The service key never leaves
   the worker.

---

## Netlify — frontend

1. Add new site -> Import an existing project -> GitHub -> this repo
2. Settings come from `netlify.toml`: base `apps/web`, build `npm run build`, publish
   `apps/web/dist`
3. Environment variables (Site configuration -> Environment variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

Anything prefixed `VITE_` is compiled into the browser bundle and is public. The Supabase
service key, the Resend key, and any merchant credential must never appear here. If you
find yourself wanting one in the frontend, the logic belongs in the worker.

Push to `main` deploys. Pull requests get preview URLs, which is the sane way to review
report-layout changes.

---

## Fly.io — worker

    cd apps/worker
    fly launch --no-deploy        # generates fly.toml, same region as Supabase
    fly secrets set \
      SUPABASE_URL=... \
      SUPABASE_SERVICE_KEY=... \
      RESEND_API_KEY=...
    fly deploy

Notes that will each save a day:

- **Base image.** Use `mcr.microsoft.com/playwright:v1.x-jammy`. It ships Chromium and its
  system libraries. Installing browser dependencies onto a bare Node image is a long detour.
- **Memory.** Chromium wants more than the default. Start at 1GB in `fly.toml` and watch it;
  crashes under load are usually OOM, not code.
- **Do not scale to zero.** The worker polls the job queue. A machine that sleeps stops
  picking up runs.
- **Concurrency.** One browser context per run, and cap concurrent runs per machine.
- **Evidence writes go straight to Supabase storage**, never to the container filesystem.
  Fly machines are ephemeral; anything written locally disappears on redeploy.

---

## Resend

Domain verification first — SPF and DKIM records on the sending domain. Reports go to
IQwallet and must not land in spam. Send from a real subdomain such as `reports@mintro.com`,
not a shared or generic address.

Log every send: run id, recipient, Resend message id, timestamp, who triggered it. The
`sends` table models this. Sending is never blocked by a report outcome (D-001), which makes
the send log the only record of what went out and when.
