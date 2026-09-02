---
purpose: Build spec for organization-scoped access, the two operator capabilities, and the Mintro review path. Supersedes the 2026-09-01 v1 in full. Read before writing any code.
status: v2, revised 2026-09-01 after the segregation ruling. Stages 0, 1 and 1b are built; the predicates from 1 and 1b are reworked by this revision.
---

# Organization access, capabilities, and the Mintro review path

The screener is used by more than one organization. Mintro is the host. The others are partner
agencies who each have a relationship with Mintro and none with each other, and who must not learn
of each other's existence through this tool.

The boundary is the **organization**, not the person. Colleagues at one agency see each other's
work and cover for each other. Nothing crosses between agencies. Mintro sees everything.

## What changed from v1, and why

v1 scoped runs to the person who created them. That was correct for a single-organization tool and
wrong for this one — colleagues at an agency could not cover for each other, and the model had no
concept of a boundary that outbound email and merchant-facing pages also have to respect.

Three corrections carried into this version:

1. **The boundary is the organization.** The read predicate moves from creator to org.
2. **Documents Check anchors on the package, not the run.** v1 said runs. That was wrong on the
   facts — packages hang off merchants, never off runs. Corrected throughout.
3. **There are two capabilities, not one.** v1 said one boolean was the limit. Submission to
   IQwallet is the second. Two named columns remain clearer than a grants table; three is where
   that stops being true, and that is a decision for whoever proposes a third.

Dropped from v1 entirely: package hand-off, and merchant reassignment between Mintro staff.
Host-org members see everything, so there is nothing to reassign.

---

## Non-goals — do not build these

1. **No permissions system.** Two named booleans on `analysts`. Not a capabilities table, not a
   role matrix, not per-feature grants.
2. **No login wall on anonymous surfaces.** Merchant comment pages, agent links and IQwallet sends
   stay token-scoped. A merchant clicking a forwarded link is never asked to authenticate.
3. **No deletion of people.** Suspension is the only exit (D-097).
4. **No retroactive blinding.** Revoking a capability stops future actions. It does not hide
   completed work (D-002).
5. **No admin invites admin.** Only the owner invites, grants, suspends and reinstates — including
   as against other host-org members.
6. **No cross-org assignment.** A merchant relationship never moves between organizations.
7. **No second owner.** If the owner is unavailable, nobody can invite or grant. That is the
   accepted cost of a single owner at this size. The remedy, if it ever bites, is a host-org
   administrative role — not a workaround.

---

## Data model

### `organizations`

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `name` | text, not null — display name |
| `type` | enum `host` / `partner`, not null |
| `created_at` | timestamptz, not null |

Exactly one `host`, enforced by a partial unique index on `type` where `type = 'host'`. Mintro is
the host. Every other organization is a partner.

### `analysts` — additions to the existing table

`analysts` is the one actor table. Do not create a second.

Already added in Stage 0: `role`, `can_run_documents_check`, `status`, `invited_by`,
`activated_at`, `suspended_at`, the partial unique owner index, the owner-implies-capability check,
and `check (active = (status <> 'suspended'))`.

Added by this revision:

| Column | Notes |
|---|---|
| `org_id` | uuid, references `organizations(id)`, not null after backfill |
| `can_submit_to_iqwallet` | boolean, not null, default false |

The owner check constraint extends: `role = 'owner'` implies both capabilities true.

Backfill `org_id` using the approved DDL pattern — guard first, then
`ADD COLUMN ... NOT NULL DEFAULT '<host-org uuid resolved via format(%L)>'`, then `DROP DEFAULT`.
No `UPDATE`. The existing analyst rows are Mintro.

### `runs.created_by` and `packages.created_by`

Both stay, both stay not-null. They are **attribution**, not the read predicate — who did the work,
which the access log, the review path and any future audit all need. Do not remove them when the
predicate changes.

### `admin_access_log`

Unchanged from Stage 0. Append-only, insert policy only, `reject_mutation()` trigger, owner-only
select. Actions extend to cover the second capability and the review path:
`granted_iqwallet_submit`, `revoked_iqwallet_submit`, `marked_ready_for_review`,
`submitted_on_behalf_of`.

Owner-only select is now load-bearing rather than incidental: the log names people across
organizations, so a host-org member who is not the owner must not read it.

---

## Access model

### The predicate

Replaces the creator-scoped predicates built in Stages 1 and 1b.

```
can_read_run(run_id):
  is_analyst()
  AND current_admin_is_active()
  AND (
    run.org_id = current_admin_org()
    OR current_admin_is_host()
  )
```

`can_read_package(package_id)` is the same shape against the package's org.

`runs` and `packages` therefore need `org_id` alongside `created_by`, populated from the creating
analyst's org. Denormalized deliberately: resolving org through `created_by → analysts.org_id` on
every policy evaluation means a re-orged analyst silently changes what their old runs belong to,
and a run's organization is a fact about the run at the time it was made.

`current_admin_org()` and `current_admin_is_host()` join `current_admin_id()` and
`current_admin_is_owner()` — same construction, security definer, stable, resolving from
`auth.uid()`.

### Who sees what

| | Partner member | Host member | Owner |
|---|---|---|---|
| Own org's runs and packages | yes | — | — |
| All orgs' runs and packages | no | yes | yes |
| That other organizations exist | no | yes | yes |
| People, invites, grants | no | **no** | yes |
| Access log | no | **no** | yes |

A host member has the owner's view of the work and none of the owner's controls. People is absent
from their account menu — absent, not disabled. Enforced by `current_admin_is_owner()`, which
resolves to exactly one row by the partial unique index, and by `reject_self_promotion()`, already
built in Stage 1.

### Scoping discipline — carried forward from Stages 1 and 1b

These held and must keep holding through the rework:

- **Replace policies, never add alongside.** Multiple permissive policies OR together, so an added
  policy grants more access and the new one is decorative.
- **Rewrite from the current definition.** For any `create or replace`, list every migration
  defining that name and take the last. Grep finds the introducing migration, not the current
  definition. This has bitten twice — D-040 and 0053 in Stage 1, the D-084 retention clock in
  Stage 1b — and is now a standing convention in CLAUDE.md.
- **Re-derive the FK graph rather than trusting a prior enumeration.** Stage 1b's re-derivation
  found nine tables the first pass missed.
- **Objects reached by storage key, not foreign key, are part of the graph.** Evidence objects in
  Stage 1; the documents bucket in Stage 1b.
- **Content-addressed tables anchor on nothing and leak everything.** `extractions` is keyed by
  hash and handed over every document's text to anyone who could observe one. Scoped through
  `document_versions` sharing its `sha256`.

### Already scoped, and not revisited by this revision

Credentials are stricter than org scoping and stay that way. `credentials`, `credential_deposits`
and `vault_entries` are readable by nobody through PostgREST — RLS on, no policy, revoked.
`credential_state` and `credential_access` are owner-only. Widening any of these is its own
decision.

The documents storage bucket has no policy and is served by signed URLs through the service role.
That is the correct resting state. Any screen that tries to read it as `authenticated` fails closed
with no policy to explain why — whoever builds such a screen needs to know this in advance.

`merchants` is scoped to the owner, or an analyst whose **org** holds a run or a package for that
merchant. Note the second clause: it was runs only until packages gained an owner, which left an
analyst able to read a package and not its merchant row.

---

## Capabilities

Two booleans on `analysts`, both default false, both granted only by the owner, both shown on the
People screen.

### `can_run_documents_check`

Gates **creating** a document run. Does not gate reading one — reading is org scope. Revocation is
forward-only.

### `can_submit_to_iqwallet`

Gates sending a report to IQwallet. A partner without it cannot submit; the work goes to Mintro to
finish and send.

Each capability needs the same four gates. They are not redundant — each covers a case the others
do not:

1. **Nav or action hidden.** Cosmetic. Never the gate.
2. **Route guard.** Covers a typed or bookmarked URL.
3. **API rejects the request. This is the gate of record.** Every other layer can be bypassed.
4. **Worker re-reads the flag at job start.** A job can sit in the queue across a revocation.

Absent, not locked. No greyed control, no lock icon, no request-access prompt. A visible-but-
disabled control teaches someone that a feature exists and that they are excluded from it.

---

## The Mintro review path

A partner without `can_submit_to_iqwallet` finishes a report and needs a way to say so. Without
this state that becomes a Slack message and a dropped ball.

Add a run state between complete and sent: **ready for Mintro review**. The partner marks it; it
surfaces to host-org members; a host member reviews, completes what needs completing, and submits.

- Marking writes `marked_ready_for_review` to the access log.
- Submission by a host member on a partner's run writes `submitted_on_behalf_of`, naming both.
- The state is visible to the partner — they can see the work is with Mintro, which is the point.
- Nothing about the report itself changes. The submission is identical whoever sends it.

---

## Outbound surfaces — where segregation is actually enforced

Everything above is a database boundary. These three are where a leak reaches a person, and they
are the part of this build carrying real exposure. **Design pass before Stage 3 builds them.**

1. **The invitation email** — `apps/worker/src/invite.ts`.
2. **The merchant comment page** — `apps/web/src/components/CommentPane.tsx`.
3. **The PDF participation record.**

All three must identify **Mintro**, never the partner agency. A merchant who forwards a link must
not thereby tell one agency that another is working the account. Audit every merchant-, agent- and
IQwallet-facing string for an operator name, address or organization.

IQwallet sees Mintro and nothing below it. No org identity in the report, the email or the
participation record. Reports are identical regardless of which organization produced them.

---

## Stages

**Stage 0 — schema.** Built, approved as 42fad10. No change.

**Stage 1 — run scoping.** Built, approved as b51b869. The predicate is reworked by Stage 1c; the
enumeration, the policy list and the service-role fixes all stand.

**Stage 1b — documents and credentials.** Built, approved as c2bb643. Same: predicate reworked,
everything else stands.

**Stage 1c — organizations.** `organizations` table, `analysts.org_id`, `runs.org_id`,
`packages.org_id`, all backfilled by the DDL pattern to the host org. `current_admin_org()` and
`current_admin_is_host()`. Rework `can_read_run` and `can_read_package` to the org predicate.

**Stage 2 — auth and invite.** Supabase Auth, the Resend template, bind-on-first-sign-in, address
scoping. `analysts.email` gets unique + citext here — it is a Stage 2 dependency, and the invite
lookup must be case-insensitive at the query regardless of column type. The invite form carries org
selection and both capability checkboxes.

**Stage 3 — owner screens.** People, with an organization column and both capability toggles; the
full access log page; the owner home changes. No reassignment surface — dropped with the host-org
visibility ruling.

**Stage 3 dependency — the internal read path that names the recorder.** D-233 made the outbound
payload boolean-only: `commentaryStore` and `open_report_for_comment` carry `recordedByOperator`
and `recordedAt`, and no operator email or id at all. That is the print-safe assembly and it stays
that way — the PDF goes to IQwallet, and the comment page is reached over a forwardable link.

An analyst or host-org member looking at the same report therefore currently sees *"Recorded by
Mintro"* where a colleague's name would be useful, and `runs.created_by` renders as a uuid because
nothing resolves it. Both are the same missing piece: **a second, internal assembly that carries
`recorded_by_email` and the creating analyst's name, gated by RLS, built in Stage 3.**

Two constraints on it, and they are the whole reason this is written down rather than rediscovered:

- **It is never merged into the print payload.** The print path takes the boolean assembly. A
  single assembly with a `print` flag is one forgotten flag away from the leak D-233 closed, and the
  absence tests (`operatorIdentityOutbound`, `operatorIdentityPayload`) are what would catch it —
  keep them pointed at the print path.
- **It is gated by RLS, not by the caller.** `analysts_select` already resolves it: own row, own
  org, host, or owner. A partner member reading a report their org produced sees their own
  colleague's name and no one else's, which is the same boundary the rest of Stage 1c draws.

`recorded_by` and `recorded_by_email` remain on the table for exactly this, and D-233 pins the email
to the analyst it names so the internal surface is worth trusting when it is built.

**Known and accepted — the invite form's two writes.** Creating a partner organisation and queueing
its first member are two writes and can half-succeed, leaving an organisation with nobody in it.
Self-healing on retry: `create_partner_org` is idempotent by name, so the owner's second attempt
lands on the same organisation rather than a second one. Left as two writes deliberately — make it
atomic only if the empty organisations become noise on the People screen.

**Stage 4 — member screens.** Partner home, host-member home, empty state, not-available page, the
disclosure line.

**Stage 5 — capability gates and the review path.** All four gates for both capabilities, the
ready-for-review state, `submitted_on_behalf_of` logging.

One commit per stage, held for review. Every stage reports the full test suite result — file and
test counts — and is not approved without it.

---

## Validation

The recurring defect on this project is code internally consistent and wrong at a boundary:
invisible to tests that check the code against itself, caught only against the real thing. **Make
every control fail in the specific way it exists to catch, before trusting it.**

Two failure modes to guard against by name, both observed on this build:

- **Vacuous passes.** A delete refused against an empty table proves nothing. Confirm the row is
  visible to someone first, so every zero is a denial rather than an absence.
- **Guards that report a protected thing as unprotected.** Stage 0's grant-audit regex was
  unanchored and matched the word "revoke" inside prose.

Required for Stage 1c, each observed, on a Supabase branch off production, with two partner
organizations and at least two members in one of them:

1. Partner A member reads partner B's run, finding, evidence, screenshot, package, document run,
   document, extraction and slot — by id, directly. Empty in every case.
2. Partner A member reads a colleague's run in the same org. Visible.
3. Host member who is not the owner reads both partners' runs and packages. Visible.
4. Host member reads `admin_access_log`. Empty. Owner reads it. Populated.
5. Host member attempts to grant a capability by direct write. Refused by
   `reject_self_promotion()`.
6. Partner member attempts to set their own `org_id`. Refused.
7. Suspended partner member reads their own org's runs. Empty.
8. Merchant comment link, no session. Loads.
9. Every Stage 1 and Stage 1b check re-run. Nothing loosened.

Delete the branch afterwards and re-link to production. Never read from a credential store — if
blocked on access, stop and say what is needed.

---

## Decision records

Written into DECISIONS.md before any code cites them. Numbers assigned at writing.

- **Organization as the access boundary.** Org-scoped rather than creator-scoped; `created_by`
  retained as attribution; org denormalized onto runs and packages because a run's organization is
  a fact about the run at the time it was made.
- **Host and partner organizations.** Host members see all work and hold no administrative
  controls; administration is owner-only; a merchant relationship never crosses an org boundary.
- **The two capabilities and their four gates.** Off by default, absent rather than locked, API
  rejection as the gate of record, worker re-read at job start, revocation forward-only.
- **Documents Check anchors on the package.** Correcting v1 of this spec, which said runs.
- **Replace-don't-add and current-definition discipline.** Multiple permissive policies OR
  together; the latest definition of a function or policy is not in the migration that introduced
  it. Policy-text-asserting tests are load-bearing and must not be softened.
- **Revocation versus suspension.** Revocation is forward-only; suspension removes all access and
  retains all work; nothing is deleted.
