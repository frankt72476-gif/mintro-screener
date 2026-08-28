# Stuck run — https://www.comopeptides.com, 28 Aug 2026

**Investigation only. Nothing was changed, nothing was deployed, no run row was mutated.**
Every database access below was a `select`; every Fly command was `status` or `logs`.

Request `5ccd3051-6809-4d59-ad44-3cf8a0b4674a`, queued 2026-08-28 13:37:52 ET.
Investigated 2026-08-28 14:02–14:05 ET.

## Answer first

The worker process is **alive, healthy, and blocked inside the job**. It is not dead, it was not
OOM-killed, it did not restart, and it threw nothing. It stopped emitting output at 13:39:47 ET,
partway through the **gate-rule block** — after Layer 3 and before GATE-002/GATE-003 produced
findings — and has been silent since.

**Nothing has been persisted. At all.** No run row, no findings, no evidence rows, no storage
objects, not even a merchant row. The "partial results" the UI shows are not results: they are the
free-text `progress` string the worker appends as it goes.

The run cannot recover on its own, because the one mechanism that would recover it — stale-claim
reclaim — runs inside the same sequential loop that is blocked.

### One correction to the premise

The run has been stuck for **~26 minutes**, not hours. Queued 13:37:52 ET, claimed 13:37:55 ET,
last log line 13:39:47 ET, still running at 14:04 ET. This does not change the diagnosis — 26
minutes already exceeds the maximum bounded duration of the remaining work (§3.3) — but the
timeline should be on the record accurately.

---

## 1. The run's actual state in the database

### 1.1 `scan_requests` — the queue row

Every column, as read:

| Column | Value |
|---|---|
| `id` | `5ccd3051-6809-4d59-ad44-3cf8a0b4674a` |
| `url` | `https://www.comopeptides.com` |
| `requested_by` | `0c176a82-bedd-4f66-9422-f328d92b822c` (frankt@gomintro.com) |
| `status` | **`running`** |
| `run_id` | **null** |
| `error` | **null** |
| `progress` | `layer 3: 0 fail · 4 review · 1 pass · 3 not evaluable` |
| `claimed_at` | `2026-08-28T17:37:55.205Z` (13:37:55 ET) |
| `created_at` | `2026-08-28T17:37:52.182Z` (13:37:52 ET) |
| `finished_at` | **null** |
| `mode` | `public` |

Claimed 3 seconds after it was queued. `claimed_at` has not moved since — no reclaim has occurred,
which matters and is picked up in §2.3.

### 1.2 What the UI is actually showing you

The `progress` column **is** the "layer 3 — 0 fail, 4 review, 1 pass, 3 not evaluable" line.
`App.tsx:998` renders `request.progress` verbatim for any non-terminal request, and `scanQueue.ts:136`
selects it straight off the row. The comment at `App.tsx:1066-1068` says so explicitly — an earlier
version invented a seven-layer progress card, and it was replaced with "show the one line the
worker wrote and say nothing it has not been told."

So the counts on screen are a **status message**, not persisted findings. They are honest about
what the worker computed in memory, and they are not evidence that anything was written.

### 1.3 Persisted results — there are none

| Check | Result |
|---|---|
| `runs` rows with `status = 'running'` | **0** |
| `runs` rows with `started_at >= 17:00Z` | **0** |
| `merchants` matching `%comopeptides%` | **0 rows** |
| `findings` created since 17:00Z | **0** |
| `evidence` rows created since 17:00Z | **0** |
| Storage prefixes under the `evidence` bucket starting `46d20012` | **none** (20 prefixes at root, none this run's) |

The run id `46d20012…` appears only in the worker's log line and exists only in that process's
memory. It has never been written anywhere.

This is exactly what the design predicts, and worth stating because it is the reassuring part:
`screenStorefront` writes nothing — its header says *"Nothing here writes to a database or to disk.
It crawls and returns; the caller decides where the result goes."* Persistence happens in
`persistRun`, called by `handle()` only after `screenStorefront` **returns**. It never returned, so
`persistRun` was never entered, so `upsertMerchant` never ran — which is why there is not even a
merchant row.

### 1.4 How far it actually got

From the worker log, all of this **executed in memory** and none of it is persisted:

| Time (ET) | Stage |
|---|---|
| 13:37:55 | claimed; run id `46d20012` minted |
| 13:37:57 | Layer 0 — robots.txt read, no `Crawl-delay` declared |
| 13:38:04 | Layer 1 — homepage HTTP 200, footer located |
| 13:38:04 | reclassify — 6 Layer 0 rules became evaluable (NAME-002, CATG-001/002/003/004/007) |
| 13:38:04 | sampling 5 of **37** product pages |
| 13:38:25 | all 5 product pages served anonymously — no login wall |
| 13:38:26 | COA fetch — no certificate retrieved, 5 links tried, `link_broken` |
| 13:38:35 | Layer 3 — sign-up form located at `/my-account/`, 2 fields |
| 13:38:39 | Layer 3 — terms document located at `/termsandconditions/`, 5243 chars |
| 13:39:02 | Layer 3 — no shipping policy reached |
| 13:39:21 | Layer 3 — no FAQ reached |
| 13:39:47 | Layer 3 — no payment or refund policy reached |
| 13:39:47 | **`layer 3: 0 fail · 4 review · 1 pass · 3 not evaluable`** ← last output |
| — | *silence* |

So: Layers 0, 1, 2 and 3 all ran to completion in memory. Roughly 10 pages were rendered and
captured into in-process buffers (homepage, 5 products, `/my-account/`, `/termsandconditions/`,
plus failed candidate paths). **All of it is held in the `artifacts` array of a function that has
not returned, and will be lost when the process is restarted.**

---

## 2. Why it did not reach a terminal state

### 2.1 Fly: no OOM, no restart, no stop/start

`mintro-screener-worker`, region `iad`. **Two** machines exist, despite `fly.toml`'s "One machine"
comment:

| Machine | Name | State | Last event |
|---|---|---|---|
| `d8d96506f79758` | holy-wood-7706 | **started** | `started` / `start` / flyd / 2026-08-28 09:49:36 ET |
| `853193b416e138` | hidden-moon-4571 | stopped | `stopped` / `update` / flyd / 2026-08-28 09:49:34 ET |

The running machine's complete event log since creation is three lines: `pending`→`created`→
`started`, all at 09:49 ET — the deploy that shipped ruleset 3.1.0. **No `oom` event, no restart,
no `stop`, no host issue.** `HostStatus: ok`.

The log confirms the process boundary: the last two process exits in the log are both graceful
deploy SIGINTs (`Main child exited normally with code: 130`) at 27 Aug 18:15 ET and 28 Aug 09:49 ET,
each followed by a fresh boot banner. There is **no boot banner after 09:49:42 ET**, so the Node
process that claimed this job at 13:37:55 is the same one still running now. It has not crashed and
has not been restarted.

### 2.2 No exception, no Playwright timeout

The log ends cleanly at the `layer 3:` line. There is no stack trace, no `FAILED:` line (which
`handle()`'s catch block would print), and no Playwright `TimeoutError`. Between 13:39:47 and
14:04 ET — 24 minutes — the worker has emitted **nothing**.

This rules out the ordinary failure path. `handle()` wraps the whole job in try/catch and, on any
throw, writes `status: 'failed'` with the message. The row is not `failed`, so nothing threw.

### 2.3 Where it is blocked

The next statement after the `layer 3:` progress line in `screen.ts` is the gate block:

```
say(`layer 3: …`)                       ← 13:39:47, last output
const anonymous: AnonymousAccess = { probe, flow }
const gate = await runGateRules({ ruleset, access: anonymous, productUrl })
say(`gate rules evaluated without a session: …`)   ← never printed
```

`runGateRules` (`apps/worker/src/gate.ts`) iterates the two rules carrying
`unauthenticated: true`, in ruleset order:

- **GATE-002** — `http_probe`, paths `["/collections/all", "/products", "/shop"]` → `probePaths`
- **GATE-003** — `flow_probe`, `add_to_cart_then_checkout` → `runCheckoutFlow`

Neither has produced its finding. The block is inside one of those two, and given the elapsed time
almost certainly inside `runCheckoutFlow` — the checkout flow against comopeptides.com.

I did **not** issue my own requests to comopeptides.com to test this. The run is still in flight
against that host, and adding concurrent requests would have been the very contention this
investigation is meant to characterise. The conclusion below rests on the code and the clock
instead.

### 2.4 Why it will not recover by itself

The worker does have a stale-claim mechanism, and it is the right idea. `claimNext` selects

```
status.eq.queued  OR  (status.eq.running AND claimed_at < now - STALE_CLAIM_MS)
```

with `STALE_CLAIM_MS = 15 * 60 * 1000` (`worker.ts:80`), and logs `reclaimed … its previous claim
was stale`.

The claim is now 26 minutes old — well past the threshold — and `claimed_at` has not moved. That
is the proof that the loop is blocked: **the only code that reclaims a stale claim is the poll
loop, and the poll loop is what is stuck.** A worker cannot reclaim its own stranded job while it
is the thing stranding it.

This mechanism protects against a machine that *dies*. It does nothing for a machine that *hangs*,
which is the case here.

---

## 3. Timeouts — actual values from the code

### 3.1 Navigation and action timeouts, as written

| Call site | Value | Source |
|---|---|---|
| `renderPage` default (`page.setDefaultTimeout`) | `options.timeoutMs ?? 30_000` | `render.ts:111` |
| `renderPage` → `page.goto` | same, 30s as called from `screen.ts` | `render.ts:113` |
| `renderPage` → `waitForLoadState('networkidle')` | **8_000**, `.catch` → continue | `render.ts:115` |
| `screenStorefront` → homepage render | `timeoutMs: 30_000` | `screen.ts` |
| `screenStorefront` → product sample render | `timeoutMs: 30_000` | `screen.ts` |
| `discoverLayer3` → each candidate render | `options.timeoutMs ?? 30_000` | `signup.ts` |
| `probePaths` → `page.goto` | `options.timeoutMs ?? 20_000`; called with **20_000** | `probe.ts`, `screen.ts` |
| `runCheckoutFlow` → all `goto`/`click` | `options.timeoutMs ?? 20_000`; called with **20_000** | `flow.ts`, `screen.ts` |
| `runCheckoutFlow` → `waitForLoadState('networkidle')` | **8_000** | `flow.ts` |
| `cartHoldsProduct` | **8 attempts × 1_000ms** interval | `cart.ts` |
| `cartHoldsProduct` → `/cart.js`, `/wp-json/wc/store/v1/cart` | **10_000** each | `cart.ts` |
| `renderedCartShowsProduct` → `page.goto` | **20_000**, two paths | `cart.ts` |
| `renderedCartShowsProduct` → `networkidle` | **6_000** | `cart.ts` |
| Layer 0 HTTP fetcher | **15_000** | `screen.ts` |
| Poll interval when idle | 3_000 | `worker.ts:67` |
| Stale claim threshold | **900_000** (15 min) | `worker.ts:80` |

Playwright is `1.49.0`. Where no explicit timeout is passed and no default is set, Playwright's
built-in default is 30s for actions and navigations.

### 3.2 `setDefaultTimeout` is set in exactly one place

```
apps/worker/src/render.ts:111    page.setDefaultTimeout(timeout);
```

That is the **only** occurrence in the entire worker. `probe.ts`, `flow.ts`, `cart.ts` and `coa.ts`
all create pages from a fresh context and never set a default. They pass explicit timeouts to the
calls that accept one — which is most of them — but any call that does not take a timeout argument
falls back to Playwright's own default, or to nothing.

### 3.3 There is no run-level timeout. None.

Grepping `worker.ts` and `screen.ts` for `Promise.race`, `AbortController`, `deadline`, or any
whole-run budget returns nothing but an unrelated `sleep` helper (`worker.ts:621`) and a comment.

`handle()` awaits `screenStorefront` with no bound:

```
const { report, artifacts } = await screenStorefront(browser, request.url, ruleset, { … })
```

A run may take arbitrarily long and nothing will interrupt it.

**Adding up the per-step bounds** for the work remaining after the `layer 3:` line:

| Step | Worst case |
|---|---|
| GATE-002 — 3 paths × (goto 20s + `page.content()`) | ~150s |
| GATE-003 — `goto` product | 20s |
| GATE-003 — `clickFirst(ADD_TO_CART)`, 5 selectors × 20s | 100s |
| GATE-003 — `cartHoldsProduct`, 8 attempts × ~73s | ~584s |
| GATE-003 — `clickFirst(CHECKOUT_CONTROLS)`, 3 × 20s | 60s |
| GATE-003 — `goto /checkout` + `networkidle` | 28s |
| **Total bounded worst case** | **≈ 16 minutes** |

**It has been silent for 24 minutes.** The elapsed time exceeds the sum of every bounded step that
remains, which is what distinguishes *hung* from *merely slow*.

### 3.4 The unbounded awaits in this exact code path

There are calls in the gate path that take no timeout argument and are not covered by
`setDefaultTimeout` (which is never set on these pages anyway):

| Call | Where | Note |
|---|---|---|
| `page.evaluate(...)` | `locate.ts` → `establishCheckout` | Playwright applies no timeout to `evaluate`. `.catch(() => null)` catches a *rejection*; it cannot catch a hang. |
| `page.evaluate(...)` | `cart.ts` → `renderedCartShowsProduct` | same |
| `page.content()` | `probe.ts:52`, `flow.ts:79` (`observe`) | no timeout argument passed; `flow.ts` wraps it in `.catch(() => '')`, which again does not cover a hang |

A page whose JavaScript context is wedged — a busy loop, a blocked main thread, a `beforeunload`
dialog — will hold any of these forever. That is the shape most consistent with the observed
silence, though I could not confirm which one without attaching to the process.

---

## 4. Is there a terminal failure state?

**Yes for both tables, and both are reachable — but only when the process stays alive to write them.**

### 4.1 `scan_requests`

`0012_scan_requests.sql` constrains `status` to `('queued', 'running', 'done', 'failed')`, with two
constraints that stop a silent terminal state:

```sql
constraint finished_requests_say_what_happened check (status <> 'done' or run_id is not null)
constraint failed_requests_say_why           check (status <> 'failed' or error is not null)
```

`handle()` (`worker.ts:477, 485`) writes `done` with a `runId` on success and `failed` with the
message on any throw. The comment on `handle` is accurate: *"Never throws: the queue row carries
the outcome."*

### 4.2 `runs`

`0004_runs.sql` constrains `status` to `('running', 'complete', 'failed')`. `persistRun` marks a run
`failed` with `finished_at` left null so it stays resumable, and only sets `complete` after
verification.

### 4.3 So can a row be stranded at RUNNING permanently?

**Yes — and this is that case.**

The `failed` transition is written by a `catch` block *in the worker process*. It requires the
process to survive the failure. Three ways it does not:

1. **A hang** — no exception is ever thrown, so no catch runs. **This is what happened.** The row
   stays `running` for as long as the process hangs, which is unbounded because §3.3 has no
   run-level timeout.
2. **SIGKILL / OOM** — the catch block never executes. The row stays `running`.
3. **Machine loss** — same.

For (2) and (3) the stale-claim reclaim is the recovery: after 15 minutes another poll picks the row
back up. For **(1) it is not**, because the hung process is the only worker and it is not polling
(§2.4).

There is no reaper, no watchdog, no external process, and no database-side timeout that can move a
row out of `running`. A hang on a single-machine deployment strands the row indefinitely. That is
the honest answer: **yes, a run can sit at RUNNING permanently, and this one will until the machine
is restarted.**

Worth noting for the record: the failure is *visible* rather than silent — the row is plainly
`running` with no `finished_at`, and the UI says so. That is better than the shape this project
keeps finding. But nothing recovers it.

---

## 5. Concurrency — does this block new runs?

**Yes. It blocks everything, not just scans.**

### 5.1 The model

The queue is a compare-and-swap, and it is genuinely safe for multiple workers: `claimNext` reads
the oldest eligible row, then updates it conditioned on `.eq('status', candidate.status)`. If
another worker moved it first, the update matches nothing. No locks, no RPC. That part is sound.

What is not concurrent is the **worker itself**. `main()` runs one sequential loop
(`worker.ts:193-…`):

```
while (!stopping) {
  await drainDeposits(...)
  const request = await claimNext(supabase)
  if (request !== null) { await handle(...); continue }      ← blocked here
  const pdf  = await claimNextPdf(...);   if (pdf)  { await handlePdf(...); continue }
  const send = await claimNextSend(...);  if (send) { await handleSend(...); continue }
  … uploads, documents sends, exports, discards, purge plans, invites, notices …
}
```

One job at a time, in priority order, with every job type behind the same `await`. There is no
`Promise.all`, no worker pool, no per-job-type concurrency.

### 5.2 Consequence right now

`await handle(...)` for the comopeptides request has not returned. Therefore, since 13:37:55 ET the
worker has not — and cannot — do any of the following:

- claim a new scan request
- reclaim its own stale claim (§2.4)
- render a PDF
- send a report or a Documents Check report
- process a document upload
- build, discard, or plan-purge an export
- issue an invitation or a response notice
- run the hourly staged-export sweep

**New scans can still be queued** — the RLS insert policy lets an analyst insert a `queued` row —
but nothing will pick them up. They will sit at `queued` until the loop is unblocked.

### 5.3 The second machine

Two machines exist; `853193b416e138` is **stopped**. If it were started it would poll independently
and, because the claim is a CAS, would safely take the queued work — and after 15 minutes would
reclaim this stale row. The `fly.toml` comment explains the single-machine choice ("a second machine
doubles the Chromium memory bill for nothing"), which was a reasonable call, but it is why one hung
job stops all work.

### 5.4 The UI's "1 in progress"

`App.tsx:906, 965` — `pending.length` counting `scan_requests` rows in a non-terminal status. It is
counting this one row. It is an accurate reflection of the table and is not itself a lock.

---

## 6. Runs queued during Phase 0

**None. I queued nothing.**

Phase 0 was entirely read-only and entirely local. It consisted of reading source files under
`apps/`, `packages/`, `supabase/migrations/` and `rules/`; decompressing already-committed artifacts
under `evidence/`; and running throwaway Node scripts in a scratchpad against local JSON. I did not
invoke `bin/scan.ts`, `bin/worker.ts`, or any queue insert, and did not connect to Supabase or Fly
at any point before this investigation.

Confirmed against the database rather than left as an assertion:

- `scan_requests`, all time: **10 `done`, 1 `running`. 11 rows total.**
- `scan_requests` created in the last 24 hours: **exactly one** — request `5ccd3051`, the
  comopeptides row.
- `requested_by` on that row is `0c176a82-bedd-4f66-9422-f328d92b822c`, which is the sole analyst
  in the table, `frankt@gomintro.com`.

There is no request I could have created, and no second in-flight job. **Worker contention from
Phase 0 is excluded as a cause.** The worker was idle from its 09:49 ET boot until it claimed this
request at 13:37:55 ET — the log shows `polling for scan requests` at 09:49:55 and nothing at all
until the comopeptides line.

---

## Summary

| Question | Answer |
|---|---|
| DB state | `scan_requests.status = 'running'`, `run_id` null, `error` null, `finished_at` null, `claimed_at` 13:37:55 ET unchanged |
| Persisted results | **None** — no run, no merchant, no findings, no evidence rows, no storage objects |
| What the UI shows | The `progress` free-text column, not findings |
| How far it got | Layers 0–3 complete **in memory**; ~10 pages rendered; blocked entering the gate rules |
| Why no terminal state | It is hung, not crashed — no exception, so the `catch` that writes `failed` never runs |
| Fly | No OOM, no restart, no stop/start. Same Node process since 09:49:36 ET. `HostStatus: ok` |
| Navigation timeout | 30s renders, 20s probes and checkout flow, 8s/6s `networkidle` waits |
| Run-level timeout | **None.** And several `page.evaluate` / `page.content()` calls in this path are unbounded |
| Terminal failure state | Exists (`failed` on both tables) but is process-dependent; a hang strands the row indefinitely |
| Stale-claim reclaim | Exists, 15 min — but runs inside the blocked loop, so it cannot fire |
| Blocks new runs | **Yes** — one sequential loop, so all scans, PDFs, sends, uploads, exports and notices are stalled |
| Runs I queued | **None**, confirmed against the queue table |

**Not verified, and flagged rather than guessed:** which specific call inside the gate block is
hung. Distinguishing `probePaths` from `runCheckoutFlow`, or naming the exact unbounded await,
would need either a process inspection on the live machine or requests to comopeptides.com while
the run is still in flight against it. I did neither.
