---
purpose: Build spec for admin accounts, per-user run scoping, and the Documents Check capability gate. Read in full before writing any code.
status: approved by Frank 2026-09-01; design mockups reviewed and accepted
---

# Admin access and Documents Check gating

Two roles, one capability flag, run ownership enforced in the database. The owner sees every run;
an admin sees only the runs they started. Documents Check is off for every admin until the owner
turns it on.

This spec assumes the screener has no per-user login today — one operator context, access
controlled by knowing the URL. If an auth layer already exists beyond that, stop and say so before
Stage 1; the RLS work rebases onto it rather than replacing it.

---

## Non-goals — do not build these

1. **No permissions system.** One boolean, `can_run_documents_check`. Not a capabilities table, not
   a role matrix, not per-feature grants. If a second gated feature ever appears, that migration is
   its own decision. Building the general case now costs clarity and buys nothing.
2. **No login wall on anonymous surfaces.** Merchant comment pages, agent links and IQwallet sends
   stay token-scoped exactly as they are today. A merchant clicking a forwarded link must never be
   asked to authenticate. This is a named requirement, not an omission.
3. **No deletion of people.** Suspension is the only exit. Removing a person orphans their runs, and
   D-097 forbids losing run history. The row overflow menu carries resend invite, suspend and
   reinstate — nothing else.
4. **No retroactive blinding.** Revoking Documents Check stops new document checks. It does not hide
   a completed run the person already produced and read. Runs are immutable and append-only (D-002);
   hiding part of a report someone already holds makes the record inconsistent with itself.
5. **No admin-invites-admin.** Only the owner invites, grants, suspends and reinstates.

---

## Data model

### Roles and status

`owner` — exactly one, enforced by a partial unique index. `admin` — everyone else.

Status is `invited` → `active` → `suspended`, with `suspended` → `active` on reinstate. A row is
`invited` until first successful sign-in binds it to a Supabase auth user.

### `admin_users`

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `auth_user_id` | uuid, unique, nullable until first sign-in, references `auth.users` |
| `email` | citext, unique, not null — the invite is scoped to this address |
| `display_name` | text, not null |
| `role` | enum `owner` / `admin`, not null, default `admin` |
| `can_run_documents_check` | boolean, not null, **default false** |
| `status` | enum `invited` / `active` / `suspended`, not null, default `invited` |
| `invited_by` | uuid, references `admin_users(id)` |
| `invited_at` | timestamptz, not null, default now() |
| `activated_at` | timestamptz, nullable |
| `suspended_at` | timestamptz, nullable |

Two constraints that must be in the schema rather than in application code:

- Partial unique index on `role` where `role = 'owner'` — a second owner is a schema violation.
- Check constraint: `role = 'owner'` implies `can_run_documents_check = true`. The owner's access is
  not a grant that can be revoked by a stray update.

### `admin_access_log`

Append-only. Every invite, activation, grant, revocation, suspension, reinstatement and reroute.

| Column | Notes |
|---|---|
| `id` | bigserial, primary key |
| `actor_id` | uuid, not null — who did it |
| `subject_id` | uuid, nullable — who it was done to |
| `action` | text, not null — see enumerated values below |
| `value_before` | jsonb, nullable |
| `value_after` | jsonb, nullable |
| `created_at` | timestamptz, not null, default now() |

Actions: `invited`, `invite_resent`, `activated`, `granted_documents_check`,
`revoked_documents_check`, `suspended`, `reinstated`, `replies_rerouted`.

Append-only is enforced by grants and policy, not by convention: an insert policy exists, update and
delete policies do not, and `update` / `delete` are revoked from the authenticated role. "Who gave
this person access to the document files" is exactly the question IQwallet or a bank would ask, and
the answer must not be the owner's memory.

### `runs.created_by`

New column, uuid, references `admin_users(id)`, **not null after backfill**.

Backfill every existing run to the owner's row. Then add the not-null constraint in the same
migration, and **fail the migration if any run still holds null**. A null owner is a row no policy
covers, and both readings of null — nobody, everybody — are wrong.

---

## Enforcement

### Scoping lives in RLS, not in application filtering

Runs are read from the web UI, the worker, PDF generation and the email sender. A filter has to be
correct in every one of those paths; a policy is correct once. This is the D-014 shape — a control
that depends on each caller remembering it is blind to the caller that forgets.

Helper functions, both `security definer`, both resolving from `auth.uid()`:

- `current_admin_id()` → uuid, null if no matching row
- `current_admin_is_owner()` → boolean

Select policy on `runs`:

```
status of the current admin must be 'active'
AND (
  created_by = current_admin_id()
  OR current_admin_is_owner()
)
```

Note the status clause. A suspended admin sees nothing — their session, if live, goes empty rather
than stale. Their runs remain visible to the owner and are not deleted.

Documents Check artifacts and findings are scoped by the run they belong to, not by the capability
flag. The flag gates creation; it does not gate reading. This is what makes the revocation ruling
above true in the database rather than only in the UI.

### The service role bypasses RLS by design

The worker and the PDF generator use the service role and are not subject to these policies. That is
correct — they have no viewer. The companion requirement: **every service-role write to `runs` must
carry `created_by` explicitly.** There is no inference, no default, no fallback to the owner. A
service-role code path that reaches an insert without an owner in hand must throw, loudly, at that
point — not silently pick one.

---

## The Documents Check gate — four places

These are not redundant. Each covers a case the others don't.

1. **Nav item hidden.** Cosmetic only. Never the gate.
2. **Route guard on the page.** Covers a typed or bookmarked URL.
3. **API rejects the enqueue when the flag is false. This is the gate of record.** Every other layer
   can be bypassed; this one cannot.
4. **Worker re-reads the flag at job start.** A job can sit in the queue across a revocation. The
   worker checks the current value, not the value at enqueue time, and abandons the job with a
   recorded reason if it has changed.

Absent, not locked: an admin without the capability sees no Documents Check tab, no greyed item, no
lock icon, no request-access prompt. A visible-but-disabled control teaches someone that a feature
exists and that they are excluded from it.

---

## Invite flow

1. Owner opens People, clicks **Invite admin**, enters name and email, and sets the Documents Check
   checkbox — unchecked by default, and visible in the form so declining it is a choice rather than
   an omission.
2. Row is created with `status = 'invited'`, the flag as set, `invited_by` = owner.
3. Supabase Auth issues the set-password link. **The mail goes out through Resend from
   `reports@gomintro.com`**, not a Supabase sender — the domain a recipient sees must be one they
   recognise.
4. First successful sign-in binds `auth_user_id`, sets `status = 'active'` and `activated_at`, and
   writes an `activated` log entry.
5. The invite is scoped to the address it was sent to. A different address landing on the link gets
   the not-available page. Same precedent as the response-round Submit gate.

Resending an invite reissues the link and logs `invite_resent`. It does not create a second row.

---

## Screens

Three, all reviewed and approved as mockups on 2026-09-01. Build to those.

### People (owner only)

Header with the scope sentence — *Admins see only the runs they started. Documents check is off
unless you turn it on.* — and an **Invite admin** button top right, which reveals the form inline or
as a small dialog; match whatever the app already does elsewhere.

The list: person, role, run count, Documents Check toggle, overflow menu. Run count sits beside the
toggle deliberately — it tells the owner whether a grant matters. The owner's own row reads
**Always on** as plain text rather than a disabled toggle; a disabled control invites a click and
then explains nothing. Suspended rows stay in the list, greyed, with the run count intact and the
line *N runs still visible to you*.

Below it, **Recent access changes** — three entries and a **View full log** link. Three is enough to
answer "did something change recently that explains what I'm seeing." The full log is its own page,
not a tab: it is somewhere you go with a question and then leave, and it will want filters and a
date range that don't belong under the people list.

### Home — owner

Top bar: Runs, Documents check, New screen, account menu. The account menu holds People, Rule set
and Retention. People is not a top-level tab — it is a settings surface touched a few times a
quarter, and giving it equal weight with the daily working surface is wrong.

The runs list gains two owner-only pieces: a **Run by** column and a filter row
(Everyone / Mine / one chip per admin, suspended admins marked). **Everyone is the default, not
Mine** — the owner is the person for whom the full picture is the job, and defaulting to their own
runs means having to remember to look.

### Home — admin

The same page with four things **absent**, not disabled: the Documents Check tab (unless granted),
the Run by column, the filter row, and People in the account menu. Rule set stays for everyone — an
admin needs to know which version their run was scored against — and is read-only.

Under the **Your runs** heading, one line, stated once and never repeated:

> You see the screens you started. Frank, as account owner, can see runs from everyone on the
> account.

This is disclosure, not warning. The tool's whole posture is that observation is disclosed rather
than implied; the visibility rules inside the tool should not work differently from the ones it
applies to merchants.

### Empty state

For a newly activated admin with no runs. Headline names the space, one paragraph carries the
posture sentence **verbatim from the invitation email** — *Mintro reports what it observed; it does
not underwrite the account or decide the outcome* — a **New screen** button, and the disclosure line
repeated at the bottom, because on an empty page there is no list for it to caption.

### Not available

An admin follows a direct link to a run that isn't theirs, or to a Documents Check URL without the
capability. One plain page: the item isn't available to them, with a link back to their runs.

Not a 404 — that lies about something which plainly exists, and erodes trust in every other message
the tool shows. And **the page must not echo the merchant domain, the run state, or anything else
about the record.** Confirming which merchant sits behind an ID is precisely the leak the scoping
exists to prevent.

---

## Suspended admins and merchant replies

A suspended admin's runs stay open. If a merchant replies on one, the response-round notification
reroutes to the owner silently, and a `replies_rerouted` entry is written to the access log so the
reroute is recorded rather than invisible.

The Submit gate stays scoped to the invited addresses. Nothing about suspension changes what the
merchant sees or can do.

---

## Stages — one commit each, held for Frank's review

**Stage 0 — schema.** `admin_users`, `admin_access_log`, `runs.created_by`, the backfill, both
constraints, the two helper functions. No RLS yet, no UI. Seed the owner row.

**Stage 1 — RLS.** Policies on `runs`, on `admin_users`, on `admin_access_log`. Verify the service
role still works and that every service-role write carries `created_by`.

**Stage 2 — auth and invite.** Supabase Auth wiring, the Resend template, the bind-on-first-sign-in
path, address scoping.

**Stage 3 — owner screens.** People, the full log page, the owner home changes (Run by, filters,
account menu).

**Stage 4 — admin screens.** Admin home, empty state, not-available page, the disclosure line.

**Stage 5 — Documents Check gates.** All four, plus the reroute path and its log entry.

---

## Validation — the part that actually matters

The recurring defect pattern on this project is code that is internally consistent and wrong at a
boundary: invisible to tests that check the code against itself, caught only by running it against
the real thing. **Make every control fail in the specific way it exists to catch, before trusting
it.** A gate that has only ever been tested against itself is not a gate.

Required, each one observed failing:

1. Revoke Documents Check while a job is queued. The worker must refuse the job, not run it.
2. Sign in as an admin, follow a direct link to another admin's run. Not-available page, no merchant
   domain anywhere in the response body.
3. Suspend an admin with a live session. Their run list goes empty; the owner's view is unchanged.
4. Call the service-role run-insert path without an owner. It must throw at that point, not default.
5. Attempt an update and a delete against `admin_access_log` as an authenticated user. Both rejected.
6. Run the Stage 0 migration against a copy of production with a deliberately orphaned run. The
   migration must fail rather than complete.

Test 6 is the one most likely to be skipped and the most expensive to skip.

---

## Decision records

Three, written into DECISIONS.md before any code cites them:

- **Run ownership and RLS enforcement.** `created_by` not-null, scoping in policies rather than
  application filters, service role carries the owner explicitly, anonymous token surfaces untouched.
- **The Documents Check capability and its four gates.** Off by default, absent rather than locked,
  API enqueue as the gate of record, worker re-read at job start.
- **Revocation versus suspension.** Revocation is forward-only; suspension removes all access and
  retains all runs; nothing is deleted; suspended admins' replies reroute to the owner and are
  logged.

Numbers are assigned when the records are written. Do not cite a number in code before it exists in
DECISIONS.md.
