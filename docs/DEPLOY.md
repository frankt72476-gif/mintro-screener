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

There is now a faster route than the dashboard, once the CLI is linked:

    npx supabase link --project-ref <ref>
    npx supabase db query --linked --file supabase/migrations/00NN_name.sql

The ones added since the last deploy:

    0011_evidence_key_is_artifact_key.sql
    0012_scan_requests.sql
    0013_credential_deposits.sql
    0014_pdf_requests.sql
    0015_flow_probe_quarantine.sql
    0016_merchant_commentary.sql
    0017_send_requests.sql

`0012` creates the scan queue and the quarantine record. **Nothing in the UI works without it** —
the worker exits at startup saying so, and the run list cannot mark the five bad runs.

`0013` adds merchant-supplied screening logins. Without it, public crawls work normally and there
is nowhere to store a merchant's account.

`0014` adds the PDF queue and pins every scan to start anonymous. **Download PDF does nothing
without it.**

`0016` adds merchant commentary (D-063): the comment link, visits, comments, and the invitation
queue. Note that it **revokes `insert` on `comment_links` from `authenticated`** — Supabase grants
that by default, and a browser able to write a link row would have computed the token digest,
meaning the plaintext token existed in a browser. Invitations are issued worker-side or not at all.

`0017` wires the report send: the `send_requests` queue, and `sends.mailer` naming which mailer
handled each attempt. `mailer` is not-null with no default — existing rows read `unrecorded`, which
is the truth about them. **Send to IQwallet does nothing without it.**

### 1.1b Outstanding against production — as of 2026-08-28

**Production is at 0044. `0045` and `0046` have not been applied.** Checked read-only against
production's REST API on 2026-08-28, not assumed:

| Migration | Production | Verification (`wakpxbojiqgbjuxikqab`) |
|---|---|---|
| `0044_merchant_attestations.sql` | **applied** | applied 2026-08-28 |
| `0045_response_rounds.sql` | **not applied** | applied 2026-08-28 |
| `0046_merchant_domain_is_folded.sql` | **not applied** *(see below)* | applied 2026-08-28 |

`0046` is the one entry that could not be confirmed by probing. It adds a check constraint and
replaces a function, and PostgREST exposes neither — so its state is inferred from `0045` being
absent and from the two being written and applied as one batch. Confirm it directly before or after
applying, with `select pg_get_constraintdef(oid) from pg_constraint where conname =
'merchants_domain_is_folded'`.

**Do not stop at the first error.** §1.1 above says that a migration erroring on an object it
creates means you are up to date. That rule does not hold here: `0044` is already applied, so
running the batch from `0044` errors immediately on `create table public.merchant_attestations` —
and stopping there would leave `0045` and `0046` unapplied while looking like success. Start at
`0045`.

#### What is missing without them

`0045` is the response round (D-143 - D-151): `comment_submissions`, `response_nonresponses`,
`response_notices`, `invited_addresses()`, `submit_response_round()`, and the amended
`submit_merchant_comment()` and `open_report_for_comment()`.

Two things break, and neither degrades quietly:

- **The merchant page stops loading.** `0045` replaces `open_report_for_comment`; the `0016` version
  returns no `invited`, `submissions` or `attestations`, and `OpenReport` seeds state from
  `opened.submissions` and filters it during render. That is a `TypeError` on undefined, so the
  route is down rather than diminished.
- **The worker exits on its first poll cycle.** `claimNextNotice` throws when `response_notices` is
  missing, and the poll loop is wrapped in `try/finally` with no `catch` — so the throw leaves
  `main()`, the browser closes, and the process ends. The error names `0045`. Scans, PDFs, sends and
  invitations all stop with it.

**So deploy order matters.** The migration goes before the frontend and before the worker image, or
the merchant-facing route breaks for as long as the gap lasts.

`0046` folds `merchants.domain` and constrains it. Without it a Documents Check package created with
a capitalised domain silently creates a **second merchant row** for a storefront that already exists,
splitting its Site Check runs from its documents (D-150). Production's seven merchant rows are all
already lowercase, so nothing needs folding — the migration is preventive.

#### Applying them here needs the `pg` route

`psql.exe` and `supabase.exe` are both blocked on Frank's machine by an Application Control policy,
so neither `scripts/live/apply-migrations.mjs` nor `npx supabase db query --linked` can run. The
dashboard SQL Editor still works and needs nothing installed. See
`scripts/live/apply-migrations-pg.mjs`, which is guarded to the **test** project — applying to
production needs `assertProduction()` from `guard-production.mjs`, deliberately a different file.

---

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

- **Site URL**: the origin the app is actually served from. For this project that is
  `https://screener.gomintro.com`; on a fresh deployment it is the Netlify URL from step 2.
- **Redirect URLs**: add all of these, one per line:

      https://screener.gomintro.com/**
      https://mintro-screener.netlify.app/**
      https://deploy-preview-*--mintro-screener.netlify.app/**
      http://localhost:5173/**

The second is kept rather than replaced: the `.netlify.app` host still serves the app and still
works, and removing it would break an in-flight magic link and anybody's bookmark. The third keeps
pull-request previews working; the last keeps local development working.

**Only the Site URL affects sign-in today.** `signInWithOtp` is called without an `emailRedirectTo`,
so a magic link goes wherever the Site URL points — the allow-list is consulted only for an explicit
redirect, which nothing passes. Password sign-in involves no redirect at all and works from any
origin the app is served from.
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

    npm run make-credential-key -- --set

This generates the pair, sets `CREDENTIAL_PRIVATE_KEY` on the worker, writes the public half to
`credential-public-key.txt`, and prints it delimited for Netlify. **The private half is never
printed** — it goes from the generator to the secret store on stdin, so it never appears in a
command line or in shell history.

If the Netlify CLI is signed in *and* knows which site — a linked directory, or `NETLIFY_SITE_ID`
set — it sets `VITE_CREDENTIAL_PUBLIC_KEY` too and says so. Otherwise it says why it could not and
leaves that step to you. Either way, trigger a deploy afterwards: Netlify reads variables at build
time.

It refuses if `CREDENTIAL_PRIVATE_KEY` is already set. Overwriting it makes every credential already
stored permanently unopenable, with no recovery (D-038) — `--force` is the only way past, and it
says so in the output.

Without `--set` it prints both halves and sets nothing:

    npm run make-credential-key

Three blocks: a value for Netlify, a ready-to-paste `fly secrets set` command, and lines for
`apps/web/.env`. Copy them out now — **the pair is printed once and stored nowhere.**

The worker's boot line says which of three states it is in:

    ok    credentials    ready — key pair verified, public half derived from the private key
    --    credentials    not configured — merchant-supplied logins are unavailable, public crawls unaffected
    XX    credentials    REFUSED — public key set, private key missing

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

**Only the private half goes to Fly.** The worker derives the public half from it at boot (D-191):
an RSA private key already contains its own modulus and exponent, so a second secret would be a
second thing to keep in step with nothing checking that it was. `CREDENTIAL_PUBLIC_KEY` is accepted
here if set, and checked against the derived one — a mismatch refuses the boot rather than being
discovered when a merchant's login cannot be opened.

The worker starts fine without any of it and screens public storefronts normally. A request that
*asks* for a screening account then fails loudly rather than quietly running as a public crawl — a
signed-in scan that silently became anonymous would report gated pages as unobservable and
attribute that to the merchant's configuration.

**What it will not do is start half-configured.** A public key with no private half is refused at
boot: the browser would seal deposits that nothing can ever open, and they would accumulate in
`credential_deposits` looking like ordinary queue depth. There is no recovery for those (D-038).

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

## 5. Resend — live (D-064)

`gomintro.com` is verified (SPF + DKIM) and `RESEND_API_KEY` is set on Fly. Two sends go through it,
selected in one place (`mailersFor`), so the key turns both on together:

- the report to IQwallet, with the rendered PDF attached
- the merchant invitation (D-063)

Unset selects the dry-run mailer, which composes and transmits nothing — a separate implementation
rather than a flag, so a test send cannot be mistaken for a delivered report. **Which one ran is
written to `sends.mailer`**, so the distinction survives into the record.

Every send is logged: run id, recipient, Resend message id, timestamp, who triggered it, and the
mailer. Sending is never blocked by a report outcome (D-001) — the `send_requests` insert policy
carries no condition on findings or counts, and a schema test asserts it stays that way — which
makes the send log the only record of what went out and when.

### 5b. Response-round notifications (D-143)

A third message goes through the same `mailersFor()`, in three kinds: one per merchant submit event,
an "All invited responses are in" version when the last outstanding invited address resolves, and a
`resubmit` when a responder adds to a response they had already submitted (D-151). A re-submit never
composes the all-in version and never claims its fingerprint — it is by an address that resolved when
it first submitted, so the invited set has not moved. It goes to
**operators**, not to a merchant.

    RESPONSE_NOTICE_TO="drews@gomintro.com,frankt@gomintro.com,michaels@gomintro.com"

All three receive every notice, submit and all-in alike, **on one message rather than one each**.
Three separate sends are three things that can fail independently, and the record would then say two
of three were told with no way to say which. `response_notices.to_addresses` stores the set that was
actually on the message, so "who was told" is answerable later without reading a config value that
may since have changed.

Comma or whitespace separated. `addressesFor` validates every entry and the worker **refuses to
start** on a malformed one — the same discipline as the four sender addresses, and for the same
reason: a bad entry would otherwise surface one notice at a time, as a provider rejection on a queue
row nobody reads.

Unset is a working fallback rather than an outage: the notice goes to the analyst who issued the most
recent transmitted invitation for that run.

It is a queue like the other four. `response_notices` rows are written by a database trigger on every
submit event and every not-responding mark, so no writer can forget to enqueue one; the worker claims
them with the same compare-and-swap and records the outcome on the row.

**"Never twice for the same set" is a unique index, not a check in code.** The worker claims the
invited set's fingerprint *before* composing anything, so two responders submitting at the same moment
resolve the race before either message exists. A send that fails releases the claim and the stale-claim
reclaim retries it. A job that correctly sends nothing — a mark that did not complete the round, a set
already reported — finishes as `not_sent` with the reason on the row, never as a failure.

A dry run is recorded as `dry_run`: the operator was not told, and the run view reads that column
rather than assuming a finished row was delivered.

**Sends carry an `Idempotency-Key` (D-149).** Every queue here claims a row, does the work, then
records the outcome — and a worker that dies between the send and the record leaves the row `running`
for the stale-claim reclaim to run again. Resend returns the original response for a repeated key
without sending again, and keys are kept **24 hours**, comfortably past the 15-minute reclaim. The
key covers the job *and* a digest of the message, because Resend answers `409
invalid_idempotent_request` when one key arrives with two different bodies — so a message whose
content legitimately changed is a different key and does send.

This applies to the response notice and the merchant invitation. It does **not** yet apply to the
IQwallet report send, whose payload carries a freshly rendered PDF with unstable bytes; that window
is open and named in D-149.

### Secrets and settings this needs on Fly

    fly secrets set       WEB_ORIGIN="https://screener.gomintro.com"       MAIL_REPLY_TO="no-reply@gomintro.com"       INVITE_REPLY_TO="no-reply@gomintro.com"       --app mintro-screener-worker

`WEB_ORIGIN` has **no default**. Everything else here does, because a wrong guess costs a retry; a
wrong guess in `WEB_ORIGIN` puts a dead link in a merchant's inbox under Mintro's name, carrying the
only token that report will ever have. An invitation job with it unset fails and says so.

There is no contact to configure. Both messages point the reader at their existing Mintro contact
rather than printing a name and address (D-065) — an address inside a message someone is suspicious
of verifies nothing, and it would publish a personal address in a document built to be forwarded.
The line lives in `apps/worker/src/contactLine.ts` and the copy audit fails the build without it.

The worker prints all of this at startup, so `fly logs` after a deploy shows what it will actually
send as.

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
| `CREDENTIAL_PUBLIC_KEY` | — | not needed | — | not needed |
| `SUPABASE_EVIDENCE_BUCKET` | — | optional | — | optional |
| `RESEND_API_KEY` | — | ✅ | **never** | optional |
| `WEB_ORIGIN` | — | ✅ | — | for local invites |
| `MAIL_FROM` | — | optional | — | optional |
| `MAIL_REPLY_TO` | — | optional | — | optional |
| `INVITE_MAIL_FROM` | — | optional | — | optional |
| `INVITE_REPLY_TO` | — | optional | — | optional |
| `RESPONSE_NOTICE_TO` | — | optional | — | optional |

Two `.env` files, and they are not interchangeable. **`apps/web/.env` is Vite's** and may hold
only `VITE_`-prefixed values, all of which are public. **The root `.env`** is the worker's and
holds the secrets. `.env.example` in each place is the contract.

Nothing prefixed `VITE_` may ever carry a secret. A public key is not a secret — it is what makes
a secret unreadable to everyone holding it.
