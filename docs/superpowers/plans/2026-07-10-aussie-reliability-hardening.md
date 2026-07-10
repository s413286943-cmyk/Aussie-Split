# Aussie Chill Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current deployed travel docket into a protected, offline-capable, recoverable shared ledger whose itinerary data and production database remain consistent through the 2026 trip.

**Architecture:** Keep the current Next.js App Router experience and visual language, but move every Supabase operation behind authenticated Route Handlers. Store the working ledger and an idempotent operation outbox in IndexedDB, replay operations through one server sync endpoint, and use soft-delete tombstones to prevent stale remote rows from returning. Keep `content/aussie-itinerary.xlsx` as the itinerary source of truth, add explicit operational columns, and generate JSON plus a dated ledger snapshot through deterministic scripts.

**Tech Stack:** Next.js 16 App Router, React 19, native Web Crypto/Node crypto, native IndexedDB and Service Worker APIs, Supabase Postgres/Data API/Storage, GSAP, Node test runner, Playwright, Excel workbook importer.

---

## Delivery Order And Rollback Boundary

1. Preserve and reconcile the current code state without changing production behavior.
2. Ship authenticated server APIs while the old direct client path still works.
3. Switch the browser to the server API and verify production reads/writes.
4. Back up Supabase, enable RLS, revoke browser roles, and verify direct anonymous access is denied.
5. Add offline storage, receipts, itinerary data fixes, travel mode, and maintenance changes in independently testable commits.

The production database migration is not run until the compatible server API is deployed and verified. The pre-migration data export and rollback SQL remain outside Git in `.backups/`.

## File Responsibilities

- `src/lib/server/session.ts`: sign and verify the HttpOnly shared-trip session cookie.
- `src/lib/server/supabase.ts`: server-only Data API and Storage requests using `SUPABASE_SERVICE_ROLE_KEY`.
- `src/lib/server/http.ts`: authenticated JSON response and input helpers shared by Route Handlers.
- `src/app/api/access/route.ts`: create, inspect, and clear the access session.
- `src/app/api/sync/route.ts`: return a complete snapshot and atomically apply idempotent client operations.
- `src/app/api/activity/route.ts`: read full activity history for the dedicated page.
- `src/app/api/receipts/route.ts`: upload a private receipt after an expense exists.
- `src/app/api/receipts/[expenseId]/route.ts`: create a short-lived private receipt URL.
- `src/lib/apiClient.js`: the only browser-to-server ledger transport.
- `src/lib/offlineDb.js`: IndexedDB schema, localStorage migration, snapshots, outbox, and receipt blobs.
- `src/lib/syncEngine.js`: merge remote snapshots, replay pending operations, and derive sync labels.
- `src/lib/expenseValidation.js`: amount validation and duplicate warnings used by add and edit flows.
- `src/lib/backup.js`: JSON export validation and non-destructive backup merge.
- `src/components/ledger/*`: focused ledger shell, expense list, activity, add form, and backup controls.
- `src/components/itinerary/*`: focused hero, manifest, today console, stage switcher, and lazy day detail.
- `public/sw.js`: app-shell and runtime cache; API requests remain network-only.
- `src/components/ServiceWorkerRegistration.tsx`: register the service worker after first render.
- `src/app/manifest.ts`: install metadata and standalone display settings.
- `supabase/migrations/*_secure_shared_ledger.sql`: schema, idempotent operation RPC, indexes, RLS, and grants.
- `supabase/rollback/*_secure_shared_ledger.sql`: explicit rollback for the security migration.
- `scripts/import-itinerary.mjs`: require and resolve explicit daily operation fields from Excel.
- `scripts/export-ledger-snapshot.mjs`: validate a server export and write the dated workbook ledger snapshot input.
- `content/aussie-itinerary.xlsx`: authoritative itinerary content and explicit daily resource references.
- `tests/*.test.mjs`: pure behavior, API, importer, sync, validation, and backup coverage.
- `e2e/*.spec.ts`: browser access, ledger actions, offline replay, receipt, itinerary, and recovery coverage.

### Task 1: Protect And Reconcile The Baseline

**Files:**
- Modify: `.gitignore`
- Modify: `next.config.ts`
- Create: `.nvmrc`
- Create: `docs/operations/aussie-production-baseline.md`

- [ ] **Step 1: Record the verified baseline**

Document the current production URL, Supabase project ref, Vercel deployment id, local safety commit, row counts, totals by currency, and the commands used to verify the baseline. Do not include any API key or session token.

- [ ] **Step 2: Reconcile Git ancestry without dropping either tree**

Run `git fetch origin`, compare `git cherry -v origin/main` and `git diff --stat origin/main`, and merge `origin/main` only after confirming every remote-only feature is represented in the preserved tree. Resolve conflicts in favor of the verified production baseline plus any genuinely missing remote change; never reset or force-push.

- [ ] **Step 3: Pin the supported runtime and project root**

Create `.nvmrc` containing `22` and set:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: path.resolve(projectRoot),
};
```

- [ ] **Step 4: Verify and commit the baseline**

Run `npm test`, `npm run lint`, and `npm run build`. Expected: 46 existing tests pass, lint exits 0, build exits 0, and the multiple-lockfile warning is absent. Commit as `chore: establish reliability hardening baseline`.

### Task 2: Add Server-Side Access And Protected APIs

**Files:**
- Create: `src/lib/server/session.ts`
- Create: `src/lib/server/supabase.ts`
- Create: `src/lib/server/http.ts`
- Create: `src/app/api/access/route.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/activity/route.ts`
- Create: `src/lib/apiClient.js`
- Modify: `src/components/UnlockGate.jsx`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `src/components/ItineraryApp.jsx`
- Test: `tests/session.test.mjs`
- Test: `tests/api-client.test.mjs`
- Test: `tests/server-supabase.test.mjs`

- [ ] **Step 1: Write failing session tests**

Test that a token created for the configured trip verifies, a changed payload or signature fails, an expired token fails, and comparison of the submitted trip code is constant-time. The public interface is:

```ts
export function createSessionToken(now?: Date): string;
export function verifySessionToken(token: string, now?: Date): boolean;
export function matchesTripCode(candidate: string): boolean;
export const sessionCookieName = "aussie_chill_session";
```

Run `node --test tests/session.test.mjs`. Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the minimal signed session**

Use HMAC-SHA256 with `SESSION_SECRET`, a 30-day expiry, `crypto.timingSafeEqual`, and server-only `TRIP_CODE`. The POST access route accepts `{ code }`, sets `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, and `Max-Age=2592000`; GET returns `{ authenticated }`; DELETE expires the cookie. Never return the configured code or token body.

- [ ] **Step 3: Write failing server transport tests**

Verify the server transport sends both `apikey` and `Authorization: Bearer <service role>` only from server code, maps snake_case rows including `updated_at`, `deleted_at`, `attachment_name`, and `attachment_path`, caps activity queries at 100, and throws a typed error containing the upstream status without leaking response secrets.

- [ ] **Step 4: Implement server-only Supabase transport**

Expose these functions:

```ts
export async function fetchLedgerSnapshot(): Promise<LedgerSnapshot>;
export async function applyExpenseOperations(operations: ExpenseOperation[]): Promise<SyncResult>;
export async function fetchActivity(limit: number): Promise<ActivityEntry[]>;
export async function uploadReceipt(expenseId: string, file: File): Promise<ReceiptRecord>;
export async function createReceiptUrl(expenseId: string): Promise<string>;
```

Reject missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` at call time with a server configuration error. Do not import this module from a client component.

- [ ] **Step 5: Write failing browser API client tests**

Test that browser calls use only relative `/api/*` URLs, include credentials, preserve 401 as `AccessRequiredError`, and never reference `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 6: Implement authenticated Route Handlers and browser client**

Every data route calls `verifySessionToken` before reading its body. `/api/sync` GET returns `{ expenses, activity, serverTime }`; POST accepts at most 100 validated operations and returns `{ acknowledgedOperationIds, expenses, activity, serverTime }`. `/api/activity?limit=50` clamps limit to 1-100.

- [ ] **Step 7: Switch unlock and reads to the server session**

`UnlockGate` first checks GET `/api/access`; successful unlock stores only an `aussie-chill-offline-access-v1=yes` device marker for offline reopening. Online 401 always returns to the unlock form. Replace direct Supabase imports in both apps with `apiClient` calls while retaining the existing local cache for this compatibility deployment.

- [ ] **Step 8: Verify and commit**

Run the three new test files, the full test suite, lint, and build. Search `src` for `NEXT_PUBLIC_SUPABASE` and direct `/rest/v1/` or `/storage/v1/` calls; expected matches: zero in client code. Commit as `feat: protect ledger behind server access`.

### Task 3: Add Idempotent Database Operations And Lock Down Supabase

**Files:**
- Create: `supabase/migrations/<generated>_secure_shared_ledger.sql`
- Create: `supabase/rollback/secure_shared_ledger.sql`
- Modify: `supabase/schema.sql`
- Test: `tests/database-contract.test.mjs`
- Create outside Git: `.backups/<timestamp>/expenses.json`
- Create outside Git: `.backups/<timestamp>/expense_activity.json`
- Create outside Git: `.backups/<timestamp>/schema-summary.json`

- [ ] **Step 1: Write the database contract test**

The test reads the migration SQL and asserts it adds `updated_at`, `deleted_at`, and `attachment_path`; creates `expense_operations(op_id text primary key, created_at timestamptz)`; creates indexes on `attachments.expense_id` and `members.trip_id`; defines `apply_expense_operation`; enables RLS on all five existing public tables plus `expense_operations`; revokes all table privileges from `anon` and `authenticated`; explicitly grants the required privileges to `service_role`; and revokes function execution from `public`, `anon`, and `authenticated`.

- [ ] **Step 2: Generate and implement the migration**

Create the migration with `supabase migration new secure_shared_ledger`. The operation function accepts one JSON operation, inserts `opId` with `ON CONFLICT DO NOTHING`, and in the same transaction either upserts a newer expense or sets `deleted_at`; it inserts activity with `ON CONFLICT DO NOTHING`. It is `SECURITY INVOKER`, has a fixed `search_path`, and is executable only by `service_role`.

- [ ] **Step 3: Add rollback SQL**

Rollback restores grants required by the old direct browser client, disables RLS on the affected tables, drops only the new function/table/indexes/columns, and leaves all expense and activity rows intact. The rollback file starts with a warning that it reopens anonymous access and is emergency-only.

- [ ] **Step 4: Stage the compatible server deployment**

Set server-only Vercel variables `TRIP_CODE`, `SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`; deploy the API-compatible build; verify unlock, GET sync, add/edit/split/delete/undo, activity, and itinerary reads on the preview URL. The public Supabase variables may remain temporarily for rollback but must be unused by the shipped client.

- [ ] **Step 5: Back up live data before DDL**

Export all rows from `trips`, `members`, `expenses`, `expense_activity`, and `attachments`, plus table definitions and current grants, into the timestamped ignored backup directory. Record row counts and SHA-256 hashes in `manifest.json`.

- [ ] **Step 6: Apply and verify the production migration**

Apply the reviewed migration through Supabase migration tooling. Run Security Advisor and Performance Advisor. As `anon`, SELECT/INSERT/UPDATE/DELETE must fail; through the deployed authenticated `/api/sync`, all operations must succeed. Verify the original row counts and currency totals are unchanged.

- [ ] **Step 7: Remove obsolete public variables and commit**

Remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_TRIP_CODE` from production after the protected path is verified. Commit migration and code as `feat: lock down shared ledger data`.

### Task 4: Build IndexedDB, Outbox, And Offline App Shell

**Files:**
- Create: `src/lib/offlineDb.js`
- Create: `src/lib/syncEngine.js`
- Create: `src/lib/operation.js`
- Create: `src/components/ServiceWorkerRegistration.tsx`
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `src/components/ItineraryApp.jsx`
- Test: `tests/operation.test.mjs`
- Test: `tests/sync-engine.test.mjs`
- Test: `tests/offline-db.test.mjs`

- [ ] **Step 1: Write failing operation and merge tests**

Use operations shaped as:

```js
{
  opId: "op-uuid",
  type: "upsert" | "delete",
  expenseId: "expense-id",
  expense: null | { id: "expense-id", updatedAt: "ISO", deletedAt: null },
  activity: { id: "activity-id", expenseId: "expense-id", createdAt: "ISO" },
  createdAt: "ISO"
}
```

Test last-write-wins by `updatedAt`, tombstones hiding deleted rows, pending local operations being reapplied after a remote snapshot, duplicate `opId` acknowledgement being harmless, and activity deduplication by id.

- [ ] **Step 2: Implement pure operation and sync functions**

Expose `createUpsertOperation`, `createDeleteOperation`, `mergeRemoteSnapshot`, `visibleExpenses`, and `syncStateLabel`. Invalid or missing timestamps are rejected instead of silently ordered.

- [ ] **Step 3: Write failing IndexedDB tests**

Test versioned stores `expenses`, `activity`, `outbox`, `receiptBlobs`, and `meta`; atomic local operation + outbox writes; acknowledgement removal; localStorage migration only once; and retention of pending data across a database reopen.

- [ ] **Step 4: Implement native IndexedDB persistence**

Use one database named `aussie-chill-v2`, version 1. Keep all write transactions small and await `transaction.oncomplete`. Migrate existing `aussie-chill-expenses-v1` and `aussie-chill-activity-v1` into the new stores, set `meta.localStorageMigrated=true`, and do not delete the old keys until a successful remote sync.

- [ ] **Step 5: Integrate the outbox into the ledger**

Every add/edit/confirm/split/delete writes local state and one operation before updating React state. Undo removes the pending delete operation when it has not synced; if the delete already synced, Undo enqueues a new upsert. Flush on initial online load, `online`, and visible-tab events. Sync state is derived as `已同步`, `已本机保存，待同步（N）`, `正在同步`, or `同步失败，可重试`.

- [ ] **Step 6: Add the service worker and install manifest**

Precache `/`, `/itinerary`, `/expenses`, `/add`, `/settlement`, `/activity`, and the manifest. Use network-first for navigations with cached-page fallback, cache-first for immutable Next/static assets, stale-while-revalidate for itinerary images, and network-only for `/api/*`. Respect service worker updates by replacing the old cache only after activation.

- [ ] **Step 7: Verify offline behavior and commit**

With Playwright: unlock online, visit every route once, go offline, reload `/itinerary` and `/add`, add/edit/delete/undo expenses, close and reopen the page, then reconnect. Expected: app shell opens, operations persist, each server operation applies once, deleted rows do not return, and queue count returns to zero. Commit as `feat: make the travel ledger offline reliable`.

### Task 5: Implement Real Private Receipts

**Files:**
- Create: `src/app/api/receipts/route.ts`
- Create: `src/app/api/receipts/[expenseId]/route.ts`
- Create: `src/components/ledger/ReceiptLink.jsx`
- Modify: `src/lib/server/supabase.ts`
- Modify: `src/lib/offlineDb.js`
- Modify: `src/lib/syncEngine.js`
- Modify: `src/components/TripLedgerApp.jsx`
- Test: `tests/receipt.test.mjs`
- Test: `e2e/receipt.spec.ts`

- [ ] **Step 1: Write failing receipt validation tests**

Accept JPEG, PNG, HEIC, and WebP up to 10 MB; reject other types, empty files, missing expense ids, and path traversal. Build storage paths as `<expenseId>/<uuid>-<sanitized-name>`.

- [ ] **Step 2: Implement authenticated upload and signed read routes**

POST uploads to the private `receipts` bucket with the service role, inserts an attachment row, and updates the expense attachment fields. GET resolves the attachment for the expense and returns a signed URL valid for 300 seconds. Expense delete removes its stored objects before soft-deleting the row.

- [ ] **Step 3: Queue receipt blobs offline**

Store the file Blob and metadata in `receiptBlobs` under the expense id. After the expense upsert is acknowledged, upload the receipt, update the local expense with the returned attachment fields, and remove the Blob. A failed upload remains queued without changing the expense save result.

- [ ] **Step 4: Replace the fake receipt tag with a usable control**

Show `小票待上传` while queued, `查看小票` when remote, and no receipt tag otherwise. Opening a receipt requests a fresh signed URL and opens it in a new tab. Surface upload failure as `账单已保存，小票待重试`.

- [ ] **Step 5: Verify and commit**

Upload an image, reload, open it through the signed URL, confirm direct bucket URL fails, then delete and undo the expense. Commit as `feat: add private receipt evidence`.

### Task 6: Make Itinerary Operations Explicit In Excel

**Files:**
- Modify: `content/aussie-itinerary.xlsx`
- Modify: `scripts/import-itinerary.mjs`
- Modify: `src/data/itinerary.generated.json`
- Modify: `src/lib/today.js`
- Create: `scripts/export-ledger-snapshot.mjs`
- Create: `content/ledger-snapshot.json`
- Test: `tests/itinerary.test.mjs`
- Test: `tests/itinerary-generated.test.mjs`
- Test: `tests/ledger-snapshot.test.mjs`

- [ ] **Step 1: Write failing explicit-field tests**

Require `transport`, `leave_by`, `lodging_resource_id`, `primary_resource_id`, and `ticket_resource_id` on every Days row. Assert D2 is tour coach + Puffing Billy, D3 is self-drive rather than airport transfer, D4/D13 do not show a tour meeting-time rule, and every non-flight lodging resource title matches the lodging name.

- [ ] **Step 2: Update the workbook using the spreadsheet workflow**

Add the five columns to `Days`, add exact hotel map resources for Seaview Motel, Southern Ocean Villas, Southern Cross Atrium Apartments, Oaks Sydney Goldsbrough Suites, and flight-day airport resources, then populate D0-D16 explicitly. Preserve all current formatting and itinerary wording.

- [ ] **Step 3: Resolve explicit resources during import**

`normalizeDay` returns `transport`, `leaveBy`, and the three resource ids. `buildItinerary` validates each id and attaches `lodgingResource`, `primaryResource`, and `ticketResource` objects to the day. `buildTodayCommand`, `buildDayDocket`, and `collectMapActions` use these fields and never fall back to the first unrelated map.

- [ ] **Step 4: Add deterministic generated-data equality coverage**

Read the workbook and compare it deeply with the committed `itinerary.generated.json`. A stale generated file fails with a message instructing `npm run itinerary:import`.

- [ ] **Step 5: Establish the ledger snapshot boundary**

Export the authenticated production ledger as versioned JSON containing `exportedAt`, expenses, activity count, and per-currency totals. Update the workbook finance sheets from this snapshot, label them `Ledger snapshot` with the export timestamp, and add Puffing Billy plus corrected Oaks values. The itinerary importer continues to consume only Days, Blocks, and Resources.

- [ ] **Step 6: Verify every day and commit**

Run importer/tests and manually inspect D0-D16 docket links. Expected: 17 valid days, no unrelated hotel/airport map, generated JSON equals Excel, and workbook snapshot totals equal the JSON totals. Commit as `fix: make daily travel controls explicit`.

### Task 7: Refine Travel Mode And Ledger Workflows

**Files:**
- Create: `src/components/ledger/LedgerShell.jsx`
- Create: `src/components/ledger/ExpenseList.jsx`
- Create: `src/components/ledger/ExpenseForm.jsx`
- Create: `src/components/ledger/ActivityFeed.jsx`
- Create: `src/components/ledger/BackupPanel.jsx`
- Create: `src/components/itinerary/TodayConsole.jsx`
- Create: `src/components/itinerary/StageNavigator.jsx`
- Create: `src/components/itinerary/LazyDayDetails.jsx`
- Create: `src/lib/expenseValidation.js`
- Create: `src/lib/backup.js`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `src/components/ItineraryApp.jsx`
- Modify: `src/lib/activity.js`
- Modify: `src/app/globals.css`
- Test: `tests/expense-validation.test.mjs`
- Test: `tests/backup.test.mjs`
- Test: `e2e/ledger.spec.ts`
- Test: `e2e/itinerary.spec.ts`

- [ ] **Step 1: Write failing validation and backup tests**

Reject empty item, zero, negative, non-finite, and more than two-decimal amounts. Return a non-blocking duplicate warning for a same-date, same-currency, same-amount expense whose normalized item similarity is at least 0.75. Backup import validates schema version and merges by newest `updatedAt` without deleting rows absent from the file.

- [ ] **Step 2: Add clear filters, search, date range, and empty states**

Give each select a visible label and accessible name. Add item/note search plus start/end date. A zero-result state says which filters are active and offers `清除筛选`. Preserve `?split=pending` and highlight behavior.

- [ ] **Step 3: Show full activity without bloating the dashboard**

Keep the dashboard preview at three rows, load up to 100 rows on `/activity`, retain one-minute edit collapsing, and show the actual total available. Mark older cached activity as local until sync completes.

- [ ] **Step 4: Add export and non-destructive recovery**

Export a dated `aussie-chill-ledger-YYYY-MM-DD.json` from IndexedDB. Import first shows counts and totals, then `合并备份`; accepted rows enqueue normal upserts so they synchronize and remain auditable.

- [ ] **Step 5: Compact secondary ledger pages**

Dashboard retains the full travel docket hero. Add, expenses, activity, and settlement use a compact 96-140 px route header with title, sync state, and one primary action so the working control appears in the first mobile viewport.

- [ ] **Step 6: Add date-aware travel mode**

Before D0, retain hero then route atlas. During D0-D16, render a compact hero, Today Console first, current-stage tabs, and the current day expanded; default other stages to hidden behind `查看全部路书`. After D16, show settlement/return summary first. Do not add a Plan B section.

- [ ] **Step 7: Lazy-mount day details and preserve the route-atlas signature**

Closed `<details>` contains only its summary; mount timeline/resource descendants on first open. Add `content-visibility: auto` and stable intrinsic sizes to offscreen day cards. Keep the current field-docket palette and type hierarchy; the signature element remains the live route strip connecting today, stage, and next stop. Respect reduced motion.

- [ ] **Step 8: Verify responsive UX and commit**

Capture 1366x820, 599x913, and 390x844 screenshots of all routes. Verify no overflow, clipped text, nested cards, inaccessible filters, or layout shift; Today Console is reachable immediately during simulated trip dates. Commit as `feat: focus the docket on travel-day work`.

### Task 8: Complete Quality, Performance, And Production Delivery

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/access.spec.ts`
- Create: `e2e/offline.spec.ts`
- Create: `e2e/security.spec.ts`
- Create: `e2e/backup.spec.ts`
- Modify: `src/lib/weather.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Split: `src/app/globals.css` into `src/styles/tokens.css`, `ledger.css`, `itinerary.css`, and `motion.css`
- Modify: `README.md`
- Create: `docs/operations/deploy-and-rollback.md`

- [ ] **Step 1: Add the browser test harness**

Use the installed Chrome channel locally, start the app on an available port, and isolate each test with a fresh browser context. Seed server responses in unit mode and run one production smoke project against the deployed URL without destructive mutations.

- [ ] **Step 2: Cover the complete story**

Automate access denial/unlock/session persistence; add/edit/confirm/split/delete/undo; offline reload/reopen/reconnect; duplicate operation replay; receipt upload/read; pending filter; activity >8; backup export/import; D0-D16 map targets; and direct anonymous Supabase denial.

- [ ] **Step 3: Reduce weather requests**

Group forecast fetches by coordinate and reuse one response per coordinate/day range. Cache successful responses with a six-hour timestamp and fall back immediately when offline. Tests assert repeated same-coordinate days make one network request.

- [ ] **Step 4: Split oversized modules without changing behavior**

Move focused components into the listed ledger/itinerary files and split CSS by ownership while preserving selector order. `TripLedgerApp` owns orchestration only; `ItineraryApp` owns mode/stage orchestration only. Run tests after each move.

- [ ] **Step 5: Align dependencies and audit findings**

Use Node 22 LTS. Upgrade only compatible patch releases of Next/React/eslint config, inspect `npm audit --json`, and use a tested `overrides` entry for PostCSS only if the vulnerable version can be replaced without breaking Next. Never run `npm audit fix --force`.

- [ ] **Step 6: Run full verification**

Run `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `npm audit`, generated-JSON equality, Supabase advisors, direct-anon denial, authenticated production smoke tests, mobile/desktop screenshots, offline canvas/page checks, and a two-device sync test. Record exact counts and remaining advisories.

- [ ] **Step 7: Rehearse rollback**

On a preview deployment, verify the prior safety commit can deploy, the database rollback script parses, and restoring the exported JSON reproduces the recorded row counts and totals. Do not execute the permission-opening rollback in production unless the protected API fails.

- [ ] **Step 8: Commit, push, and deploy production**

Run final diff/secret checks, merge the implementation branch into the canonical GitHub history without force, deploy production, verify the alias `https://aussie-split.vercel.app`, and record the commit, deployment id, migration id, advisors, and rollback locations in the operations document. Commit as `release: harden Aussie Chill for travel`.

## Self-Review Checklist

- Every audit finding maps to one task above.
- The browser never receives a database secret or the configured trip code.
- Production RLS waits for a verified compatible server deployment.
- Offline mutations survive reload and reconnect without duplicates or resurrection.
- Receipt labels only appear for real local-pending or remote files.
- D0-D16 operational fields are explicit in Excel rather than inferred from prose.
- Travel mode does not reintroduce Plan B.
- Dashboard remains concise while full history and recovery stay accessible.
- Tests, lint, build, browser QA, advisors, backups, and rollback are all fresh before release.
