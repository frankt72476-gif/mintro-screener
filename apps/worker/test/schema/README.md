# Schema tests

Three tiers, because no single one catches everything and pretending otherwise is how three
defects reached production through a green suite.

## Why this exists

`apps/worker/test/migrations.test.ts` reads the migration files as *text* and asserts the DDL is
well-formed: RLS enabled in the creating migration, writes revoked, append-only triggers present.
It never executes any of it.

That gap let three defects ship:

| Defect | What it was |
|---|---|
| Bucket guard | `0008` asserted the bucket exists; the migration passed and uploads still failed with "Bucket not found" |
| Existence vs completeness | the migration reported "already migrated" for runs with no findings and no evidence |
| `ON CONFLICT` vs partial index | `.upsert({ onConflict: 'run_id,ordinal' })` could not infer the partial index from `0009` |

All three were **DML failing against the real schema**. The suite asserted the shape of the
schema and nothing about working with it.

---

## Tier 1 — PGlite · runs in `npm run check`

`harness.ts` + `schema.test.ts`. Postgres compiled to WASM, in process, no Docker. It applies the
**actual migration files** — not a copy — so a migration that would fail against Postgres fails
here.

**Catches:** `ON CONFLICT` inference, trigger firing, check constraints, `NOT NULL`, uniqueness
scoping, the resumed-write path.

Two tests in `schema.test.ts` exist purely to prove the tier has teeth: they demonstrate that a
partial unique index *cannot* be inferred without its predicate, and that nulls are distinct in a
unique index. Both are the defect's own shape, reproduced. A test suite that only passes against
the fixed schema shows the fix works; these show the harness would have caught it.

**Cannot catch:** anything above SQL. No PostgREST, so the `supabase-js → PostgREST → SQL`
translation — where today's bug was *generated* — is not exercised. No storage API. No real
`anon` / `authenticated` role behaviour.

## Tier 2 — Supabase local stack · needs Docker

`integration.test.ts`, skipped unless `SUPABASE_TEST_URL` is set.

    supabase start
    SUPABASE_TEST_URL=http://127.0.0.1:54321 \
    SUPABASE_TEST_SERVICE_KEY=... \
    SUPABASE_TEST_ANON_KEY=... \
    npm run check

Full stack: Postgres, PostgREST, GoTrue, storage. This is the only tier that exercises the client
path the worker actually uses, and the only one that can test RLS as `anon` or storage
`upsert: false`.

**It is not currently runnable on the development machine — Docker is not installed there.** That
is stated rather than quietly skipped, because a tier nobody can run is not coverage.

## Tier 3 — preflight against the real project

`npm run inspect-supabase` — read-only, writes nothing. Reports what is actually in the tables and
the bucket.

The migration runs a preflight before writing anything: it confirms the bucket is reachable and
the expected index exists. `0008`'s guard checked the bucket at *migration* time; the failure
happened at *upload* time, and nothing re-checked in between.

---

## Adding a test here

If you fix a defect that involved SQL, add the case to Tier 1 before the fix and watch it fail.
A schema test written after the fix only documents the fix; one written before it documents the
defect, which is the thing that recurs.
