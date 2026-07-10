# Aussie Chill Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current deployed travel docket into a protected, offline-capable, recoverable shared ledger whose itinerary data and production database remain consistent through the 2026 trip.

**Architecture:** Keep the current Next.js App Router experience and visual language, but move every Supabase operation behind authenticated Route Handlers. Store the working ledger and an idempotent operation outbox in IndexedDB, replay operations through one server sync endpoint, and use soft-delete tombstones to prevent stale remote rows from returning. Keep `content/aussie-itinerary.xlsx` as the itinerary source of truth, add explicit operational columns, and generate JSON plus a dated ledger snapshot through deterministic scripts.

**Tech Stack:** Next.js 16 App Router, React 19, native Web Crypto/Node crypto, native IndexedDB and Service Worker APIs, Supabase Postgres/Data API/Storage, GSAP, Node test runner, Playwright, Excel workbook importer.

---

## Delivery Order And Rollback Boundary

1. Preserve and reconcile the current code state without changing production behavior.
2. Back up public tables and Storage metadata, pre-deploy a schema-detecting bridge client, then apply an additive compatibility migration with atomic legacy-write protection.
3. Ship authenticated server APIs and switch the browser to them while old table grants remain available for instant rollback.
4. Add IndexedDB/outbox and direct signed receipt upload, then verify those complete paths on preview and production.
5. Re-export live data, apply a separate RLS/grant lockdown migration, and verify direct anonymous table and Storage access is denied.
6. Complete itinerary data fixes, travel mode, maintenance work, and rollback rehearsal in independently testable commits.

Rollback SQL is reviewed and committed in Git. Only live data and Storage inventory exports remain outside Git in `.backups/`. The lockdown migration is never run until the additive migration, protected API, offline replay, and signed receipt flow are deployed and verified against production.

## File Responsibilities

- `src/lib/server/session.js`: sign and verify the HttpOnly shared-trip session cookie.
- `src/lib/server/supabase.js`: server-only Data API and Storage requests using `SUPABASE_SERVICE_ROLE_KEY`.
- `src/lib/server/http.js`: authenticated JSON, same-origin mutation, and no-store helpers shared by Route Handlers.
- `src/lib/server/rateLimit.js`: hash the source address and consume/reset the durable access-attempt limit.
- `src/app/api/access/route.ts`: create, inspect, and clear the access session.
- `src/app/api/sync/route.ts`: return a complete snapshot and atomically apply idempotent client operations.
- `src/app/api/activity/route.ts`: read full activity history for the dedicated page.
- `src/app/api/receipts/upload-url/route.ts`: issue a short-lived, stable-path signed upload token.
- `src/app/api/receipts/finalize/route.ts`: verify and idempotently attach an uploaded object.
- `src/app/api/receipts/[expenseId]/route.ts`: create a short-lived private download URL.
- `src/lib/apiClient.js`: the only browser-to-server ledger transport.
- `src/lib/offlineDb.js`: IndexedDB schema, localStorage migration, atomic snapshots, serialized outbox leases, and receipt blobs.
- `src/lib/syncEngine.js`: generate monotonic mutation versions, merge remote snapshots, drain pending operations, and derive sync labels.
- `src/lib/expenseValidation.js`: amount validation and duplicate warnings used by add and edit flows.
- `src/lib/backup.js`: JSON export validation and non-destructive backup merge.
- `src/components/ledger/*`: focused ledger shell, expense list, activity, add form, and backup controls.
- `src/components/itinerary/*`: focused hero, manifest, today console, stage switcher, and lazy day detail.
- `public/sw.js`: app-shell and runtime cache; API requests remain network-only.
- `src/components/ServiceWorkerRegistration.tsx`: register the service worker after first render.
- `src/app/manifest.ts`: install metadata and standalone display settings.
- `supabase/migrations/*_shared_ledger_compatibility.sql`: private internal schema, additive version/tombstone columns, canonical attachment metadata, backfill, idempotent operation RPC, throttling RPC, uniqueness, and indexes without changing legacy table grants.
- `supabase/migrations/*_lock_down_shared_ledger.sql`: RLS, minimum grants, default privilege changes, and Storage policy cleanup.
- `supabase/rollback/restore_legacy_shared_access.sql`: emergency compatibility policies that keep tombstones hidden; it does not drop data columns.
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

- [x] **Step 1: Record the verified baseline**

Document the current production URL, Supabase project ref, Vercel deployment id, local safety commit, row counts, totals by currency, and the commands used to verify the baseline. Do not include any API key or session token.

- [x] **Step 2: Reconcile Git ancestry without dropping either tree**

Run `git fetch origin`, compare `git cherry -v origin/main` and `git diff --stat origin/main`, and merge `origin/main` only after confirming every remote-only feature is represented in the preserved tree. Resolve conflicts in favor of the verified production baseline plus any genuinely missing remote change; never reset or force-push.

- [x] **Step 3: Pin the supported runtime and project root**

Create `.nvmrc` containing `22` and set:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: path.resolve(projectRoot),
};
```

- [x] **Step 4: Verify and commit the baseline**

Run `npm test`, `npm run lint`, and `npm run build`. Expected: 46 existing tests pass, lint exits 0, build exits 0, and the multiple-lockfile warning is absent. Commit as `chore: establish reliability hardening baseline`.

### Task 2: Add The Compatibility Schema And Ordered Mutation Contract

**Files:**
- Create: `supabase/migrations/<generated>_shared_ledger_compatibility.sql`
- Create: `supabase/rollback/remove_shared_ledger_compatibility.sql`
- Create: `src/lib/mutationVersion.js`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabaseRest.js`
- Modify: `src/components/TripLedgerApp.jsx`
- Test: `tests/database-contract.test.mjs`
- Test: `tests/mutation-version.test.mjs`
- Test: `tests/sync.test.mjs`
- Create outside Git: `.backups/<timestamp>/tables/*.json`
- Create outside Git: `.backups/<timestamp>/storage/*.json`

- [x] **Step 1: Write failing mutation-version tests**

Use fixed-width versions shaped as `<13-digit millis>-<6-digit counter>-<client id>`. Test that `nextMutationVersion` is strictly greater than the highest locally generated or remotely observed version even when the device clock moves backward, and that the client id deterministically breaks same-time ties. Legacy rows without a version receive a valid migration version rather than being rejected.

- [x] **Step 2: Implement the pure version helper**

Create `src/lib/mutationVersion.js` with:

```js
export function parseMutationVersion(value) {}
export function compareMutationVersions(left, right) {}
export function nextMutationVersion({ previous = "", observed = "", now = Date.now(), clientId }) {}
export function legacyMutationVersion({ createdAt, index, clientId = "legacy" }) {}
```

The implementation rejects malformed new-operation versions, but the migration helper assigns versions to existing local rows.

- [x] **Step 3: Write the failing compatibility migration contract test**

Assert the additive migration adds `updated_at`, `deleted_at`, and `mutation_version` to expenses; backfills every expense; extends canonical `attachments` with `receipt_id`, original name, MIME, size, finalized/deleted timestamps, and unique receipt/path constraints; creates private-schema `expense_operations` and `access_attempts`; adds indexes on `attachments.expense_id` and `members.trip_id`; and defines public service-only RPCs plus private trigger functions. It must not change RLS/grants on legacy application tables or drop a column. It must create non-exposed `app_private`, revoke schema/table access from `PUBLIC`, `anon`, and `authenticated`, enable RLS on its tables, and grant only minimum service-role access.

- [x] **Step 4: Generate and implement the additive migration**

Create the file with `supabase migration new shared_ledger_compatibility`. Private `app_private.enforce_expense_mutation` and `app_private.reject_physical_expense_delete` trigger functions are owned by `postgres`, use `SECURITY INVOKER`, fully qualify every object, have a fixed `pg_catalog, public, app_private` search path, and revoke direct execution from client roles. They need no private-table access. The insert/update trigger atomically requires a valid incoming version, rejects versions less than or equal to the stored version, and rejects physical timestamps over five minutes ahead of database time. The delete trigger always raises `physical_delete_disabled`; the pre-deployed bridge uses a versioned soft-delete UPDATE. Public `apply_expense_operation` inserts the `opId`; duplicates return immediately; otherwise it applies through the same trigger contract and records activity only for an applied mutation. Public RPCs are `SECURITY INVOKER`, fixed-search-path, and service-role-only.

- [x] **Step 5: Implement durable login throttling in SQL**

`consume_access_attempt(address_hash)` allows five failures per 15-minute window, returns the remaining attempts and `blocked_until`, and never stores a raw IP. `reset_access_attempt(address_hash)` removes the successful source entry. Both functions are service-role-only.

- [x] **Step 6: Back up live table and Storage state**

Export all five public tables, their definitions/grants, `storage.buckets` configuration, `storage.objects` inventory, and relevant `storage.objects` policies. Record row counts, object counts, currency totals, and SHA-256 hashes in the ignored backup manifest. Keep reviewed rollback SQL in Git.

- [x] **Step 7: Rehearse compatibility migration, rollback, and reapply**

Run the actual migration, the compatibility rollback, and the migration again on a disposable local Postgres/Supabase database. Execute integration assertions as `anon` as well as `service_role`: anonymous bridge writes with a newer version pass, unversioned/stale writes and physical deletes fail, client roles cannot preclaim operation ids or alter throttling state, and service RPCs work. The rollback may remove service-only functions/tables in the disposable environment but is not the production emergency path. Expected after reapply: old seed rows remain, versions are populated, duplicate op ids are ignored, and older mutation versions are stale.

- [x] **Step 8: Commit and pre-deploy a feature-detecting bridge client**

Update the direct Supabase adapter so it first detects whether the compatibility columns exist. Against the old schema it retains the baseline read/write behavior; against the new schema it fetches only `deleted_at=is.null`, maps/saves `mutation_version`, and soft-deletes with a newly allocated version. Assign a version to every add/edit/confirm/split/delete before localStorage and remote writes. Commit and deploy this build before DDL, then verify it still works against the old schema.

- [x] **Step 9: Apply the additive migration and close legacy writes**

Commit the reviewed SQL before applying it. Apply only the compatibility migration; the deployed bridge must detect and switch without redeploying. Verify add/edit/delete/Undo/reload, stale direct writes are rejected atomically, bridge deletes become tombstones, physical deletes fail, and row counts/totals remain correct. Verify an unrefreshed baseline client can no longer mutate and record the bridge deployment as the emergency browser rollback while public grants exist. Run advisors and commit as `feat: add ordered ledger operations`.

### Task 3: Add Server-Side Access And Protected APIs

**Files:**
- Create: `src/lib/server/session.js`
- Create: `src/lib/server/supabase.js`
- Create: `src/lib/server/http.js`
- Create: `src/lib/server/rateLimit.js`
- Create: `src/app/api/access/route.ts`
- Create: `src/app/api/sync/route.ts`
- Create: `src/app/api/activity/route.ts`
- Create: `src/lib/apiClient.js`
- Modify: `src/components/UnlockGate.jsx`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `src/components/ItineraryApp.jsx`
- Modify: `src/lib/access.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/session.test.mjs`
- Test: `tests/http-security.test.mjs`
- Test: `tests/api-client.test.mjs`
- Test: `tests/server-supabase.test.mjs`

- [ ] **Step 1: Write failing session and request-security tests**

Test valid, changed, and expired HMAC sessions; constant-time trip-code comparison; no configured-code fallback in production; same-origin mutation acceptance; cross-origin and `Sec-Fetch-Site: cross-site` rejection; and `Cache-Control: private, no-store` on every access/data response.

- [ ] **Step 2: Implement the signed session and server boundary**

Pin the `server-only` package and import it from every file that can read `TRIP_CODE`, `SESSION_SECRET`, `SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY`. Use HMAC-SHA256, a 30-day expiry, `crypto.timingSafeEqual`, and no public default code. The cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, and has `Max-Age=2592000`.

- [ ] **Step 3: Connect the access route to durable throttling**

Hash the trusted source address with HMAC before calling `consume_access_attempt`. Check the limit before comparing the code, reset on success, and return one generic invalid/blocked response without revealing which check failed. POST and DELETE require same-origin metadata; GET only reports `{ authenticated }`. All three methods are no-store.

- [ ] **Step 4: Write failing server transport tests**

Verify the server transport sends `apikey` and `Authorization: Bearer <service role>` only from server code, maps `mutation_version`, `updated_at`, and `deleted_at`, joins canonical attachment rows into read-only `attachmentName`/`attachmentPath` projections, drains operation batches through the RPC, caps activity at 100, and throws a typed upstream error without leaking response secrets.

- [ ] **Step 5: Implement the server transport and authenticated routes**

Expose `fetchLedgerSnapshot`, `applyExpenseOperations`, and `fetchActivity`. Every route verifies the session before reading a body. `/api/sync` GET returns all current rows including tombstones plus activity and server time; POST accepts at most 100 validated operations and returns per-op status plus a fresh snapshot. `/api/activity?limit=50` clamps to 1-100.

- [ ] **Step 6: Write failing browser API client tests**

Test relative `/api/*` URLs, credentials, 401 as `AccessRequiredError`, same-origin JSON mutations, and zero browser references to Supabase keys or direct Data/Storage endpoints.

- [ ] **Step 7: Switch unlock and data reads to the protected API**

`UnlockGate` checks GET `/api/access`; successful unlock stores only `aussie-chill-offline-access-v1=yes` for later offline reopening. Online 401 returns to the unlock form. Delete the public code comparison and placeholder. Both apps use `apiClient`; the existing local cache remains during this compatibility release.

- [ ] **Step 8: Deploy the compatible protected path**

Set `TRIP_CODE`, `SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` as server-only Vercel variables. Commit the exact build, deploy preview, then production while legacy grants and public Supabase variables remain available for instant rollback to the tombstone-aware bridge release. Verify access throttle, unlock, GET sync, add/edit/split/delete/undo, activity, and itinerary reads through the server API. Commit as `feat: protect ledger behind server access`.

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
  mutationVersion: "1780000000000-000001-device-id",
  expense: null | { id: "expense-id", mutationVersion: "1780000000000-000001-device-id", deletedAt: null },
  activity: { id: "activity-id", expenseId: "expense-id", createdAt: "ISO" },
  createdAt: "ISO"
}
```

Test last-write-wins by `mutationVersion`, tombstones hiding deleted rows, pending local operations being reapplied after a remote snapshot, duplicate `opId` acknowledgement being harmless, synchronized-delete Undo generating a strictly newer version, and activity deduplication by id.

- [ ] **Step 2: Implement pure operation and sync functions**

Expose `createUpsertOperation`, `createDeleteOperation`, `mergeRemoteSnapshot`, `visibleExpenses`, and `syncStateLabel`. Invalid or missing timestamps are rejected instead of silently ordered.

- [ ] **Step 3: Write failing IndexedDB tests**

Test versioned stores `expenses`, `activity`, `outbox`, `receiptBlobs`, and `meta`; one transaction atomically allocates/persists the HLC high-water mark plus the local mutation and outbox row; acknowledgement removal; localStorage migration only once; lease fencing across two simulated tabs; and retention of pending data across a database reopen.

- [ ] **Step 4: Implement native IndexedDB persistence**

Use one database named `aussie-chill-v2`, version 1. Keep all write transactions small and await `transaction.oncomplete`. Migrate existing `aussie-chill-expenses-v1` and `aussie-chill-activity-v1` into the new stores, assign legacy mutation versions in source order, set `meta.localStorageMigrated=true`, and do not delete the old keys until a successful remote sync. Reject remote physical components more than five minutes ahead of authenticated server time so a corrupt/future version cannot freeze later edits.

- [ ] **Step 5: Integrate the outbox into the ledger**

Every add/edit/confirm/split/delete writes local state and one operation before updating React state. Undo removes the pending delete operation when it has not synced; if the delete already synced, Undo creates a strictly newer mutation version and enqueues a new upsert. A renewable lease with monotonically increasing fence number in the IndexedDB `meta` store permits only one tab to flush; expired leases recover after a crash, and a response is committed only if owner and fence still match. Flush on initial online load, `online`, and visible-tab events, drain every 100-operation batch until empty, and atomically store each response snapshot plus acknowledgements before continuing. Sync state is derived as `已同步`, `已本机保存，待同步（N）`, `正在同步`, or `同步失败，可重试`.

- [ ] **Step 6: Add the service worker and install manifest**

Precache `/`, `/itinerary`, `/expenses`, `/add`, `/settlement`, `/activity`, and the manifest. Use network-first for navigations with cached-page fallback, cache-first for immutable Next/static assets, stale-while-revalidate for itinerary images, and network-only for `/api/*`. Respect service worker updates by replacing the old cache only after activation.

- [ ] **Step 7: Verify offline behavior and commit**

With Playwright: unlock online, visit every route once, go offline, reload `/itinerary` and `/add`, add/edit/delete/undo expenses, close and reopen the page, then reconnect. Expected: app shell opens, operations persist, each server operation applies once, deleted rows do not return, and queue count returns to zero. Commit as `feat: make the travel ledger offline reliable`.

### Task 5: Implement Real Private Receipts

**Files:**
- Create: `src/app/api/receipts/upload-url/route.ts`
- Create: `src/app/api/receipts/finalize/route.ts`
- Create: `src/app/api/receipts/[expenseId]/route.ts`
- Create: `src/components/ledger/ReceiptLink.jsx`
- Modify: `src/lib/server/supabase.js`
- Modify: `src/lib/offlineDb.js`
- Modify: `src/lib/syncEngine.js`
- Modify: `src/components/TripLedgerApp.jsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/receipt.test.mjs`
- Test: `e2e/receipt.spec.ts`

- [ ] **Step 1: Write failing receipt validation tests**

Accept JPEG, PNG, HEIC, and WebP up to 10 MB; reject other types, empty files, missing expense/receipt ids, and path traversal. Build one stable path as `<expenseId>/<receiptId>-<sanitized-name>` so retries cannot create duplicate objects.

- [ ] **Step 2: Issue authenticated signed upload tokens**

The upload-url route verifies the session, same origin, file metadata, and expense existence, then creates a Supabase signed upload token for the stable path. Configure the private bucket itself with the same MIME allowlist and 10 MB size cap. The browser uploads directly to Supabase Storage, so the file body never crosses the Vercel 4.5 MB request/response boundary. Pin and dynamically load `tus-js-client`; use Supabase's signed resumable upload flow for files above 6 MB and the same signed path/token flow for smaller files.

- [ ] **Step 3: Finalize idempotently and sign private reads**

The finalize route verifies the object exists, matches expected size/type, and belongs to an active expense, then upserts one canonical attachment by `receipt_id` and `storage_path`. It never updates the expense row or its mutation version, so finalization cannot stale or overwrite a concurrent ledger edit. Snapshot reads derive attachment projections from this table. Repeating finalize returns the same record. GET resolves the attachment and returns a signed download URL valid for 300 seconds.

- [ ] **Step 4: Queue receipt blobs offline**

Store the file Blob and metadata in `receiptBlobs` under the expense id. After the expense upsert is acknowledged, upload the receipt, update the local expense with the returned attachment fields, and remove the Blob. A failed upload remains queued without changing the expense save result.

- [ ] **Step 5: Preserve Undo and clean up later**

Soft-deleting an expense does not remove its receipt. Undo therefore restores the same object and attachment. On authenticated sync, a bounded non-blocking cleanup removes finalized Storage objects and attachment rows only for tombstones older than seven days, and removes uploaded-but-never-finalized objects older than 24 hours. Retries are idempotent and never delete an active expense's object.

- [ ] **Step 6: Replace the fake receipt tag with a usable control**

Show `小票待上传` while queued, `查看小票` when remote, and no receipt tag otherwise. Opening a receipt requests a fresh signed URL and opens it in a new tab. Surface upload failure as `账单已保存，小票待重试`.

- [ ] **Step 7: Verify and commit**

Upload small and 8-10 MB images, retry the same upload/finalize, reload, open through a signed URL, confirm unsigned direct bucket reads fail, then delete and undo the expense. Verify only one object/attachment exists and delayed cleanup excludes the restored row. Commit as `feat: add private receipt evidence`.

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
- Create: `supabase/migrations/<generated>_lock_down_shared_ledger.sql`
- Create: `supabase/rollback/restore_legacy_shared_access.sql`
- Modify: `src/lib/weather.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Split: `src/app/globals.css` into `src/styles/tokens.css`, `ledger.css`, `itinerary.css`, and `motion.css`
- Modify: `README.md`
- Create: `docs/operations/deploy-and-rollback.md`

- [ ] **Step 1: Add the browser test harness**

Use the installed Chrome channel locally, start the app on an available port, and isolate each test with a fresh browser context. Seed server responses in unit mode and run one production smoke project against the deployed URL without destructive mutations.

- [ ] **Step 2: Cover the complete story**

Automate access denial/unlock/session persistence; add/edit/confirm/split/delete/undo; offline reload/reopen/reconnect; duplicate operation replay; receipt upload/read; pending filter; activity >8; backup export/import; and D0-D16 map targets. Keep separate `pre-lockdown` and `post-lockdown` projects: compatibility tests explicitly expect legacy anonymous access before migration, while direct anonymous Data/Storage denial assertions run only after lockdown.

- [ ] **Step 3: Reduce weather requests**

Group forecast fetches by coordinate and reuse one response per coordinate/day range. Cache successful responses with a six-hour timestamp and fall back immediately when offline. Tests assert repeated same-coordinate days make one network request.

- [ ] **Step 4: Split oversized modules without changing behavior**

Move focused components into the listed ledger/itinerary files and split CSS by ownership while preserving selector order. `TripLedgerApp` owns orchestration only; `ItineraryApp` owns mode/stage orchestration only. Run tests after each move.

- [ ] **Step 5: Align dependencies and audit findings**

Use Node 22 LTS. Upgrade only compatible patch releases of Next/React/eslint config, inspect `npm audit --json`, and use a tested `overrides` entry for PostCSS only if the vulnerable version can be replaced without breaking Next. Never run `npm audit fix --force`.

- [ ] **Step 6: Deploy and verify the complete protected feature set before lockdown**

Run unit/lint/build/E2E, commit the exact candidate, and deploy that commit's full server API, offline replay, signed receipts, itinerary data, and travel UI to preview, then production while legacy grants remain. Verify authenticated production reads/writes, offline replay, receipt upload/view, screenshots, and two-device sync. The tombstone-aware bridge deployment and public variables remain available for rollback.

- [ ] **Step 7: Write and test the separate lockdown and emergency rollback**

The lockdown migration enables RLS on every public table, revokes existing and default table/function privileges from `PUBLIC`, `anon`, and `authenticated`, grants only required access to `service_role`, keeps the `receipts` bucket private, and removes any anonymous/authenticated `storage.objects` policy that can access it. The emergency rollback restores only bridge requirements: expense SELECT uses `deleted_at is null`, UPDATE uses `deleted_at is null` with a `WITH CHECK (true)` so the bridge can create a tombstone, INSERT has an explicit check, and physical DELETE remains ungranted. It never drops tombstone, version, attachment, or operation data. Run migration → rollback → reapply plus table and Storage access assertions on a disposable database.

- [ ] **Step 8: Back up production again and apply lockdown**

Commit and push the reviewed migration/rollback before DDL. Re-export tables, grants, bucket configuration, object inventory, and policies with hashes. Apply the lockdown migration, run advisors, verify anonymous table reads/writes and unsigned/anonymous receipt access fail, then verify the authenticated API, signed uploads/downloads, offline reconnect, row counts, and currency totals still succeed.

- [ ] **Step 9: Run final verification**

Run `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `npm audit`, generated-JSON equality, Supabase advisors, direct-anon denial, authenticated production smoke tests, mobile/desktop screenshots, offline page checks, and a two-device sync test. Record exact counts and remaining advisories.

- [ ] **Step 10: Commit, remove obsolete public configuration, and finish production delivery**

Run final diff/secret checks, merge the implementation branch into the canonical GitHub history without force, remove `NEXT_PUBLIC_TRIP_CODE` immediately and remove public Supabase variables only after instant rollback to the prior compiled deployment is proven, verify the alias `https://aussie-split.vercel.app`, and record the commit, deployment id, both migration ids, advisors, backup hashes, and rollback locations in the operations document. Commit as `release: harden Aussie Chill for travel`.

## Self-Review Checklist

- Every audit finding maps to one task above.
- The browser never receives a database secret or the configured trip code.
- Production RLS waits for the verified server API, offline replay, and signed receipt deployment.
- Additive compatibility DDL and access lockdown are separate migrations.
- Mutation ordering is deterministic across retries, clock rollback, and two devices.
- Every mutation route is same-origin, no-store, throttled where appropriate, and server-only secrets never enter client bundles.
- Offline mutations survive reload and reconnect without duplicates or resurrection.
- Receipt labels only appear for real local-pending or remote files.
- Receipt bodies upload directly with short-lived signatures and survive soft-delete Undo.
- D0-D16 operational fields are explicit in Excel rather than inferred from prose.
- Travel mode does not reintroduce Plan B.
- Dashboard remains concise while full history and recovery stay accessible.
- Tests, lint, build, browser QA, advisors, table/Storage backups, and migration-rollback-reapply evidence are all fresh before release.
