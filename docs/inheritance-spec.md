---
purpose: Merchant answers and comments carry forward to a re-screen of the same domain, marked as inherited. Read before touching commentary, attestations, or the invitation path.
status: agreed 2026-08-30, for build
---

# Inheriting a merchant's responses across runs

An agent re-screens a domain — because a credential was added, because the merchant fixed
something, because the crawl was incomplete. Today the merchant starts from nothing: nineteen
questions again, and every explanation they wrote again.

That is rework the merchant did not cause, and an agent moving fast will hit it repeatedly.

---

## What this changes about D-046

D-046 froze commentary with its run: *"a packing-slip explanation given in August is not evidence
about a January re-scan."* The reasoning was right about the risk and wrong about the remedy —
it prevented a stale statement looking current by preventing the statement from appearing at all.

**The rule becomes: inherit, but never let inherited text look fresh.** Every carried-forward
response renders with its original date and the run it came from, on every surface. A reader
always knows whether they are looking at something said about this screening or an earlier one.

Nothing is silently promoted. That is what D-046 was protecting, and it survives.

---

## 1 — Copy forward at invitation, not at read time

When a comment link is issued for run B, the merchant's most recent responses from earlier runs of
the same domain are **copied into run B's own rows**, marked as inherited.

Copy rather than join, for three reasons. Each run keeps its own complete record, so a stored run
still says what it said (D-002). The merchant edits normally — an inherited row is a row, not a
special case in every write path. And a report rendered later reads one place, as it does today.

Copying happens once, at `issueInvitation`. A run never invited inherits nothing, because nothing
was asked.

---

## 2 — Attestations inherit cleanly

The nineteen questions are about the business, not the crawl. *Do you maintain a permanent ban
list?* does not change because we re-crawled with a login.

**Copy the most recent answer per question** across all prior runs of the same merchant, whatever
run it came from. Latest wins; earlier ones are not consulted.

---

## 3 — Comments inherit by rule, with a caveat that matters

A finding comment is about a specific observation. On a re-screen the rule may produce a different
observation — more matches, fewer, or a different page.

**Copy by rule id**, where that rule produced a finding on run B.

**Where run B's observation differs from the one commented on, say so.** The row shows the comment,
its date, and a line stating that what was observed has changed since. The merchant's words are not
discarded and are not presented as a response to something they never saw.

Where the rule produced no finding on run B — it now passes, or was not evaluable — the comment is
not copied. There is nothing for it to attach to.

---

## 4 — Editing

**An inherited response is editable like any other**, and stays editable until the merchant submits
that round. Editing clears the inherited marks: it becomes theirs, on this run, with today's date.

**Leaving it alone is a valid choice.** It stands, with its date visible. No re-confirmation is
required — asking a merchant to re-affirm nineteen unchanged answers is the rework this removes.

**After submission, a further invitation reopens the round.** The operator can invite again; the
merchant can add and change. Submission locks a round, not the merchant.

---

## 5 — Counts, and what IQwallet reads

**Inherited responses do not count as answered on this run.** The participation record and the
attestation counts must mean *answered for this screening*, or the numbers stop being about the
run they head.

    7 answered · 4 inherited · 1 declined · 7 not answered · 19 asked

The same distinction applies to finding comments in the participation record.

This follows the same reasoning as D-199: a section must not claim something happened on this run
that happened on a different one.

---

## 6 — Schema

Additive. Two nullable columns on each of `merchant_attestations` and `merchant_comments`:

    inherited_from_run      uuid null references public.runs (id)
    originally_answered_at  timestamptz null

Both null means the response was given on this run. Both set means it was carried forward. A
constraint requires them to be set or null together — one without the other is a response whose
provenance is half known.

No table moves to merchant level. The join from run to merchant already exists via
`runs.merchant_id` and `merchants.domain`, and `upsertMerchant` keys on domain, so all runs for a
storefront already hang off one merchant row.

---

## 7 — What renders where

| Surface | Inherited response shows |
|---|---|
| Comment page (merchant) | the answer, "answered 12 Aug on an earlier screening", editable |
| Report (agent, IQwallet) | the answer, its original date, and that it is inherited |
| Participation record | counted separately, never folded into this run's answered count |

An inherited finding comment whose observation has changed also shows one line saying so.

---

## 8 — Operator visibility

The scan form shows, under the URL field beside the credential card, whether an earlier run of this
domain carries responses:

> This merchant answered 12 of 19 questions on 12 Aug. A new screening will carry those forward.

An operator re-screening should know before they run, not discover it afterward. Read from prior
runs of the same merchant; no new table.

---

## Order of work

1. The two columns and the pairing constraint.
2. Copy-forward in `issueInvitation` — attestations first, then comments by rule id.
3. The changed-observation line on inherited comments.
4. Editing clears the inherited marks.
5. Counts separate inherited from answered, everywhere they appear.
6. Render the provenance on all three surfaces.
7. The operator line on the scan form.

Steps 1–4 are what removes the rework. 5–7 are what stops it misleading anyone.
