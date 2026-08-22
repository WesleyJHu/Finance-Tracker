# Finance-Tracker — Code Review & Cleanup Plan

_Reviewed at commit `bb9f82a` · ~3,400 LOC · 41 commits_

**All file paths are relative to `finance-app/` unless prefixed otherwise.**

---

## Contents

1. [Summary](#summary)
2. [What is good and should be kept](#what-is-good-and-should-be-kept)
3. [Problems, ranked](#problems-ranked)
   - [P0 — Correctness](#p0--correctness-data-can-silently-go-wrong)
   - [P1 — Architecture & maintainability](#p1--architecture--maintainability)
   - [P2 — Dead code, dead deps, dead assets](#p2--dead-code-dead-deps-dead-assets)
4. [Unplumbed UI inventory](#unplumbed-ui-inventory)
5. [Cleanup plan](#cleanup-plan)
6. [Visual-change risk register](#visual-change-risk-register)
7. [Verification](#verification)

---

## Summary

This is a single-user Next.js 16 + Postgres finance tracker deployed as a Docker container on a home NAS. It tracks per-category monthly spending, income, account balances, a monthly base budget, and auto-applies recurring monthly expenses via cron scripts.

It works, and several of its design decisions are genuinely good — every SQL query is parameterized, the timezone handling solves a real Docker/UTC problem correctly, and the optimistic UI updates make the app feel instant. But it grew feature-by-feature, and the seams show:

- **The money math is implemented six times**, in three files, with formulas that already disagree with each other.
- **`BEGIN`/`COMMIT` are issued on the connection pool rather than a client**, so the transaction routes have no atomicity at all.
- **The cron scripts are not idempotent** — running one twice double-charges an account.
- **The database schema exists nowhere but on the NAS.** A fresh clone cannot be run.
- **`docker-compose.yml` is gitignored**, so the deployment topology — including whether the cron worker even runs — is not in version control.
- **An entire shadcn/ui scaffold is installed and 100% unused**: ~110 lines of CSS tokens, a dark palette, and 7 npm packages that nothing imports.
- **~25 UI elements render but do nothing or display fabricated data** — most notably a six-bar "chart" whose heights are hardcoded.

**At a glance:** 104 `console.*` sites · 20 `any` usages · 21 untyped `res.json()` boundaries · 14 duplicated type declarations · 12 unreferenced SVGs · 7 unused npm packages · 0 tests · 0 shared UI primitives.

**The single highest-value change** is extracting the balance math into one module. **The single most urgent** is fixing the pooled `BEGIN`/`COMMIT`. **The most important for long-term maintainability** is checking in a schema file.

---

## What is good and should be kept

| Choice | Why it's right |
|---|---|
| **Parameterized SQL everywhere** — including the dynamic `SET` builders at `src/app/api/recurring_payments/route.ts:95-153` and `src/app/api/balance_snapshot/route.ts:123-146`, which whitelist column names and pass values as bound params | Zero SQL injection anywhere in the codebase. The strongest single thing in the repo. |
| Next.js App Router with route handlers colocated at `src/app/api/*/route.ts`, and `export const runtime = "nodejs"` declared on all five | Idiomatic; no second service to run on the NAS. `pg` requires the Node runtime, and this is explicit rather than accidental. |
| Half-open date range instead of `EXTRACT()` in `src/app/api/transactions/route.ts:49-54`, with a comment explaining why | Index-friendly. The best SQL in the repo — the scripts should copy **this** pattern, not the reverse. |
| Timezone-aware "today" via `Intl.DateTimeFormat(...).formatToParts()` (`src/app/page.tsx:155-169` and both scripts), plus `tzdata` + `ENV TZ=America/New_York` in the `Dockerfile` | A correct, non-obvious fix for a real Docker/UTC problem. **A refactor must not replace this with `new Date().getMonth()`.** |
| Optimistic local-state patching instead of refetch-everything (`src/app/page.tsx:57-63, 113-147, 533-540`) | The UI feels instant. The pattern is right — only *where the math comes from* is wrong (see P0-8). |
| Defense-in-depth on the credit-account/Income rule — enforced in Add, in Edit, **and** server-side at `src/app/api/transactions/route.ts:125-130` | Correctly does not trust the client. Consolidate the *implementation*, keep the redundancy. |
| `Number()` coercion of `pg` `numeric` values at every boundary | `pg` returns `numeric` as a string to avoid precision loss; this was handled deliberately, not by accident. |
| `Promise.all` in `src/components/SettingsModal.tsx:72-75` · per-modal `loading`/`error` in `src/components/AccountModal.tsx:115-125` · stable `key`s on every list · `stopPropagation` on every modal panel · non-mutating `toReversed()` | The right patterns already exist in-repo — they just weren't applied to `page.tsx`. |
| `htmlFor` ↔ `id` label pairing in `AddTransactionModal`, `EditTransactionModal`, and `CreateAccountModal` | Genuinely correct accessibility. Use these as the template for `SettingsModal`. |
| The visual language — `rounded-3xl` + `shadow-sm` + `border-slate-200` panels, the dark hero card, the sky→cyan progress gradients | Coherent and good-looking. Preserve exactly. |

---

## Problems, ranked

### P0 — Correctness (data can silently go wrong)

#### 1. `BEGIN`/`COMMIT`/`ROLLBACK` are issued on the pool, not a client

`src/app/api/transactions/route.ts:135, 157, 168, 249, 296, 307, 353, 374, 380`

```ts
await pool.query('BEGIN')
const result = await pool.query(`INSERT INTO "transactions" ...`)
const accountUpdate = await pool.query(`UPDATE accounts SET balance = balance + $1 ...`)
await pool.query('COMMIT')
```

`pool.query()` checks out an **arbitrary idle connection for each call**. There is no guarantee that `BEGIN`, the `INSERT`, the balance `UPDATE`, and `COMMIT` land on the same connection.

Consequences:
- **There is no atomicity.** The insert can commit while the balance update fails.
- The `if (accountUpdate.rowCount === 0) { ROLLBACK }` guard at `:152-155` is therefore ineffective.
- A connection can be left `idle in transaction` indefinitely, holding row locks and poisoning the pool until the process restarts.
- `ROLLBACK` fires at `:219, 231, 237` — **before** the `BEGIN` on line 249 — and in `catch` blocks reached when `req.json()` threw. On a shared pool that can roll back a connection another request is mid-transaction on.

**Fix:** one `withTransaction(fn)` helper in `src/lib/db.ts` doing `pool.connect()` → `client.query(...)` → `client.release()` in `finally`.

#### 2. Recurring payments are not idempotent

`scripts/process-recurring-payments.mjs:31`

```js
let isDue = payment.day_of_month === currentDay;
```

There is no record of what has already been applied — no `last_processed_period`, no unique key, no `ON CONFLICT DO NOTHING`. A container restart, a manual `npm run process-recurring`, or a double cron fire on the same day **duplicates the transaction and double-debits the account**.

The insert (`:60`) and the balance update (`:83-86`) aren't wrapped in a transaction at all — not even the broken pooled version.

#### 3. The monthly account reset double-subtracts spending

`scripts/process-monthly-balance-snapshot.mjs:111-154`

`src/app/api/transactions/route.ts:147-150` **already** decrements `accounts.balance` when each transaction is created. This block then sums the same month's non-income transactions and subtracts them again at `:144`:

```js
newBalance = Number(account.balance) - spent;
```

On the 1st at 00:00 the current month is empty, so it usually nets to ~0 — which is why it hasn't been noticed. But `scripts/README.md:47-50` explicitly instructs you to run the script manually, and doing so mid-month **silently corrupts every non-credit account balance**. Running it twice on the 1st after transactions exist double-subtracts again.

Separately, `:141` hard-zeroes accounts whose type matches `'credit'` or `'brokerage'` **exactly**, while the rest of the codebase uses `type.includes('credit')` (`transactions/route.ts:125, 132`; `process-recurring-payments.mjs:73`). An account typed `"Credit Card"` — the literal placeholder text at `src/components/CreateAccountModal.tsx:126` — is treated as credit by the API and **never reset** by this script.

#### 4. The base budget is counted twice

`scripts/process-monthly-balance-snapshot.mjs:68` writes:
```js
const startingBalance = prevEndingBalance + baseBudget;
```

`src/app/page.tsx:264` then computes:
```ts
const budgetCapacity = Number(balanceSnapshot?.starting_balance ?? 0) + Number(monthlyBudget?.base_budget ?? 0);
```

**"Remaining Budget" on the dashboard is inflated by one month's base budget.** The root cause is that nothing documents what `starting_balance` means, and the two writers disagree about it.

#### 5. Read-modify-write on balances races with the API

`scripts/process-recurring-payments.mjs:64-86` and `scripts/process-monthly-balance-snapshot.mjs:147-154` both `SELECT` the balance, compute in JS, then `SET balance = $1` — losing any concurrent write. The API already does this correctly with `SET balance = balance + $1`.

Compounded by `worker.mjs`: the daily job (`0 0 * * *`, `:19`) and the monthly job (`0 0 1 * *`, `:32`) **both fire at midnight on the 1st**, racing over `accounts.balance` with no locking and undefined ordering.

#### 6. The snapshot script crashes on a missing previous snapshot

`scripts/process-monthly-balance-snapshot.mjs:32-34`

```js
const startingBalanceResult = await pool.query(startingBalanceQuery, [prevMonth, prevYear]);
const currentBalance = Number(startingBalanceResult.rows[0].starting_balance) + ...
```

`rows[0]` is `undefined` on the first ever run → `TypeError`. Line 50 then prints *"this might be the first run"* — code that can never be reached, 16 lines after the throw. Bootstrapping the app requires hand-inserting a row in psql.

#### 7. Recurring payments silently skip short months

Same `day_of_month === currentDay` check. A payment set to the 31st never fires in February, April, June, September, or November; 29–30 never fire in February. No clamp-to-last-day logic exists, even though `src/app/api/recurring_payments/route.ts:54` accepts values up to 31.

#### 8. The client re-implements the server's balance math

`src/app/page.tsx:67-111` is a browser-side mirror of the server:

| Client | Server |
|---|---|
| `page.tsx:67-68` `getTransactionDelta` | `transactions/route.ts:133` |
| `page.tsx:73-74` `getTransactionMaxDelta` | `transactions/route.ts:132` |
| `page.tsx:92-94` credit-type max guard | `transactions/route.ts:246-247` |

If either drifts, displayed balances silently diverge from the database until a reload. The API already does `RETURNING *` on the mutated account rows (`:148, 282, 370`) — it just doesn't send them to the client. Returning them lets `page.tsx:67-111` be deleted outright.

#### 9. Deleting an account orphans its data

`src/app/api/accounts/route.ts:150-157` deletes only the `accounts` row. Nothing reassigns or removes that account's `transactions` or `recurring_payments`. Depending on whether a FK exists in the live DB (unverifiable — see P1-28), you get either an FK error or orphan rows that still count toward monthly totals.

#### 10. No uniqueness guard on `monthly_balance_snapshot(month, year)`

`src/app/api/balance_snapshot/route.ts:79-87` inserts with no `ON CONFLICT`, and the script's check-then-insert at `:74-96` is a classic TOCTOU. Two rows for the same month are silently possible, and `src/app/page.tsx:201-202` just takes `snapshotData[0]`.

#### 11. Three coexisting timezone regimes

- `src/app/api/transactions/route.ts:50-51` builds month boundaries with `new Date(year, month-1, 1)` — **Node process local time**. Correct only because the `Dockerfile` pins `TZ`. Change the container TZ and every month boundary shifts.
- Both scripts derive the date with explicit `Intl` + `America/New_York` — the **correct** approach — but `scripts/process-monthly-balance-snapshot.mjs:20` then computes the previous month with `now.getMonth()` in **local time**, four lines after carefully deriving the ET month and year.
- `scripts/process-recurring-payments.mjs:38` dates the created transaction with `now.toISOString()` — **UTC** — after checking due-ness against the **ET** day. Any run after 20:00 ET writes tomorrow's date, landing it in the wrong month on the 30th/31st.
- `src/components/AddTransactionModal.tsx:40` defaults the date field with the same UTC `toISOString()` bug.
- `formatDate` exists twice and the two disagree: `src/app/page.tsx:228-237` sets `timeZone: 'America/New_York'`; `src/components/AccountModal.tsx:76-82` **omits it**. The same transaction can render as two different dates in the table versus the account modal.

#### 12. A balance-snapshot 404 blanks the entire dashboard

`src/app/page.tsx:192-199` throws inside the shared `try`, so a missing snapshot row — very likely on the 1st of a month before cron runs — renders `Error: Failed to fetch balance snapshot` across the whole page, even though accounts and transactions loaded fine.

#### 13. Zero is rejected as a falsy value

`src/app/api/monthly_budgets/route.ts:63` — `if (!month || !base_budget)` rejects a legitimate budget of `$0`, permanently. Same class of bug at `src/app/api/recurring_payments/route.ts:38`.

#### 14. `transactions` GET has no `ORDER BY` and no `LIMIT`

`src/app/api/transactions/route.ts:24` — row order is unspecified Postgres heap order. `src/app/page.tsx:486` calls `.toReversed()` on it, so "Latest activity" is really reverse-insertion-order: editing a transaction's date does **not** move its row. The result set is also unbounded, with no pagination anywhere.

#### 15. Money round-trips through JS floats

`numeric` in the database is the right call, but every consumer immediately does `Number(row.amount)` (`accounts/route.ts:19-20`, `transactions/route.ts:69`, `process-monthly-balance-snapshot.mjs:34, 62, 144`, plus every frontend `reduce`). Cosmetic per transaction, but `starting_balance` accumulates month over month, so the error compounds.

#### 16. Raw driver errors leak to the client

`src/app/api/transactions/route.ts:176` returns `{ error: error.message }` — inconsistent with its own PATCH/DELETE (`:312, 386`), which return a generic string.

---

### P1 — Architecture & maintainability

#### 17. The balance formula is implemented six times

`transactions/route.ts:132-133` (POST) · `:244-247` (PATCH) · `:337, 349-351` (DELETE) · `scripts/process-recurring-payments.mjs:73-80` · `page.tsx:67-74` · and the credit guard again at `page.tsx:92-94`.

They already disagree — the script computes `maxDelta` and then conditionally applies it, whereas the route folds the credit check into the expression. **This is the highest-value refactor in the codebase.**

#### 18. Every helper is duplicated

| Helper | Copies | Locations |
|---|---|---|
| `formatCurrency` | **4** | `page.tsx:222` · `AccountCard.tsx:31` · `AccountModal.tsx:70` · `SettingsModal.tsx:222` |
| `isCreditAccountType` | **6** | `page.tsx:70` · `CreateAccountModal.tsx:21` · `EditAccountModal.tsx:33` · inline at `AddTransactionModal.tsx:55` and `EditTransactionModal.tsx:74` · server-side at `transactions/route.ts:125` |
| `formatDate` | **2, and they disagree** | `page.tsx:228` (with TZ) · `AccountModal.tsx:76` (without) |
| `categories` array | **3** | `AddTransactionModal.tsx:24-33` · `EditTransactionModal.tsx:27-36` · `SettingsModal.tsx:40-49` |
| `'income'` magic string | **12+** | `page.tsx:68, 74, 245, 248, 252, 501, 502` · `AccountModal.tsx:85` · `AddTransactionModal.tsx:57, 61, 75` · `EditTransactionModal.tsx:85` |
| `'America/New_York'` | **2** | `page.tsx:157, 231` — and missing from `AccountModal.tsx:77` where it belongs |
| Credit sign-flip `-Math.abs(...)` | **2** | `CreateAccountModal.tsx:33` · `EditAccountModal.tsx:45` |

#### 19. Category casing is split across two conventions

`transactions.category` is stored **lowercase** (`AddTransactionModal.tsx:108`, `process-recurring-payments.mjs:41`). `recurring_payments.category` is stored **Title Case** (`SettingsModal.tsx:372` passes the raw dropdown value). `formatCategoryName` (`EditTransactionModal.tsx:38`) exists solely to paper over the mismatch on display.

The system currently works only because the normalization happens to be applied at the two right call sites. It is one careless edit away from breaking the snapshot script's `WHERE category = 'income'` filters.

#### 20. The `max` column is overloaded

For credit accounts it's the credit limit. For bank accounts, `transactions/route.ts:132` **increments** it with income — so `AccountCard.tsx:59`'s "N% limit used" is meaningless there. `src/types/card.ts` then renames the same two columns a third way (`limit`/`value`). This is the most confusing thing in the data model.

#### 21. `account.type` is free text

`src/components/CreateAccountModal.tsx:118-129` is a plain text input with the placeholder `"e.g., Credit Card, Checking"`. Six code paths branch on its string contents using two different matching rules (see P0-3). It should be a `<select>` backed by one constant.

#### 22. Domain types are re-declared 14 times across 7 files

| Interface | Re-declared at |
|---|---|
| `Transaction` | `page.tsx:18-25` · `AccountModal.tsx:5-13` (adds a `merchant` field the backend never returns) · `AddTransactionModal.tsx:14-21` · `EditTransactionModal.tsx:11-18` — **4 copies, 3 subtly different** |
| `Account` | `page.tsx:10-16` · `SettingsModal.tsx:22-28` · `AddTransactionModal.tsx:5-9` · `EditTransactionModal.tsx:5-9` — **4 copies** |
| `MonthlyBudget` | `page.tsx:27-33` · `SettingsModal.tsx:5-11` — **2 identical copies** |
| Account-update payload `{ id; name; type; balance; max? }` | `page.tsx:57` · `types/card.ts:9` · `AccountCard.tsx:25` · `EditAccountModal.tsx:12` — **4 copies** |

Meanwhile `src/types/transaction.ts` — the one shared type file — declares `merchant: string` and `accountId: string`, neither of which the API returns, and is **imported by nobody**.

All 21 `await res.json()` call sites are implicitly `any`. `page.tsx:174`'s `.map((account: Account) => …)` is a **cast, not a check** — it annotates the callback parameter of an `any[]`, which is false confidence. The routes define request-body types (`TransactionBody`, `AccountBody`, …) but no response types, and none are shared with the client.

**`any` count: 20** — 19 in route handlers (`values: any[]` ×3, `catch (error: any)` ×16) and one at `page.tsx:239`, which is precisely at the API boundary where a type would matter most.

#### 23. Two near-identical modal pairs plus a 7×-duplicated shell

- `CreateAccountModal` (186 lines) vs `EditAccountModal` (231) — **~80% identical**. The parse-and-validate block (`Create:33-42` ≡ `Edit:45-54`) is character-for-character the same, including the credit sign flip.
- `AddTransactionModal` (270) vs `EditTransactionModal` (274) — **~85% identical**. The categories array, the no-`accountId` effect, the validation preamble, the entire modal shell, and all five form fields are duplicated; only the `id` prefixes differ.

Repeated markup:

| String | Count |
|---|---|
| `fixed inset-0 bg-black/50 flex items-center justify-center z-50` | **7** |
| `w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 …` | **17** |
| `block text-sm font-medium text-gray-700 mb-1` | **17** |
| The modal header block (`flex items-start justify-between mb-6` + `h2` + `p` + Close) | **6** |
| `bg-white rounded-lg p-6 w-[90vw] max-w-md` | **4** |
| `rounded-3xl bg-white p-6 shadow-sm border border-slate-200` | **6** |

**~470 lines removable** without changing a pixel.

#### 24. `page.tsx` fetches four independent endpoints serially

`src/app/page.tsx:171-203` — `accounts` → `transactions` → `monthly_budgets` → `balance_snapshot`, each `await`ed in turn. **None depend on each other.** This is a pure four-request waterfall, and `SettingsModal.tsx:72-75` already demonstrates the correct `Promise.all` pattern.

#### 25. `SettingsModal` changes never reach the dashboard

It receives only `onClose` and `accounts` (`:30-33`). After editing this month's budget and closing, the dashboard's Remaining Budget, spending progress bar, and base-budget footer stay stale until a full page reload. No `onSaved` callback, no refetch.

#### 26. ~20 near-identical route bodies

Every handler repeats:
- `catch (error: any)` followed by 3–4 `console.error` calls of the same object — **~15 sites**
- ad-hoc month/year parsing and validation — **3 sites**
- row `Number()` serialization — **6 sites**
- `if (!x) return 400 "X required"` — **~15 sites**

Inconsistencies to unify:
- **DELETE argument style:** `accounts` and `transactions` read `id` from the **JSON body**; `recurring_payments` reads it from the **query string**.
- **Validation philosophy:** `balance_snapshot` uses `typeof x !== "number"`; `accounts` uses `Number()` + `isNaN`; `recurring_payments` uses bare falsy checks.
- **Error shape:** `accounts` returns a generic string; `transactions` POST leaks the driver message.
- **Missing verbs:** `monthly_budgets` has no `POST` and no `DELETE`, so the 12 budget rows must be inserted by hand in psql.
- **`monthly_budgets` is keyed on `month` alone** (`:35, 81`) — no `year`. Budgets are 12 reusable rows shared across every year, and `page.tsx:29` declares a `year` field that is never used. Defensible for a personal app, but it should be a documented decision.

#### 27. Duplicated and broken DB bootstrap

`src/lib/db.ts` and `scripts/db.mjs` create two separate pools.

`scripts/db.mjs:2` loads `../.env` — **a file that does not exist**. The only env file in the tree is `finance-app/.env.local`. Unless one is created out-of-band on the NAS, `DATABASE_URL` is `undefined` and `pg` throws `client password must be a string` — which is exactly what commit `de73246 "fixed password error"` was chasing. That fix repointed the path rather than resolving the mismatch, so the bug is still latent.

`new URL(...).pathname` also yields a broken `/C:/Users/...` path on Windows, which `dotenv` fails to open silently. Use `fileURLToPath()`.

Neither pool sets `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `statement_timeout`, or an `on('error')` handler — an idle-client error will crash the Next server process. `src/lib/db.ts` has no `globalThis` caching, so `next dev` HMR leaks a new `Pool` per reload.

#### 28. No schema, no migrations, no seed anywhere in the repo

There is no `.sql` file, no ORM, no `migrations/` directory. The five tables — `accounts`, `transactions`, `monthly_budgets`, `monthly_balance_snapshot`, `recurring_payments` — exist only inside the Postgres instance on the NAS.

A fresh clone plus `docker build` produces an app that 500s on every route. **This is the biggest single obstacle to maintainability**, and it blocks any integration test from ever being written.

#### 29. `docker-compose.yml` is gitignored

The root `.gitignore` ends with:
```
#dockerfiles
Dockerfile
docker-compose.yml
docker/
finance-app/docker-compose.yml
```

So the single most important deployment artifact — the one defining the Postgres service, the volume mount for `/var/lib/postgresql/data`, the restart policy, and *whether the cron worker runs at all* — is **not in version control**. Combined with P1-28, a NAS disk failure means you lose the compose file, the schema, and therefore the ability to rebuild this app.

The `Dockerfile` line is also inert and misleading: `finance-app/Dockerfile` is already tracked, so the ignore rule does nothing.

#### 30. `worker.mjs` is never started by the Dockerfile

`Dockerfile:23` is `CMD ["npm", "start"]` — Next only. Either the gitignored compose file adds a second service, or **the cron jobs are not running in production at all.** This needs verifying and then making explicit in the repo.

Other `worker.mjs` problems:
- `:22, 35` use **relative script paths** (`"./scripts/..."`), so it only works if CWD is `finance-app/`.
- `:6` uses `exec` with a shell string and default 1 MB `maxBuffer`; these scripts log per-account, so a large account list can `ENOBUFS` and be reported as a failure.
- **`stderr` is captured and discarded** (`:6`) — script warnings vanish.
- `scripts/process-recurring-payments.mjs:110-115` swallows its top-level error, so `.then()` runs and the process **exits 0 even on total failure**. The worker can never observe a failure. (`process-monthly-balance-snapshot.mjs:165` correctly rethrows.)
- **A missed midnight is a lost period.** If the NAS is rebooting at 00:00 on the 1st, the snapshot is simply skipped — there is no watermark and no catch-up.

#### 31. `.dockerignore` does not exclude `.env*`

It lists only `node_modules .next .git Dockerfile docker-compose.yml npm-debug.log`. Combined with `COPY . .` (`Dockerfile:17`), **any `.env`/`.env.local` in the build context is baked into an image layer** and readable by anyone with the image.

Right now this is arguably load-bearing, because `scripts/db.mjs` reads `.env` off disk rather than from the process environment — which is precisely the wrong reason to ship secrets in an image. The fix is to delete the `dotenv.config` call, pass `DATABASE_URL` as a compose environment variable, and add `.env*` here.

**On the positive side:** `finance-app/.env.local` is **not** tracked by git, is correctly covered by both `.gitignore` files, and contains only `DATABASE_URL`. There are no API keys or third-party credentials anywhere in the repo.

#### 32. No authentication of any kind

Grepping `src/` for `password|auth|token|secret|session|cookie|middleware` returns **zero matches**. There is no `middleware.ts`. Every route is a fully open, unauthenticated CRUD surface — anyone who can reach port 3000 can read your finances, insert transactions, or `DELETE /api/accounts`.

On a NAS this is usually "only on my LAN", which is a real but weak boundary (IoT devices, guests, a misconfigured port-forward, UPnP). Minimum viable fix: a `middleware.ts` checking a shared secret against an env var, or the NAS reverse proxy's basic auth. **Do not expose this to the internet as-is.**

Note: commit `de73246 "fixed password error"` is *not* about app auth — it touches only the Postgres connection string (see P1-27).

#### 33. The scripts are never type-checked

`tsconfig.json` includes `**/*.mts` but there are no `.mts` files — the scripts are `.mjs`, which falls outside every `include` glob. So `worker.mjs` and both scripts are never type-checked or linted, which is exactly where the worst bugs live.

---

### P2 — Dead code, dead deps, dead assets

**Dead files**

| File | Why |
|---|---|
| `../package.json` and `../package-lock.json` (repo root) | A stray `node-cron` install at the repo root. `finance-app` already depends on it. |
| `src/lib/utils.ts` | Exports `cn()`. **Imported by nothing.** |
| `src/types/transaction.ts` | **Imported by nothing**, and its shape is wrong (`merchant`, `accountId`). |
| `global.d.ts` | 23 bytes: `declare module '*.css';`. Unnecessary in Next 16. |
| `components.json` | shadcn config pointing at `@/components/ui` and `@/hooks`. **Neither directory exists**; no shadcn component was ever installed. |

**Dead dependencies** — verified by grepping `src/`, `scripts/`, and `worker.mjs`:

| Package | Status |
|---|---|
| `class-variance-authority` | Zero references |
| `lucide-react` | Zero references — every icon is a raw `<img src="/*.svg">` |
| `uuid` | Zero references — IDs come from Postgres |
| `tsx` (dev) | Unused — scripts run as plain `node *.mjs` |
| `clsx`, `tailwind-merge` | Exist only to serve the unused `cn()` |
| `tw-animate-css` | Imported in `globals.css:2` but no animation utility is used anywhere |
| `postcss` | In `dependencies`; should be `devDependencies` |

**Dead CSS (~110 lines)** — `src/app/globals.css:6-116` is the complete shadcn token layer: `--primary`, `--card`, `--popover-*`, `--sidebar-*`, `--chart-1..5`, plus a full `.dark` palette. Nothing in the app uses `bg-primary`, `text-foreground`, or `bg-card`; every color is a hardcoded `slate`/`sky` Tailwind class. `.dark` is never applied to any element — there is no theme toggle, no `next-themes`, no `prefers-color-scheme` handling. And `@apply bg-background text-foreground` on `body` (`:122-124`) is immediately overridden by `<main className="min-h-screen bg-slate-50">` (`page.tsx:290`).

> ⚠️ The `@layer base` block at `:118-125` **is** live — `* { @apply border-border outline-ring/50 }` sets a default border color. Trim the tokens but keep what that rule needs, or inline the two declarations, and verify borders visually.

**Dead assets (12 files)**

- create-next-app template leftovers: `public/{file,globe,next,vercel,window}.svg`
- Card-brand icons for a feature that was never built: `public/{amex,bank,credit_card,discover,mastercard,paypal,visa}.svg`. `AccountCard.tsx` renders zero icons.

The eight category SVGs **are** used, dynamically, via `` src={`/${transaction.category.toLowerCase()}.svg`} `` (`page.tsx:491`) — which is why they can't be statically detected, and which also means any unlisted category (including the `'Uncategorized'` fallback at `:253`) renders a broken-image icon with no `onError` handler.

**Broken asset reference** — `src/app/layout.tsx:20` points the favicon at `/building-columns-solid.png`, **which does not exist in `public/`**. A guaranteed 404 on every page load; the intended favicon never appears.

**Dead API surface** — `src/app/api/balance_snapshot/route.ts:59-167` (`POST` and `PATCH`) has no caller anywhere in the app or scripts. The snapshot script writes those rows with its own inline SQL. Two write paths, one unused.

**Dead code**

| Location | What |
|---|---|
| `AddTransactionModal.tsx:91-94` | Unreachable `if (!accountId)` branch — `:70-73` already returned |
| `EditTransactionModal.tsx:59-65` | Redundant reset effect; the `useState` initializers at `:47-55` already do it, and this would discard in-progress edits |
| `AccountCard.tsx:76-77` | `onDelete` wrapped in `(id) => onDelete?.(id)` for no reason |
| `types/card.ts:7-8` | `size` / `strokeWidth` — never passed, never read |
| `page.tsx:32` / `SettingsModal.tsx:10` | `MonthlyBudget.spent` — declared twice, read zero times |
| `page.tsx:29` | `MonthlyBudget.year` — declared, never read, and the API has no year filter |
| `page.tsx:35-41` | `BalanceSnapshot.id`, `.month`, `.year`, `.ending_balance` — only `starting_balance` is ever used |
| `AccountModal.tsx:12, 143` | `merchant?: string` and its render branch — no such column exists |
| `process-recurring-payments.mjs:17` | `currentMonth` — computed, never used |
| `process-monthly-balance-snapshot.mjs:85, 94` | `updateCurrentResult` / `insertResult` — assigned, never used |
| `process-monthly-balance-snapshot.mjs:180` | `export { processMonthlyBalanceSnapshot }` — the module self-executes at `:170` and calls `process.exit`, so it can never be imported |
| `recurring_payments/route.ts:15` | Unused `req` parameter on `GET` |

**Debug noise** — 104 `console.*` sites. Every catch block logs the same error 3–4× (`console.error(error); console.error(error.message); console.error(error.detail)`). Success paths log full transaction rows including amounts and descriptions (`transactions/route.ts:163, 303, 376`). `process-recurring-payments.mjs:92-104` still has a box-drawing `PAYMENT DEBUG` block. `page.tsx:535` ships a `console.debug`.

**`useEffect` issues** — `AddTransactionModal.tsx:60-64` reads `category` and `availableCategories` but declares neither in its dependency array. No `AbortController` in any fetch effect.

**Documentation drift**

- `scripts/README.md:58-61, 110-111` documents **weekly and yearly** recurrence rules, with `day_of_month` reinterpreted as day-of-week. **No such code exists** — `process-recurring-payments.mjs:31` only handles monthly.
- `scripts/README.md:38-41, 93-95` recommends PM2. This advice is actively harmful: `pm2 start npm -- run process-monthly-snapshot` puts a one-shot script under a supervisor that **restarts it on exit**, producing an infinite loop of monthly snapshots.
- The README also documents crontab and Windows Task Scheduler setups, while the actual scheduler is `worker.mjs`. Three competing, partially contradictory mechanisms are described.
- `finance-app/README.md` is 100% untouched create-next-app boilerplate, including "Deploy on Vercel". This app deploys to a NAS via Docker.

---

## Unplumbed UI inventory

Elements that render but do nothing, or display fabricated data.

| # | Location | What the user sees | Reality |
|---|---|---|---|
| U1 | `page.tsx:460-462` | **"Filter"** button in Transaction History | No `onClick`, no `type`, no state, no handler anywhere. 100% inert. |
| U2 | `page.tsx:293` | **"Home"**, styled as a nav item beside the working Settings button | A `<span>` with no href and no handler. A dead nav slot implying pages that don't exist. |
| U3 | `page.tsx:371-378` | A 6-bar chart in the Total Monthly Spending card | **Hardcoded height ladder** (`index === 5 ? 'h-40' : … 'h-20'`), no data binding. Reads as a 6-month spending trend; it is decoration. **The most misleading element in the app.** |
| U4 | `page.tsx:418` | **"Stable"** badge on Monthly Net Income | Hardcoded string. Always says "Stable". |
| U5 | `page.tsx:389` | **"Updated"** badge on Remaining Budget | Only means a budget row was returned. |
| U6 | `page.tsx:412, 416` | **"Monthly Net Income"** / **"Savings rate"** | The value is `formatCurrency(totalIncome)` — gross income in dollars. Neither net, nor a rate. |
| U7 | `page.tsx:322-328` and `:352-359` | **"Link New Account"**, rendered twice ~25 lines apart | Both open a manual name/type/balance form. "Link" implies Plaid-style institution linking that doesn't exist. Also duplicated markup. |
| U8 | `page.tsx:379` | "Daily average" | Divides by `day`, which stays at its initial `1` if the fetch throws — displaying the whole month's spend as a daily average. |
| U9 | `AccountModal.tsx:104` | **"All transactions for this account"** | Current month only (`:36-58`). |
| U10 | `AccountModal.tsx:38-41` | Sends `month`/`year` to `/api/transactions` | The API **ignores them** when `account` is set (`transactions/route.ts:28-31`), returns the account's entire history, and the client re-filters in browser-local time. Commit `288e96e` fixed the symptom in the wrong layer. |
| U11 | `AccountModal.tsx:143` | `tx.merchant` | No such column exists in the backend. Permanently `undefined`. |
| U12 | `SettingsModal.tsx:262-268` | Budget inputs for all 12 months | **Frozen for any month with no DB row.** `handleBudgetChange` (`:96-100`) maps over existing budgets only, so the input accepts keystrokes then snaps back to `0`. |
| U13 | `SettingsModal.tsx:273-279` | **"Save Budgets"** | Fires 12 PATCHes and **never checks `res.ok`** — the 404 for a missing month is swallowed. No success or error state. Combined with P0-13, "set this month to $0" fails silently forever. |
| U14 | `SettingsModal.tsx:335, 347, 356, 371, 386` | `required` on 5 recurring-payment fields | **Inert** — they're not inside a `<form>`; "Add" is a bare `onClick`. Empty amount → `Number('')` → `0` → backend 400 → `alert()`. |
| U15 | `SettingsModal.tsx` (whole component) | Settings edits | Never propagate to the dashboard. See P1-25. |
| U16 | `AddTransactionModal.tsx:173`, `EditAccountModal.tsx:172, 187`, `SettingsModal.tsx:264, 334` | Money inputs | `step="1.00"` makes any value with cents **fail browser validation** — you cannot enter `$12.50`. `EditTransactionModal.tsx:178` and `CreateAccountModal.tsx:136` use `step="0.01"`, so you can *edit* a transaction to $12.50 but not *create* one. |
| U17 | `EditAccountModal.tsx:166-192` | Two inputs both `id="account-max"` / `htmlFor="account-max"` | Invalid HTML, and **clicking the "Max" label focuses the Balance field**. |
| U18 | `EditAccountModal.tsx:88-111` and `page.tsx:513-519` | Delete account / delete transaction | No confirmation — while `SettingsModal.tsx:192` *does* confirm for recurring payments. Three delete affordances, three behaviours; the most destructive one has the least protection. |
| U19 | `EditTransactionModal.tsx:213` | Income option `disabled` on a credit account | It can still be the **selected** value, so the user sees it greyed-but-selected and only learns it's invalid on Save. `AddTransactionModal.tsx:56-64` handles the same rule correctly by removing the option and auto-switching. |
| U20 | `AccountCard.tsx:39` | The whole account card is clickable | `<div onClick>` — not focusable, no `role`, no `tabIndex`, no key handler. **The primary way to view an account's transactions is unreachable by keyboard.** The worst accessibility defect in the app. |
| U21 | `AccountCard.tsx:59` | **"N% limit used"** | Meaningless for non-credit accounts, where `max` grows with income (P1-20). |
| U22 | `AddTransactionModal.tsx:91-94` | `"Please select an account…"` | Unreachable — `!accountId` already returned at `:70-73`. |
| U23 | `CreateAccountModal.tsx:17` | Max Limit pre-filled with **`6500`** | A personal magic number presented as a universal default. |
| U24 | `EditTransactionModal.tsx:261` | Save button is `bg-blue-600` | The only blue primary button in the app; everything else is `bg-slate-900`. |
| U25 | `SettingsModal.tsx:259, 331, 342, 354, 368, 382` | Six form labels | No `htmlFor`, and the inputs have no `id`. Screen readers announce them unlabeled. |
| U26 | `layout.tsx:20` | Favicon | Points at a file that doesn't exist. |

**Across all six modals:** no `role="dialog"` / `aria-modal`, no focus trap, no Escape-to-close (there is not a single `keydown` listener in the codebase), no focus restore on close, no scroll lock. The backdrop is a `<div onClick>` with no keyboard equivalent. `SettingsModal` uses `alert()` for six error paths while every other component renders inline red text.

**Styling inconsistencies that are currently visible:** `gray-*` in the four form modals vs `slate-*` in `page.tsx`/`SettingsModal`; three different danger treatments (`rose`, `red-600`, `red-100`); six corner radii with no scale (`full`, `3xl`, `2xl`, `xl`, `lg`, `md`); two progress gradients (`from-sky-500` vs `from-blue-600`); three focus-ring treatments including none.

---

## Cleanup plan

Phased. Each phase ends compiling and manually verifiable. **No phase changes rendered markup** except the explicitly-labelled decisions in Phase 5.

### Phase 1 — Capture the schema and the deployment

Unblocks everything else.

- **`db/schema.sql`** — DDL for all five tables, reverse-engineered from the SQL in the routes and scripts. Ships with a header marking it **UNVERIFIED — diff against `\d` on the live DB before trusting it**. Money columns `numeric(12,2)`. Add the FK `transactions.account_id → accounts.id` with an explicit `ON DELETE` policy, and `UNIQUE (month, year)` on `monthly_balance_snapshot`.
  - Known unknowns to confirm on the NAS: the `id` column type (uuid vs serial), whether `transactions.created_at` and `recurring_payments.updated_at` have defaults, and whether any FK already exists.
- **`db/seed.sql`** — the 12 `monthly_budgets` rows and a bootstrap `monthly_balance_snapshot`.
- **`.env.example`** with `DATABASE_URL=`.
- **Un-ignore and commit `docker-compose.yml`** (secrets stay in `.env`): the Postgres service, a named volume for `/var/lib/postgresql/data`, a restart policy, and an explicit `worker` service.
- Remove the inert `Dockerfile` line from the root `.gitignore`; add `.env*` to `.dockerignore`.

### Phase 2 — Fix P0 correctness

- `src/lib/db.ts`: a `globalThis`-cached pool with `max`, timeouts, and an `on('error')` handler, plus **`withTransaction(fn)`** using `pool.connect()` → `client.query` → `release()` in `finally`. Rewrite the three mutating handlers in `transactions/route.ts` on top of it and delete the pre-`BEGIN` `ROLLBACK`s.
- Rewrite both scripts: import the shared `withTransaction`; use relative balance updates (`SET balance = balance + $1`); add idempotency (a unique index on the generated transaction plus `ON CONFLICT DO NOTHING`, or a `last_applied_period` column); clamp `day_of_month` to the month length; guard the missing-previous-snapshot case; drop the early `return` that skips the account-reset half; derive **all** dates from one ET helper.
- Decide and fix the account-reset semantics — previous month, consistent `type` matching (P0-3).
- Resolve the `starting_balance` double-count: define the term once, then fix either the script or `page.tsx:264` (P0-4).
- Serialize the two cron jobs so they can't race on the 1st; make `process-recurring-payments.mjs` rethrow so it exits non-zero.
- `transactions` GET: add `ORDER BY date DESC, created_at DESC` and honour `month`/`year` alongside `account`.
- Return the mutated account row from the transaction routes so `page.tsx:67-111` can be deleted (P0-8).
- Make the balance-snapshot fetch non-fatal (P0-12); fix the falsy-zero rejections; stop returning `error.message` to clients; add `.mjs` to `tsconfig.json` includes.

### Phase 3 — Extract shared logic (zero visual change)

New modules under `src/lib/`:

| Module | Contents | Replaces |
|---|---|---|
| `accounting.ts` | `transactionDeltas(category, accountType, amount)`, `isCreditAccount(type)` | All six copies of the balance math and all six `isCreditAccountType` |
| `categories.ts` | `CATEGORIES`, `INCOME`, `normalizeCategory`, `displayCategory`, `categoryIcon()` with a fallback | Three category arrays, 12+ `'income'` literals, `formatCategoryName` |
| `format.ts` | `formatCurrency`, `formatDate`, `formatLongDate`, one `APP_TZ` constant | Four `formatCurrency`, two divergent `formatDate` |
| `accountTypes.ts` | The allowed account types | Free-text `type` input (P1-21) |
| `dates.ts` | `todayInAppTz()`, `previousMonth()`, `daysInMonth()` | Three timezone regimes |
| `api.ts` | `handleRouteError(e, ctx)`, `parseMonthYear()`, `buildUpdate()`, row serializers | ~15 catch blocks, 3 param parsers, 6 serializers; unifies DELETE on the query string |
| `src/types/api.ts` | `Account`, `Transaction`, `MonthlyBudget`, `BalanceSnapshot`, `RecurringPayment` + request-body types, shared by routes *and* components | The 14 re-declarations, `src/types/transaction.ts`, `card.ts`, all 20 `any`s, the 21 untyped `res.json()` boundaries |

### Phase 4 — Component consolidation (identical markup)

- **`src/components/Modal.tsx`** — the shared overlay shell with `size` / `radius` / `closeLabel` props so all three existing widths and `SettingsModal`'s `×` are preserved exactly. Adding `role="dialog"`, a focus trap, Escape-to-close, scroll lock, and focus restore *inside* it fixes all six modals at once with zero call-site markup churn.
- **`TransactionFormModal`** (Add ∪ Edit, `mode: "create" | "edit"`) and **`AccountFormModal`** (Create ∪ Edit), each backed by one form hook. Keep a `variant` escape hatch so `EditTransactionModal`'s `bg-blue-600` survives.
- **`ProgressBar`** — three identical copies (`page.tsx:397, 440`, `AccountCard.tsx:54`); keep a `gradient` prop so `AccountCard`'s `from-blue-600` is preserved.
- **`src/hooks/useDashboardData.ts`** — lift `page.tsx:149-213` out and run the four fetches with `Promise.all`. `page.tsx` should drop from 568 to ~300 lines.
- Add an `onSaved` callback to `SettingsModal` so budget edits refresh the dashboard (P1-25).
- `AccountCard`: drop the mirrored `accountName` / `accountType` state; render from props.

Expected: roughly **−470 lines with identical rendered output**.

### Phase 5 — Delete dead code, wire up the dead UI

**Delete**

- Repo-root `package.json` and `package-lock.json`; `src/types/transaction.ts`; `global.d.ts`; `balance_snapshot` POST/PATCH; the 12 unused SVGs; every dead variable and unreachable branch listed above; the triple `console.error`s; the success-path row logs; the `PAYMENT DEBUG` block; `page.tsx:535`'s `console.debug`.
- **The entire shadcn scaffold**, since nothing uses it: `components.json`, `src/lib/utils.ts`, `globals.css:2` (`tw-animate-css`), `:4` (`@custom-variant dark`), `:6-116` (the token layer and `.dark` palette). Then `npm uninstall class-variance-authority lucide-react clsx tailwind-merge tw-animate-css uuid tsx`, and move `postcss` to devDependencies. Keep whatever `@layer base` (`:118-125`) still needs — either inline those two rules or drop the block and confirm default borders are unchanged. **~110 lines of CSS and 7 packages gone with zero visual change** (verify with a before/after screenshot anyway).
- Fix the favicon reference. Replace `alert()` / `confirm()` with the inline error UI the other modals already use.
- Rewrite `scripts/README.md` — monthly only, scheduled by `worker.mjs`; **delete the PM2 advice and the fictional weekly/yearly docs**. Rewrite `finance-app/README.md` with real setup instructions: schema, `DATABASE_URL`, the worker, and the bootstrap snapshot row.

**Wire up the dead UI — nothing is removed**

Every element keeps its exact position, size, and styling; only its data and text become truthful, so no gaps appear in the layout.

| Element | Fix |
|---|---|
| **"Filter"** (U1) | A working category/account filter. The transaction list is already fully client-side, so this is ~20 lines of state plus a dropdown rendered from the existing button. |
| **6-bar chart** (U3) | Feed it the last 6 months of expense totals. Same six `<div>`s, same `bg-slate-800`, same rounded corners — the `h-20…h-40` ladder becomes a computed height, with the max pinned to the current `h-40`. Needs one new endpoint (`GET /api/transactions/monthly_totals?months=6`). |
| **"Home"** (U2) | A real `<Link href="/">` with `aria-current`, matching the adjacent Settings button's markup. |
| **"Stable"** (U4) | Compute it — this month's income vs. last month's: `Up` / `Down` / `Stable`. Same emerald pill. |
| **"Updated"** (U5) | Show the budget's actual state. |
| **"Savings rate"** (U6) | Compute the real rate `(income − expenses) / income`, and align the card heading with whichever figure it displays. |
| **"Daily average"** (U8) | Guard the `day = 1` fallback so a failed fetch can't display the month's whole spend as a daily figure. |
| **"N% limit used"** (U21) | Show it only for credit accounts; for bank accounts show the meaningful equivalent in the same bar and caption slot. |
| **Category icon** | Add an `onError` fallback so an unlisted category doesn't render a broken image. |
| **"Link New Account"** ×2 (U7) | Rename to "Add Account" — text only. |
| **AccountModal subtitle** (U9, U10) | "Transactions this month"; drop the client-side re-filter once the API honours `month`/`year`. |
| **Settings budgets** (U12, U13, U14) | Add `POST /api/monthly_budgets` (or `INSERT … ON CONFLICT`) so untouched months can be created; check `res.ok`; show a save result; wrap the recurring editor in a real `<form>` so its `required` attributes work. |
| **Money inputs** (U16) | `step="1.00"` → `step="0.01"` on all five. |
| **Remaining** | Fix `EditAccountModal`'s duplicate `id` (U17); add delete confirmations (U18); add `htmlFor`/`id` to `SettingsModal`'s six labels (U25); make Income-on-credit behave identically in both transaction modals (U19); move the `6500` default out of the component (U23). |

### Phase 6 — Minimum safety net

Don't build a test pyramid. Build exactly the tests that protect against the P0 bugs.

**Tier 1 — pure unit tests, no DB** (all pure functions after Phase 3):
- `transactionDeltas` over every category × account-type combination — the function currently miscopied in six places.
- `daysInMonth` clamp — catches the 31st-in-February bug.
- `previousMonth` across the Dec→Jan rollover — catches the local-time bug at `process-monthly-balance-snapshot.mjs:20`.
- The snapshot starting-balance calculation.

**Tier 2 — integration against a throwaway Postgres** seeded from `db/schema.sql`:
- POST a transaction, assert **both** writes land; then force the account `UPDATE` to fail and assert **nothing** was written. *(Proves P0-1.)*
- Run `process-recurring-payments` twice on the same day → exactly one transaction, one balance delta. *(Proves P0-2.)*
- Run `process-monthly-balance-snapshot` twice → account balances unchanged by the second run. *(Proves P0-3.)*
- Run the snapshot against an empty DB → a clean error, not a `TypeError`. *(Proves P0-6.)*

Add `npm run typecheck` (`tsc --noEmit`) and wire `lint` + `typecheck` into a pre-deploy step.

### Phase 7 — Docker hardening

Multi-stage `Dockerfile`, `output: "standalone"` in `next.config.ts` (currently the empty create-next-app stub), `npm ci` instead of `npm install`, explicit `NODE_ENV=production`, non-root `USER node`, `EXPOSE`, `HEALTHCHECK`, and a start path that actually runs `worker.mjs`. Image should drop from roughly 1.2 GB to ~200 MB — meaningful on a NAS.

### Phase 8 (optional) — Auth

A `src/middleware.ts` checking a shared secret from an env var, or an explicit statement in the README that the app is LAN-only and must never be port-forwarded.

---

## Visual-change risk register

The binding constraint is that the UI must look the same.

**Safe — no pixels move:** `Promise.all` on the dashboard fetches · every `src/lib` extraction · type unification · deleting unused SVGs, CSS, and dependencies · dead-variable removal · `withTransaction` · every script fix.

**Needs deliberate preservation:**

| Refactor | What would change | How to preserve |
|---|---|---|
| Shared submit button | `EditTransactionModal.tsx:261` is `bg-blue-600`; everything else is `bg-slate-900` | `variant` prop; pass blue for Edit (or unify deliberately) |
| Shared `<Modal>` | `SettingsModal` is `rounded-3xl` / `max-w-4xl` / `×`; four modals are `rounded-lg` / `max-w-md` / "Close"; `AccountModal` is `max-w-2xl` / `max-h-[80vh]` | `size` + `radius` + `closeLabel` props |
| Shared `<ProgressBar>` | `AccountCard.tsx:55` is `from-blue-600`; `page.tsx:399, 442` are `from-sky-500` | `gradient` prop |
| Shared input component | Modal inputs are `gray-300` / `rounded-lg` / `focus:ring-blue-200`; `SettingsModal` inputs are `slate-300` / `rounded-md` / mostly no ring | Two variants |
| Unifying `formatDate` | `AccountModal` dates shift by up to one day for non-ET viewers | This is a bug fix — flag it as intentional |
| Keyboard-accessible account card (`AccountCard.tsx:39`) | A real `<button>` brings `text-align: center`, `font: inherit` quirks, `display: inline-block` | Prefer `<div role="button" tabIndex={0} onKeyDown>`, or `<button className="… block w-full text-left">` and verify |
| `<img>` → `next/image` | Wraps in a span with its own sizing; needs explicit `width`/`height` | **Highest visual risk — recommend deferring** |
| Wiring the 6-bar chart to real data | Bar heights change (that's the point); the container, colors, and gaps must not | Keep the six `<div>`s and `bg-slate-800`; swap the `h-*` ladder for a computed `style={{ height }}`, max pinned to today's `h-40` |
| Wiring "Filter" | The button gains a dropdown panel | Render the panel absolutely-positioned so the header row's height and spacing are unchanged |
| "Savings rate" / "Monthly Net Income" | The displayed number changes from gross income to a real rate | Intentional — it's currently wrong. Keep the same type scale and card slot |

**Nothing is deleted from the UI**, so there are no gaps to design around — every unplumbed element is being connected rather than removed.

---

## Verification

1. **Before starting Phase 1**, snapshot the UI: `npm run dev`, then screenshot the dashboard and all six modals. Re-screenshot after each phase and diff. Phases 1–4 and the shadcn deletion must be pixel-identical; only the Phase 5 wire-ups may change displayed values.
2. `npm run build && npm run lint && npx tsc --noEmit` clean after every phase.
3. **Money-path smoke test** against a scratch DB seeded from `db/schema.sql`:
   - Add an expense → balance drops, `max` unchanged. Edit the amount → balance moves by the delta only. Move it to another account → both balances correct. Delete it → balance restored exactly.
   - Income to a checking account → balance unchanged, `max` increases. Income to a credit account → 400.
   - Force an error after the transaction `UPDATE` → confirm the account balance did **not** move. *(Regression test for P0-1.)*
4. **Idempotency:** run `npm run process-recurring` twice on a day with a due payment → exactly one transaction and one balance change. Same for `npm run process-monthly-snapshot`.
5. **Short month:** set `day_of_month = 31` and run with the clock faked to Feb 28 → the payment fires once.
6. **Bootstrap:** drop and recreate the DB from `db/schema.sql` + `db/seed.sql`, then run both scripts → no `TypeError`.
7. **Dashboard math:** with a known set of transactions, hand-compute Remaining Budget and confirm the base budget is counted exactly once. *(P0-4.)*
8. `docker compose up --build` on the NAS; confirm `worker.mjs` logs `Worker started...` inside the container, then `docker exec … npm run process-recurring` to confirm DB connectivity from the container.
9. `git diff --stat` should show a net deletion of roughly 900–1,200 lines.
