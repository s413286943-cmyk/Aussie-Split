# Offline Ledger Rollout Record

## 2026-07-14 protected-runtime recovery

- Protected base: `origin/main` at `940758e5505e52b2409c9e8caf69bd31857efc4d`.
- Verified runtime commit: `a22fffe3ad29e6fa6e731473a86d4152ff835cca`.
- Release record commit: `20421ebe542f6d7eeb2e773195e59eaaf9793ffc`.
- Standard preview: `dpl_77Pi8k1rCCBSCXKfK2hC9rrmyBGg`.
- Real-service QA preview: `dpl_HwVnDMK1AsM69oSv2xsQvwWndJEF` (removed after QA because it used a temporary per-deployment access code).
- Manual Production candidate: `dpl_An16qJirSyX2ESLWaxgcsEpDKeKx`.
- Git-main Production deployment: `dpl_252a8G1XeVEkad96f72MjvXZqJhC`.
- Production alias: `https://aussie-split.vercel.app`.
- Previous protected rollback point: `dpl_BHD14rhFKmAFH9eP1qcExEm1nXv9`.

The recovery kept the protected API, offline ledger, private receipts, and Supabase boundary from `origin/main`, then forward-ported only the approved itinerary and UI changes. D1 now keeps both Carlton / Lygon Street and QVM Winter Night Market; D2 Fitzroy, D10 Palm Cove, and D11 Barangaroo Reserve are fixed itinerary stops. The root route remains the itinerary, an expanded desktop day occupies a full row, mobile remains single-column, the fixed left rail is absent, and checklist / ledger controls use the compact field-kit styling.

Forward-port audit of the 12 approved commits:

- `f1624c3` is represented by the equivalent protected-main itinerary commit `940758e`.
- `ef754f4`, `65f871f`, `228803c`, and `3d8db0f` are represented by the recovery plan, fixed-stop tests, workbook source, and generated itinerary in `fc9a904`.
- `eca06c3`, `e046b91`, `beb52ca`, `a8fc268`, `628fc81`, and `5b6228c` are represented by the focused layout / checklist / ornament contracts and CSS port in `aa0278b`.
- `98cf861` is preserved by the protected base's itinerary root and covered by the route regression gate in `a22fffe`.

Verification evidence:

- Node 24 test gate: 311 tests, 305 passed, 0 failed, 6 PostgreSQL-environment skips.
- ESLint, production build, `git diff --check`, and dependency audit: passed; audit reported 0 vulnerabilities.
- Local Chromium E2E: 23 passed, covering desktop, `390px` mobile, full-row expansion, ledger add/edit/split/delete/Undo, offline cached reload/local queueing, and private receipt upload/download boundaries.
- Preview real ledger baseline before and after QA: 13 active expenses; confirmed totals CNY `20,377.63` and AUD `4,908.95`.
- Real-service QA: add, edit, split-settle, delete, Undo, final delete, signed receipt upload, finalize, byte-identical download, delayed Storage cleanup, and receipt 404 all passed. User-visible QA activity, attachment metadata, and Storage objects were removed; one hidden tombstone remains as required by the physical-delete guard.
- Production: 17 application routes including all 7 protected API routes; `/`, deployment readiness, and alias returned 200 / Ready. Unauthenticated sync, itinerary, and receipt requests returned 401, and the public HTML contained no real hotel or tour content.
- Production error log check after smoke requests: no errors found.

## Release status

The protected offline ledger is released at `https://aussie-split.vercel.app` on deployment `dpl_BHD14rhFKmAFH9eP1qcExEm1nXv9`. `SUPABASE_SERVICE_ROLE_KEY` is configured as a server-only Vercel secret, both production migrations are applied, and direct browser access to Supabase Data and Storage is closed.

## Durable behavior

- IndexedDB database: `aussie-chill-v2`.
- Stores: `expenses`, `activity`, `outbox`, `receiptBlobs`, and `meta`.
- Every ledger mutation and Delete Undo is committed atomically before React state changes.
- One fenced lease drains at most 100 operations per batch; applied and stale acknowledgements are idempotent.
- Timestamp-less legacy rows receive lowest-priority deterministic versions, so they cannot overwrite a newer remote edit or tombstone.
- Service Worker caches are scoped to a build release. A failed install cannot mutate the active release's application shell.
- API requests remain network-only; navigations and itinerary assets use explicit offline strategies.

## Verification evidence

- Full Node 24 and PostgreSQL integration suite: 292 passed, 0 failed, 0 skipped.
- ESLint: passed.
- Next.js production build: passed.
- Local Chromium E2E: 14 passed.
- Read-only production smoke: 1 passed.
- Dependency audit: 0 vulnerabilities.
- Focused IndexedDB, synchronization, API-client, operation, and PWA tests: passed.
- Real Chromium mobile viewport: opened online, reloaded in flight mode, closed, and reopened in flight mode with the itinerary title and cached assets present.
- Production mutations: add, edit, split-settle, delete, Undo, and post-lockdown replay returned `applied`.
- Production receipt: signed upload, `content_type` verification, private five-minute download, and delayed object cleanup passed with all test data removed.
- Independent specification and code-quality reviews: passed after addressing manual-add defaults, legacy version priority, atomic Undo, stale activity, cross-tab edits, and release-specific caches.

## Rollback

1. For a web-only regression, promote the previous protected deployment while keeping the locked database.
2. If the protected API cannot operate against the locked database, apply `supabase/rollback/restore_legacy_shared_access.sql` and promote bridge deployment `dpl_J6g3jtS15zY7ACkcJGBKaouW4FyC`.
3. Do not clear IndexedDB or legacy localStorage keys during rollback; pending operations remain recoverable.
4. Release-specific caches are removed only when a replacement worker activates successfully; a failed install leaves the active release intact.
5. After recovery, redeploy the protected build and reapply the lockdown migration; the bridge is an emergency path, not a long-term state.
