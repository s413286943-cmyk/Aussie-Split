# Protected Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the protected `origin/main` runtime in production while preserving the latest itinerary truth, four fixed stops, expanded-day layout, refined field kit, clean page edges, and itinerary homepage.

**Architecture:** Keep `origin/main` as the runtime and security base. Treat `content/aussie-itinerary.xlsx` as the sole itinerary source, regenerate JSON after workbook edits, and port only the current branch's still-missing CSS contracts into the split stylesheet architecture. Validate through protected APIs and an isolated preview before promoting the same verified build.

**Tech Stack:** Next.js 16, React 19, Node 24, Supabase protected server API, IndexedDB/PWA, CSS, Node test runner, Playwright, `@oai/artifact-tool`, Vercel.

**Design contract:** Preserve the existing travel-ticket / route-atlas identity, current palette and typography. The route and status lines remain semantic; fixed viewport ornaments are removed. An expanded day becomes the single desktop focus, while the checklist and ledger dock use compact, consistent controls on both desktop and mobile.

---

### Task 1: Lock the recovery content contract

**Files:**
- Modify: `tests/itinerary.test.mjs`
- Modify: `content/aussie-itinerary.xlsx`
- Modify: `src/data/itinerary.generated.json`

- [x] **Step 1: Add a failing coexistence test**

Add a test requiring D1 to contain both `Carlton / Lygon Street` and `QVM Winter Night Market`, and requiring D2 Fitzroy, D10 Palm Cove, and D11 Barangaroo Reserve as fixed blocks with their map resources.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --conditions=react-server --test tests/itinerary.test.mjs
```

Expected: FAIL because the four fixed stops are absent from the protected-base workbook while QVM remains present.

- [x] **Step 3: Render and inspect the protected-base workbook**

Use `@oai/artifact-tool` to inspect and render `Days`, `Blocks`, `Resources`, and `FoodMap` before editing. Confirm QVM is present in D1 and D13-D15 match the latest locked plan.

- [x] **Step 4: Add the four fixed stops without replacing QVM**

Update only D1, D2, D10, and D11 route rows and their relevant blocks/resources. D1 title/focus and FoodMap must retain the exact QVM event alongside Carlton. Reconcile the stale D13-D15 labels in `FoodMap`, `ActivityCosts`, and `Budget` without changing the protected `LedgerSnapshot` or lodging ledger values.

- [x] **Step 5: Export, regenerate, and verify GREEN**

Export the edited workbook to `/Users/SeanSun/Documents/Aussie/outputs/019f5ee9-9528-7e82-ab8b-eb8a6dddf0bb/aussie-itinerary.xlsx`, copy the verified workbook to `content/aussie-itinerary.xlsx`, run `npm run itinerary:import`, then rerun the focused test.

- [x] **Step 6: Inspect and render the final workbook**

Inspect `Days`, `Blocks`, `Resources`, `FoodMap`, `ActivityCosts`, and `Budget`, scan for formula errors, render all six sheets, and compare representative D1/D2/D10/D11 and D13-D15 rows.

- [x] **Step 7: Commit the content merge**

```bash
git add content/aussie-itinerary.xlsx src/data/itinerary.generated.json tests/itinerary.test.mjs
git commit -m "feat: merge fixed stops with protected itinerary"
```

### Task 2: Port the visual regression contracts

**Files:**
- Create: `tests/itinerary-layout.test.mjs`
- Create: `tests/itinerary-checklist-style.test.mjs`
- Create: `tests/travel-docket-decoration.test.mjs`
- Modify: `src/styles/route-atlas.css`
- Modify only if required: `src/styles/docket.css`

- [x] **Step 1: Add failing split-stylesheet contract tests**

The tests must require:

- an open desktop day spans `grid-column: 1 / -1` while mobile stays one column;
- the daily field kit is a desktop pair and mobile stack;
- checkboxes are `18px` with consistent `0.875rem` / `0.75rem` text;
- ledger metrics/actions use compact desktop and mobile grids;
- fixed `.docket-shell::before` and `.route-atlas::after` ornaments are absent;
- semantic day/weather lines remain;
- open-day focus and a `104px` desktop timeline column remain.

- [x] **Step 2: Run the three tests and verify RED**

Run:

```bash
node --test tests/itinerary-layout.test.mjs tests/itinerary-checklist-style.test.mjs tests/travel-docket-decoration.test.mjs
```

Expected: the layout test may already pass from the protected base; checklist sizing and fixed-ornament assertions must fail for the intended missing behavior.

- [x] **Step 3: Apply the minimum CSS port**

Edit the existing split styles rather than recreating `globals.css`: refine only the field-kit/checklist/ledger selectors, remove only fixed viewport ornaments and their obsolete mobile override, and add the open-day focus/timeline rules. Preserve current tokens, markup, route/status dividers, and mobile one-column behavior.

- [x] **Step 4: Rerun focused tests and verify GREEN**

- [x] **Step 5: Commit the visual port**

```bash
git add src/styles/route-atlas.css src/styles/docket.css tests/itinerary-layout.test.mjs tests/itinerary-checklist-style.test.mjs tests/travel-docket-decoration.test.mjs
git commit -m "fix: port itinerary field kit and focus polish"
```

### Task 3: Verify route and protected-runtime preservation

**Files:**
- Verify: `src/app/page.tsx`
- Verify: `src/app/ledger/page.tsx`
- Verify: `src/components/AppNav.jsx`
- Verify: `src/components/ledger/LedgerNav.jsx`
- Verify: `src/app/api/**`
- Verify: `src/lib/offlineDb.js`, `src/lib/offlineLedger.js`, `src/lib/receiptUpload.js`

- [x] **Step 1: Run route, API, offline, receipt, PWA, and security tests**

Run the focused protected-runtime test files and confirm the root route remains itinerary, `/ledger` remains the ledger dashboard, browser code contains no direct Supabase access, and PWA/offline/receipt contracts pass.

- [x] **Step 2: Run the full repository gate**

```bash
npm test
npm run lint
npm run build
git diff --check
npm audit
```

- [x] **Step 3: Commit plan/spec documentation only if needed**

Do not change protected runtime code unless a failing regression test proves the port damaged it.

### Task 4: Validate the rendered application locally

**Files:**
- Verify only: `/`, `/ledger`, `/add`, `/itinerary#d1`, `#d2`, `#d10`, `#d11`, `#d14`, `#d15`

- [x] **Step 1: Start the production build with Node 24**

- [x] **Step 2: Verify desktop behavior**

Confirm root itinerary routing, two-level navigation, clean page edges, open-day full-row behavior, close-to-two-column behavior, field-kit visual hierarchy, fixed-stop content, and no horizontal overflow.

- [x] **Step 3: Verify `390x844` mobile behavior**

Confirm single-column days, compact interactive checkboxes, readable ledger dock, navigation reachability, fixed-stop content, and no horizontal overflow.

- [x] **Step 4: Verify offline reload locally**

Unlock online, cache protected itinerary/ledger, switch offline, reload the itinerary and ledger, create a queued local operation in the isolated test environment, and confirm it remains pending without data loss.

### Task 5: Verify protected preview against real services

**Files:**
- Deployment only

- [x] **Step 1: Deploy one preview from the clean recovery branch**

- [x] **Step 2: Verify real protected access and read-only ledger totals**

Unlock through `/api/access`, load the real ledger through `/api/sync`, confirm the known row counts/totals, and confirm no direct Supabase REST request or 401 appears in the browser.

- [x] **Step 3: Run isolated reversible mutation checks**

Use uniquely named QA data to test add, edit, split-settle, delete/Undo, final cleanup, and one small private receipt upload/download. Remove all user-visible QA activity, attachment metadata, and Storage objects; retain only the protected ledger's required hidden tombstone, then recheck baseline totals.

- [x] **Step 4: Run preview desktop/mobile/offline checks**

Repeat the key visual and offline flows against the preview.

### Task 6: Promote and verify production

**Files:**
- Deployment and release documentation only

- [x] **Step 1: Deploy the exact verified source commit with Production secrets**

The real-service QA preview used a temporary per-deployment access code and was removed after verification. Production was therefore rebuilt from the same clean source commit with the existing Production secrets instead of promoting the QA environment override.

- [x] **Step 2: Verify production read-only state and UI**

Confirm the production alias, protected API session, ledger totals, receipts boundary, root itinerary, four fixed stops plus QVM, desktop/mobile layout, and console/network health.

- [x] **Step 3: Record deployment and rollback evidence**

Record the release commit, preview/production deployment IDs, verification counts, and the previous protected deployment as the rollback point.
