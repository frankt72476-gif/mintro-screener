# Supabase

Migrations, RLS, and the evidence bucket.

## Running the migrations

Order matters — each file references the one before it. Apply them in numeric order through the
SQL editor or the CLI:

    supabase db push          # with the Supabase CLI linked to the project

or paste `0001` through `0008` in order into the dashboard SQL editor.

`0008_storage.sql` **refuses to run** if the `evidence` bucket is missing or public. That is
deliberate: a public bucket would make every merchant capture readable by URL, and the failure
should be at migration time rather than discovered later.

## The one rule about RLS

**RLS is enabled in the same migration that creates the table.** Never after, never as a
follow-up. `docs/DEPLOY.md` is explicit that turning it on once rows exist is where people get
caught, and `apps/worker/test/migrations.test.ts` fails the build if a new table breaks this.

## Why triggers, not just policies

`service_role` carries `BYPASSRLS`. The worker's key ignores every policy in these files.

So the append-only guarantees — hard constraint 5, D-002 — are **triggers and primary keys**,
which are not bypassed:

| Guarantee | Enforced by |
|---|---|
| Evidence is never overwritten | `evidence.key` primary key + `upsert: false` on the storage write |
| Evidence rows never change | `evidence_is_append_only` trigger |
| Findings never change | `findings_are_append_only` trigger |
| Send records never change | `sends_are_append_only` trigger |
| A finished run is frozen | `runs_are_immutable_once_finished` trigger |

RLS decides who can *read*. The triggers decide what can *change*, including by us.

## Invite-only access

Being in `auth.users` is not enough. Every policy gates on `public.is_analyst()`, which requires
an active row in `analysts`.

The dashboard's "disable signups" toggle is not version-controlled, not reviewable, and not
testable. If it were ever flipped, `authenticated` alone would let anyone who signed up read every
merchant's evidence. The `analysts` table closes that at the database layer.

To invite someone:

    -- 1. Invite through the dashboard (Authentication → Users → Invite) or the admin API.
    -- 2. Then grant access:
    insert into public.analysts (id, email, full_name)
    values ('<auth-user-uuid>', 'analyst@mintro.com', 'Name');

To revoke without deleting the account — which would orphan the `sends` records that name them:

    update public.analysts set active = false where email = 'analyst@mintro.com';

## The credentials table holds no credentials

It stores a `vault_ref` and nothing else (hard constraint 6). There is no password column, no
secret column, and no jsonb column something could be hidden in. A `check` constraint rejects
values that do not look like a vault path.

It also has **no policy for `authenticated`**. An analyst has no reason to read even the
reference: it is useless without the vault token, but it names which merchants have stored
credentials, and the browser does not need to know that.

## Evidence

Private bucket, keys scoped per run: `<run-id>/<layer>/<sha256>`. The `evidence` table's
`key_is_run_scoped` constraint enforces the shape, so a key that could collide across runs cannot
be inserted.

Screenshots reach the browser through **short-expiry signed URLs**, minted per view. A signed URL
stored in a report would either expire and break it, or be given a long enough life to be a public
URL with extra steps.
