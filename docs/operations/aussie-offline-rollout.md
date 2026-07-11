# Offline Ledger Rollout Record

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
