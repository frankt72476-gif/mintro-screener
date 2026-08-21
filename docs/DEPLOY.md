# Deploying

Three services.

    Supabase    —              Postgres, auth, evidence storage
    Netlify     apps/web       React frontend, static build
    Fly.io      apps/worker    Playwright crawler, long-running container

Do them in that order: both others depend on Supabase.

This is a runbook, not a design document. Everything below is a step someone performs, and the
steps only Frank can perform are marked **[Frank]**. Where a value has to be copied from one
service to another, it says exactly which one.

---

## 0. What you need before starting

| | |
|---|---|
| A GitHub repo | private, holding this code |
| A Supabase project | already exists |
| A Netlify account | free tier is enough |
| A Fly.io account | needs a payment card on file even on the free allowance |

The whole deployment costs roughly $2–5/month at demo volume: one Fly machine at 1GB, and
Supabase and Netlify free tiers.

---

## 1. Supabase — **[Frank]**

### 1.1 Apply the migrations

In the Supabase dashboard: **SQL Editor → New query**. Paste the contents of each file in
`supabase/migrations/` **in filename order** and run them one at a time. They are numbered for
that reason.

If a migration has already been applied, running it again will error on the object it creates.
That is fine and means you can stop — you are up to date.

The ones added since the last deploy:

    0011_evidence_key_is_artifact_key.sql
    0012_scan_requests.sql
    0013_credential_deposits.sql
    0014_pdf_requests.sql

`0012` creates the scan queue and the quarantine record. **Nothing in the UI works without it** —
the worker exits at startup saying so, and the run list cannot mark the five bad runs.

`0013` adds merchant-supplied screening logins. Without it, public crawls work normally and there
is nowhere to store a merchant's account.

`0014` adds the PDF queue and pins every scan to start anonymous. **Download PDF does nothing
without it.**

### 1.2 Confirm it took

    npm run inspect-supabase

Then:

    npm run verify-supabase

Expect every check to pass, with 5 quarantined runs listed below the verdict and excluded from it.

### 1.3 Turn off email confirmation

**Authentication → Sign In / Providers → Email**, and turn **Confirm email** *off*.

With it on, a user created with a password cannot sign in until they click a link in an email —
which defeats the point of having a password, and fails in exactly the situation passwords were
added for: presenting from a machine that is not signed in to that mailbox.

Safe here because there is **no signup form**. Nobody can create an account; accounts are created
by hand in the dashboard, and being in `auth.users` still grants nothing on its own.

### 1.4 Create the analysts

Sign-in is invite-only. Two steps, and **both are required** — being in `auth.users` is not
enough, because every policy gates on a row in `public.analysts`.

1. **Authentication → Users → Add user → Create new user.** Enter the email and a password, and
   tick **Auto Confirm User**. That is the path that sets a password directly — "Send invitation"
   emails a magic link and sets no password at all.
2. **SQL Editor**, with the user id from that page:

```sql
insert into public.analysts (id, email, full_name)
values ('<the-user-id-from-step-1>', 'analyst@example.com', 'Their Name');
```

A person who completes step 1 but not step 2 can sign in and sees **nothing** — no runs, no
merchants, not even a count. That is deliberate (`is_analyst()` gates every policy), but it looks
like a broken app, so do both together.

### 1.5 Point auth at the deployed frontend

**This breaks magic-link sign-in if it is missed. Password sign-in is unaffected**, which is the
main reason passwords are the default. A magic link sends the user to whatever Supabase has
recorded, so a link generated for `localhost` is useless on a machine in a demo.

**Authentication → URL Configuration**:

- **Site URL**: the Netlify URL from step 2 — `https://<your-site>.netlify.app`
- **Redirect URLs**: add all of these, one per line:

      https://<your-site>.netlify.app/**
      https://deploy-preview-*--<your-site>.netlify.app/**
      http://localhost:5173/**

The middle one keeps pull-request previews working; the last keeps local development working.
Come back and do this after step 2, when the Netlify URL exists. Magic link is kept as a
secondary route, so this still matters — but nothing in a demo depends on it.

### 1.6 Copy three values

**Project Settings → API**. You need:

| Value | Goes to |
|---|---|
| Project URL | Netlify as `VITE_SUPABASE_URL`, Fly as `SUPABASE_URL` |
| `anon` / public key | Netlify as `VITE_SUPABASE_ANON_KEY` |
| `service_role` key | Fly as `SUPABASE_SERVICE_KEY`, **nowhere else** |

The service key bypasses row-level security entirely. It never goes to Netlify, never into a
`VITE_` variable, and never into this repository (hard constraint 6). If you ever paste it into
the frontend, rotate it.

Note the project's **region** while you are here — you need it for Fly in step 3.

---

## 2. Netlify — frontend — **[Frank]**

1. **Add new site → Import an existing project → GitHub →** this repo.
2. Build settings come from `netlify.toml`. Do not override them.
3. **Site configuration → Environment variables → Add a variable**:

       VITE_SUPABASE_URL             https://<project>.supabase.co
       VITE_SUPABASE_ANON_KEY        <the anon key>
       VITE_CREDENTIAL_PUBLIC_KEY    <the public half from step 3.4a — M9 only>

4. **Deploys → Trigger deploy → Clear cache and deploy site.** Environment variables are read at
   build time, so a site deployed before you added them stays broken until it rebuilds.
5. Copy the site URL and go back and finish **step 1.5**.

Anything prefixed `VITE_` is compiled into the browser bundle and is public. The build fails
loudly if the frontend is misconfigured rather than rendering an empty app: the sign-in screen
names the missing variable.

Push to `main` deploys. Pull requests get preview URLs.

### Running the frontend locally

**Vite reads `apps/web/.env`, not the repository root.** The root `.env` belongs to the worker
scripts; a variable set only there gives a frontend that builds cleanly and then says
"Not connected".

    cp apps/web/.env.example apps/web/.env      # then fill it in

**Only `VITE_`-prefixed values belong in that file.** Vite silently ignores anything else, which is
the worse failure mode — it looks like it worked. And everything `VITE_`-prefixed is compiled into
the bundle and is public: never the service key, never the credential private key (constraint 6).

`.gitignore` covers `.env` at any depth, so `apps/web/.env` is not committed. Confirm with:

    git check-ignore -v apps/web/.env
    # .gitignore:3:.env    apps/web/.env

### If sign-in does nothing

**With a password**, "That email and password did not match an account" — when you are certain
they do — is almost always one of two things: **Confirm email** is still on (step 1.3), or the user
was created with "Send invitation" rather than "Create new user", so no password was ever set.

**Signed in, but the app says "No access for this account"**: authentication worked and membership
did not. The second half of step 1.4 was skipped — add the `public.analysts` row.

**With a magic link**, nine times in ten it is step 1.5. Open the emailed link and look at where it
points; if the host is `localhost`, the Site URL is still unset.

---

## 3. Fly.io — worker — **[Frank]**

You have not used Fly before, so this is every command, in order, from the **repository root**.

### 3.1 Install the CLI and sign in

    # Windows, in PowerShell:
    pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"

    # macOS / Linux:
    curl -L https://fly.io/install.sh | sh

Then restart the terminal and:

    fly auth signup     # or: fly auth login

Add a card at <https://fly.io/dashboard> → **Billing**. Fly requires one even inside the free
allowance, and a deploy fails with a billing error rather than an obvious one if it is missing.

### 3.2 Create the app

    fly apps create mintro-screener-worker

The name must match `app` in `apps/worker/fly.toml`. If that name is taken, change it in **both**
places.

**Do not run `fly launch`.** It is the "set up a new project" command and it will overwrite
`fly.toml` with its own guesses — including a public HTTP service this worker must not have.

### 3.3 Set the region to match Supabase

Open `apps/worker/fly.toml` and set `primary_region` to the Fly region closest to the Supabase
region you noted in step 1.5:

    Supabase region            Fly region
    ─────────────────────────  ──────────
    us-east-1  (N. Virginia)   iad
    us-west-1  (N. California) sjc
    eu-west-1  (Ireland)       lhr
    eu-central-1 (Frankfurt)   fra
    ap-southeast-1 (Singapore) sin

Every scan uploads 17 objects. Getting this wrong does not break anything; it makes each scan
noticeably slower.

### 3.4a Generate the credential key pair — M9 only

Skip this if you are not using merchant-supplied logins yet. Everything else works without it.

    npm run make-credential-key

It prints three blocks: a value for Netlify, a ready-to-paste `fly secrets set` command, and lines
for `apps/web/.env`. Copy them out now — **the pair is printed once and stored nowhere.**

Losing the private half makes every stored credential permanently unreadable. That is deliberate
(D-038): a recovery path would be a second route to plaintext, which is exactly what the two-key
design is paying to avoid. Re-asking a merchant costs an email.

### 3.4 Set the secrets

    fly secrets set \
      SUPABASE_URL=https://<project>.supabase.co \
      SUPABASE_SERVICE_KEY=<the service_role key> \
      --app mintro-screener-worker

`fly secrets set` stores them encrypted and injects them as environment variables at runtime.
They are never written to `fly.toml`, which is committed.

For M9, also set the private half from step 3.4a. The generator prints the whole command with the
key already in it, so paste that rather than retyping:

    fly secrets set CREDENTIAL_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..." --app mintro-screener-worker

The worker starts fine without it and screens public storefronts normally. A request that *asks*
for a screening account then fails loudly rather than quietly running as a public crawl — a
signed-in scan that silently became anonymous would report gated pages as unobservable and
attribute that to the merchant's configuration.

To check what is set — this shows names and digests, never values:

    fly secrets list --app mintro-screener-worker

### 3.5 Deploy

    fly deploy --config apps/worker/fly.toml

From the repository root, because the worker compiles the shared packages in `packages/` — the
build context is the directory you run this from. The build itself runs on Fly's builders, so you
do not need Docker installed.

**Do not pass `--dockerfile`.** `fly.toml` names it as `Dockerfile`, which Fly resolves relative
to the config file's own directory. Passing `apps/worker/Dockerfile` on top of that makes Fly look
for `apps/worker/apps/worker/Dockerfile`. See *Paths in config files* below.

First build takes 5–8 minutes — it pulls the Playwright image, which is large, and builds the
frontend. Watch for the toolchain line early on:

    ok    typescript 5.9.3 (lockfile 5.9.3)
    ok    tsc --version -> Version 5.9.3
    ok    vite 5.4.21
    toolchain ok

That step exists because the build once reached for a compiler, was handed an unrelated package
called `tsc` from the registry, and could not tell. The frontend is in the image because the PDF is `page.pdf()` against the report route:
the same React component an analyst sees, so the export cannot drift from the report (D-040).

### 3.6 Confirm it is running

    fly logs --app mintro-screener-worker

You want, within a few seconds of boot:

    mintro worker · rule set 2.4.0 (effective 2026-05-26)
      ok    bucket 'evidence' exists and is private          private
      ok    findings (run_id, ordinal) is a total unique index inferable
    polling for scan requests

If preflight fails the worker **exits rather than starting**. A worker that boots against a
configuration it cannot write to and then fails every job individually is much harder to diagnose.

    fly status --app mintro-screener-worker      # one machine, started
    fly machine restart <id> --app mintro-screener-worker

### 3.7 Things that will each cost you an afternoon

- **Do not enable auto-stop.** There is no `[http_service]` block, so Fly keeps the machine
  running. If you add one, machines sleep, and a sleeping worker silently stops picking up scans.
- **Memory is 1GB and that is a floor, not a target.** Chromium crashes under load are almost
  always OOM. `fly logs` shows `Out of memory` when it happens; raise `memory` in `fly.toml`.
- **Never write evidence to the container.** Fly machines are ephemeral and anything written
  locally disappears on redeploy. The worker is given no evidence directory, so there is nothing
  to get wrong — keep it that way (hard constraint 5).
- **Redeploying mid-scan is safe.** Fly sends `SIGTERM`; the worker finishes the request it is on
  and exits. A scan interrupted harder than that leaves its run open and resumable, never frozen
  (D-033).

---

## 4. End-to-end check

1. Open the Netlify URL. Sign in with an invited analyst email; follow the emailed link.
2. Type a storefront URL — `https://swisschems.is` — and press **Run scan**.
3. The request appears as `queued`, then `running` with the worker's progress line, then `done`.
   A full scan takes 40–90 seconds: it renders the homepage and samples five product pages,
   honouring the site's `Crawl-delay`.
4. The report appears in the **Reports** list. Open it. Screenshots load through signed URLs.
5. Press **Download PDF**. The button says "Rendering…" while the worker prints it, then the file
   downloads. A render takes 10–30 seconds. Nothing reports as downloaded until the file exists.
6. Press **Site check** in the rail — it returns to the input pane.
7. Open one of the five older runs marked **EVIDENCE INCOMPLETE**. The report opens with a notice
   at the top saying some captures cannot be retrieved, and why.

**Send to IQwallet is disabled and says so.** That is correct: nothing reaches a mailer yet, and a
button that appeared to succeed would be reporting a send that did not happen.

**There is no access-mode picker.** Every scan starts signed out; if product pages turn out to be
behind a login and a merchant account is stored, the scan uses it for those pages and the report
says so at the top (D-040).

If the request sits at `queued` forever, the worker is not running: `fly logs`.

---

## 5. Resend — not in this milestone

Domain verification first — SPF and DKIM on the sending domain. Until `RESEND_API_KEY` is set the
dry-run mailer is selected, which composes a message and transmits nothing. That is a separate
implementation rather than a flag, so a test send cannot be mistaken for a delivered report.

Log every send: run id, recipient, Resend message id, timestamp, who triggered it. The `sends`
table models this. Sending is never blocked by a report outcome (D-001), which makes the send log
the only record of what went out and when.

---

## Paths in config files

Two deploys were lost to the same mistake, so it is written down.

**Every tool resolves paths relative to a base it already knows.** A path written from the
repository root gets that base applied again:

| File | Resolves relative to | Correct | What broke |
|---|---|---|---|
| `netlify.toml` `publish` | `base` (`apps/web`) | `dist` | `apps/web/dist` → `apps/web/apps/web/dist` |
| `fly.toml` `[build] dockerfile` | the config file's own directory | `Dockerfile` | `apps/worker/Dockerfile` → `apps/worker/apps/worker/Dockerfile` |
| `fly deploy` build context | the directory you run it in | run from the repo root | — |
| `vite.config.ts` `build.outDir` | `apps/web` | `dist` | — |
| `vitest.config.ts` `include` | the repo root | `apps/*/test/**` | — |

The tell is a doubled segment in the error path. If a tool cannot find something at
`apps/web/apps/web/…`, the path in the config is written from the wrong place — and the fix is
always to shorten it, never to add another prefix.

Application paths are the other way round: the worker runs with its working directory at the
repository root, so `rules/ruleset.json` and `apps/web/dist` are correct as written in the code.

---

## Environment variables, in one place

| Variable | Netlify | Fly | `apps/web/.env` | root `.env` |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | — | ✅ | — |
| `VITE_SUPABASE_ANON_KEY` | ✅ | — | ✅ | — |
| `VITE_CREDENTIAL_PUBLIC_KEY` | ✅ | — | ✅ | — |
| `SUPABASE_URL` | — | ✅ | **never** | ✅ |
| `SUPABASE_SERVICE_KEY` | **never** | ✅ | **never** | ✅ |
| `CREDENTIAL_PRIVATE_KEY` | **never** | ✅ | **never** | ✅ |
| `SUPABASE_EVIDENCE_BUCKET` | — | optional | — | optional |
| `RESEND_API_KEY` | — | later | **never** | optional |

Two `.env` files, and they are not interchangeable. **`apps/web/.env` is Vite's** and may hold
only `VITE_`-prefixed values, all of which are public. **The root `.env`** is the worker's and
holds the secrets. `.env.example` in each place is the contract.

Nothing prefixed `VITE_` may ever carry a secret. A public key is not a secret — it is what makes
a secret unreadable to everyone holding it.
